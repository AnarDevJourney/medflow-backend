import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { AppException, ErrorCode } from '@medflow/common';
import type { CurrentUserData } from '@medflow/common';
import { RecordEvents } from '@medflow/contracts';
import { OutboxService } from '@medflow/kafka';
import { AddDiagnosisDto, UpdateDiagnosisDto } from './dto/diagnosis.dto';
import {
  AGGREGATE,
  lockedOpenOwn,
  notFound,
  toEncounterRef,
} from './encounter-access';
import { EncounterDetailService } from './encounter-detail.service';
import { EncounterDetailResponse } from './encounter.mapper';
import { Diagnosis, DiagnosisType } from './entities/diagnosis.entity';
import { Encounter } from './entities/encounter.entity';

// The same code twice in one visit → 409 for the search field
function toDuplicate(error: unknown): unknown {
  if (!(error instanceof QueryFailedError)) return error;
  const { constraint } = error.driverError as { constraint?: string };
  if (constraint !== 'uq_diagnoses_code') return error;
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.CONFLICT,
    'This diagnosis is already in the visit',
    { field: 'icd10Code' },
  );
}

// DOC 6.3 step 7: ICD-10 diagnoses of an open visit, by its own doctor.
// One PRIMARY at most — choosing another moves the old one to SECONDARY
// (closing needs exactly one). Removable while the visit is open.
@Injectable()
export class DiagnosesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: OutboxService,
    private readonly detail: EncounterDetailService,
  ) {}

  async add(
    encounterId: string,
    dto: AddDiagnosisDto,
    actor: CurrentUserData,
  ): Promise<EncounterDetailResponse> {
    try {
      return await this.dataSource.transaction(async (em) => {
        const encounter = await lockedOpenOwn(em, encounterId, actor, 'edit');
        const title = dto.icd10Code
          ? await usableTitle(em, dto.icd10Code)
          : uncoded(dto);
        const hasPrimary = await em.existsBy(Diagnosis, {
          encounterId: encounter.id,
          type: DiagnosisType.PRIMARY,
        });
        const type = !dto.icd10Code
          ? DiagnosisType.SECONDARY
          : (dto.type ??
            (hasPrimary ? DiagnosisType.SECONDARY : DiagnosisType.PRIMARY));
        if (type === DiagnosisType.PRIMARY) await demotePrimary(em, encounter);

        const saved = await em.save(
          em.create(Diagnosis, {
            encounterId: encounter.id,
            patientId: encounter.patientId,
            icd10Code: dto.icd10Code ?? null,
            description: dto.description ?? title.slice(0, 255),
            type,
            notes: dto.notes ?? null,
          }),
        );
        await this.event(
          em,
          RecordEvents.DIAGNOSIS_ADDED,
          encounter,
          saved,
          actor,
        );
        return this.detail.of(encounter, em);
      });
    } catch (error) {
      throw toDuplicate(error);
    }
  }

  // Not an event: wording, notes and which one is primary are clinical
  // details, not actions worth a history line
  async update(
    encounterId: string,
    diagnosisId: string,
    dto: UpdateDiagnosisDto,
    actor: CurrentUserData,
  ): Promise<EncounterDetailResponse> {
    return this.dataSource.transaction(async (em) => {
      const encounter = await lockedOpenOwn(em, encounterId, actor, 'edit');
      const row = await findIn(em, encounter, diagnosisId);
      if (dto.type && dto.type !== row.type) {
        if (dto.type === DiagnosisType.PRIMARY && !row.icd10Code) {
          throw uncodedPrimary();
        }
        if (dto.type === DiagnosisType.PRIMARY) {
          await demotePrimary(em, encounter);
        }
        row.type = dto.type;
      }
      if (dto.description !== undefined) row.description = dto.description;
      if (dto.notes !== undefined) row.notes = dto.notes;
      await em.save(row);
      return this.detail.of(encounter, em);
    });
  }

  async remove(
    encounterId: string,
    diagnosisId: string,
    actor: CurrentUserData,
  ): Promise<EncounterDetailResponse> {
    return this.dataSource.transaction(async (em) => {
      const encounter = await lockedOpenOwn(em, encounterId, actor, 'edit');
      const row = await findIn(em, encounter, diagnosisId);
      await em.delete(Diagnosis, { id: row.id });
      await this.event(
        em,
        RecordEvents.DIAGNOSIS_REMOVED,
        encounter,
        row,
        actor,
      );
      return this.detail.of(encounter, em);
    });
  }

  private event(
    em: EntityManager,
    eventType:
      | typeof RecordEvents.DIAGNOSIS_ADDED
      | typeof RecordEvents.DIAGNOSIS_REMOVED,
    encounter: Encounter,
    row: Diagnosis,
    actor: CurrentUserData,
  ) {
    return this.outbox.add(em, {
      eventType,
      aggregateType: AGGREGATE,
      aggregateId: encounter.id,
      actor,
      payload: {
        ...toEncounterRef(encounter),
        diagnosisId: row.id,
        primary: row.type === DiagnosisType.PRIMARY,
      },
    });
  }
}

const rule = (message: string, reason: string, field: string) =>
  new AppException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    ErrorCode.BUSINESS_RULE,
    message,
    { reason, field },
  );

const uncodedPrimary = () =>
  rule(
    'An uncoded diagnosis cannot be the primary one',
    'UNCODED_PRIMARY',
    'type',
  );

// An uncoded diagnosis: free text, never primary
function uncoded(dto: AddDiagnosisDto): string {
  if (!dto.description) {
    throw new AppException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR,
      'Choose an ICD-10 code or write the diagnosis',
      { field: 'description' },
    );
  }
  if (dto.type === DiagnosisType.PRIMARY) throw uncodedPrimary();
  return dto.description;
}

// The code must exist, be switched on in the catalogue and be specific
// (a category like "J45" has subcodes — one of them is chosen)
async function usableTitle(em: EntityManager, code: string): Promise<string> {
  const [icd] = await em.query<
    { title_en: string; is_active: boolean; is_leaf: boolean }[]
  >('SELECT title_en, is_active, is_leaf FROM icd10_codes WHERE code = $1', [
    code,
  ]);
  if (!icd) {
    throw new AppException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR,
      'Unknown ICD-10 code',
      { field: 'icd10Code' },
    );
  }
  if (!icd.is_active) {
    throw rule(
      'This ICD-10 code is switched off in the catalogue',
      'CODE_INACTIVE',
      'icd10Code',
    );
  }
  if (!icd.is_leaf) {
    throw rule(
      'Choose a more specific code under this category',
      'CODE_NOT_SPECIFIC',
      'icd10Code',
    );
  }
  return icd.title_en;
}

// The visit is locked, so nobody else changes its primary meanwhile
async function demotePrimary(em: EntityManager, encounter: Encounter) {
  await em.update(
    Diagnosis,
    { encounterId: encounter.id, type: DiagnosisType.PRIMARY },
    { type: DiagnosisType.SECONDARY },
  );
}

async function findIn(
  em: EntityManager,
  encounter: Encounter,
  diagnosisId: string,
): Promise<Diagnosis> {
  const row = await em.findOneBy(Diagnosis, {
    id: diagnosisId,
    encounterId: encounter.id,
  });
  if (!row) throw notFound('Diagnosis');
  return row;
}
