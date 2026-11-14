import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { AppException, CurrentUserData, ErrorCode } from '@medflow/common';
import { PatientEvents } from '@medflow/contracts';
import { OutboxService } from '@medflow/kafka';
import {
  AllergyResponse,
  ConditionResponse,
  toAllergyResponse,
  toConditionResponse,
} from './clinical.mapper';
import {
  CreateAllergyDto,
  CreateConditionDto,
  UpdateAllergyDto,
  UpdateConditionDto,
} from './dto/clinical.dto';
import { PatientAllergy } from './entities/patient-allergy.entity';
import {
  ConditionStatus,
  PatientCondition,
} from './entities/patient-condition.entity';
import { Patient } from './entities/patient.entity';
import { clinicToday } from './patient.mapper';

const AGGREGATE = 'PATIENT';

const ALLERGY_FIELDS = [
  'allergen',
  'category',
  'severity',
  'reaction',
] as const;

const CONDITION_FIELDS = [
  'name',
  'icd10Code',
  'diagnosedOn',
  'status',
  'notes',
] as const;

// PATCH may not clear these (IsOptional lets null through the validators)
function rejectNulls(dto: object, fields: readonly string[]): void {
  const cleared = fields.filter(
    (field) => (dto as Record<string, unknown>)[field] === null,
  );
  if (cleared.length === 0) return;
  throw new AppException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.VALIDATION_ERROR,
    'Validation failed',
    cleared.map((field) => ({ field, errors: [`${field} cannot be empty`] })),
  );
}

const notFound = (what: 'Patient' | 'Allergy' | 'Condition') =>
  new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    `${what} not found`,
  );

// The same allergen twice for one patient → 409 for the form field
function toAllergenConflict(error: unknown): unknown {
  if (!(error instanceof QueryFailedError)) return error;
  const { constraint } = error.driverError as { constraint?: string };
  if (constraint !== 'uq_patient_allergies_allergen') return error;
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.CONFLICT,
    'This allergy is already recorded for the patient',
    { field: 'allergen' },
  );
}

function checkDiagnosedOn(date: string | null | undefined): void {
  if (date && date > clinicToday()) {
    throw new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      ErrorCode.BUSINESS_RULE,
      'The diagnosis date cannot be in the future',
      { field: 'diagnosedOn' },
    );
  }
}

// Allergies and chronic conditions (DOC 6.1 step 4): visible on every visit,
// checked against prescriptions later. Events name the patient and the
// record only — never the allergen, diagnosis or notes (history is ADMIN-readable).
@Injectable()
export class ClinicalService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Patient)
    private readonly patients: Repository<Patient>,
    @InjectRepository(PatientAllergy)
    private readonly allergies: Repository<PatientAllergy>,
    @InjectRepository(PatientCondition)
    private readonly conditions: Repository<PatientCondition>,
    private readonly outbox: OutboxService,
  ) {}

  // Most severe first, then by name
  async listAllergies(patientId: string): Promise<AllergyResponse[]> {
    await this.mustExist(patientId);
    return (await this.allergyRows(patientId)).map(toAllergyResponse);
  }

  // Active first, then the latest diagnosis
  async listConditions(patientId: string): Promise<ConditionResponse[]> {
    await this.mustExist(patientId);
    return (await this.conditionRows(patientId)).map(toConditionResponse);
  }

  // Both lists for GET /patients/:id (clinical readers only)
  async summary(patientId: string) {
    const [allergies, conditions] = await Promise.all([
      this.allergyRows(patientId),
      this.conditionRows(patientId),
    ]);
    return {
      allergies: allergies.map(toAllergyResponse),
      conditions: conditions.map(toConditionResponse),
    };
  }

  async addAllergy(
    patientId: string,
    dto: CreateAllergyDto,
    actor: CurrentUserData,
  ): Promise<AllergyResponse> {
    try {
      const row = await this.dataSource.transaction(async (em) => {
        const patient = await this.activePatient(em, patientId);
        const saved = await em.save(
          em.create(PatientAllergy, {
            ...dto,
            patientId,
            recordedBy: actor.id,
            recordedByName: actor.name || null,
          }),
        );
        await this.outbox.add(em, {
          eventType: PatientEvents.ALLERGY_ADDED,
          aggregateType: AGGREGATE,
          aggregateId: patientId,
          actor,
          payload: { ...who(patient), allergyId: saved.id },
        });
        return saved;
      });
      return toAllergyResponse(row);
    } catch (error) {
      throw toAllergenConflict(error);
    }
  }

  // Any field, like a condition (our addition to DOC 8.4). Renaming to an
  // allergen the patient already has → 409. Nothing changed → no event.
  async updateAllergy(
    patientId: string,
    allergyId: string,
    dto: UpdateAllergyDto,
    actor: CurrentUserData,
  ): Promise<AllergyResponse> {
    rejectNulls(dto, ['allergen', 'category', 'severity']);
    try {
      const row = await this.dataSource.transaction(async (em) => {
        const patient = await this.activePatient(em, patientId);
        const current = await em.findOne(PatientAllergy, {
          where: { id: allergyId, patientId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!current) throw notFound('Allergy');
        const changedFields = ALLERGY_FIELDS.filter(
          (field) => dto[field] !== undefined && dto[field] !== current[field],
        );
        if (changedFields.length === 0) return current;
        em.merge(PatientAllergy, current, dto);
        const saved = await em.save(current);
        await this.outbox.add(em, {
          eventType: PatientEvents.ALLERGY_UPDATED,
          aggregateType: AGGREGATE,
          aggregateId: patientId,
          actor,
          payload: { ...who(patient), allergyId, changedFields },
        });
        return saved;
      });
      return toAllergyResponse(row);
    } catch (error) {
      throw toAllergenConflict(error);
    }
  }

  async removeAllergy(
    patientId: string,
    allergyId: string,
    actor: CurrentUserData,
  ): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      const patient = await this.activePatient(em, patientId);
      const row = await em.findOneBy(PatientAllergy, {
        id: allergyId,
        patientId,
      });
      if (!row) throw notFound('Allergy');
      await em.remove(row);
      await this.outbox.add(em, {
        eventType: PatientEvents.ALLERGY_REMOVED,
        aggregateType: AGGREGATE,
        aggregateId: patientId,
        actor,
        payload: { ...who(patient), allergyId },
      });
    });
  }

  async addCondition(
    patientId: string,
    dto: CreateConditionDto,
    actor: CurrentUserData,
  ): Promise<ConditionResponse> {
    checkDiagnosedOn(dto.diagnosedOn);
    const row = await this.dataSource.transaction(async (em) => {
      const patient = await this.activePatient(em, patientId);
      const saved = await em.save(
        em.create(PatientCondition, {
          ...dto,
          status: dto.status ?? ConditionStatus.ACTIVE,
          patientId,
          recordedBy: actor.id,
          recordedByName: actor.name || null,
        }),
      );
      await this.outbox.add(em, {
        eventType: PatientEvents.CONDITION_ADDED,
        aggregateType: AGGREGATE,
        aggregateId: patientId,
        actor,
        payload: { ...who(patient), conditionId: saved.id },
      });
      return saved;
    });
    return toConditionResponse(row);
  }

  // Nothing changed → no event
  async updateCondition(
    patientId: string,
    conditionId: string,
    dto: UpdateConditionDto,
    actor: CurrentUserData,
  ): Promise<ConditionResponse> {
    rejectNulls(dto, ['name', 'status']);
    checkDiagnosedOn(dto.diagnosedOn);
    const row = await this.dataSource.transaction(async (em) => {
      const patient = await this.activePatient(em, patientId);
      const current = await em.findOne(PatientCondition, {
        where: { id: conditionId, patientId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current) throw notFound('Condition');
      const changedFields = CONDITION_FIELDS.filter(
        (field) => dto[field] !== undefined && dto[field] !== current[field],
      );
      if (changedFields.length === 0) return current;
      em.merge(PatientCondition, current, dto);
      const saved = await em.save(current);
      await this.outbox.add(em, {
        eventType: PatientEvents.CONDITION_UPDATED,
        aggregateType: AGGREGATE,
        aggregateId: patientId,
        actor,
        payload: { ...who(patient), conditionId, changedFields },
      });
      return saved;
    });
    return toConditionResponse(row);
  }

  // Our addition: a condition entered by mistake (marking it resolved
  // would falsify the record)
  async removeCondition(
    patientId: string,
    conditionId: string,
    actor: CurrentUserData,
  ): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      const patient = await this.activePatient(em, patientId);
      const row = await em.findOneBy(PatientCondition, {
        id: conditionId,
        patientId,
      });
      if (!row) throw notFound('Condition');
      await em.remove(row);
      await this.outbox.add(em, {
        eventType: PatientEvents.CONDITION_REMOVED,
        aggregateType: AGGREGATE,
        aggregateId: patientId,
        actor,
        payload: { ...who(patient), conditionId },
      });
    });
  }

  private async mustExist(patientId: string): Promise<void> {
    if (!(await this.patients.existsBy({ id: patientId })))
      throw notFound('Patient');
  }

  // The patient, share-locked so a parallel deactivation waits; an inactive
  // record (duplicate / deceased) takes no new clinical entries
  private async activePatient(em: EntityManager, id: string): Promise<Patient> {
    const patient = await em.findOne(Patient, {
      where: { id },
      lock: { mode: 'pessimistic_read' },
    });
    if (!patient) throw notFound('Patient');
    if (!patient.isActive) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATUS,
        'An inactive patient record cannot be changed',
      );
    }
    return patient;
  }

  private allergyRows(patientId: string) {
    return this.allergies
      .createQueryBuilder('allergy')
      .where('allergy.patientId = :patientId', { patientId })
      .orderBy('allergy.severity', 'DESC')
      .addOrderBy('allergy.allergen', 'ASC')
      .getMany();
  }

  private conditionRows(patientId: string) {
    return this.conditions
      .createQueryBuilder('condition')
      .where('condition.patientId = :patientId', { patientId })
      .orderBy('condition.status', 'ASC')
      .addOrderBy('condition.diagnosedOn', 'DESC', 'NULLS LAST')
      .addOrderBy('condition.createdAt', 'DESC')
      .getMany();
  }
}

const who = (p: Patient) => ({
  patientId: p.id,
  mrn: p.mrn,
  firstName: p.firstName,
  lastName: p.lastName,
});
