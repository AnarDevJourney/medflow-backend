import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import {
  AppException,
  CurrentUserData,
  ErrorCode,
  likePattern,
  Paginated,
  paginated,
  parseSort,
  skipOf,
} from '@medflow/common';
import { PatientEvents } from '@medflow/contracts';
import { OutboxService } from '@medflow/kafka';
import { CreatePatientDto } from './dto/create-patient.dto';
import {
  ListPatientsQueryDto,
  PATIENT_SORT_FIELDS,
} from './dto/list-patients-query.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { Patient } from './entities/patient.entity';
import {
  clinicToday,
  formatMrn,
  mrnOf,
  searchKey,
  PatientResponse,
  toPatientPayload,
  toPatientResponse,
} from './patient.mapper';

const AGGREGATE = 'PATIENT';
// Indexed (pg_trgm GIN); Azerbaijani letters folded, see the migration
const SEARCH_NAME =
  'patient_search_name(patient.first_name, patient.last_name)';
// How close a typo may be to still match a name (pg_trgm word_similarity)
const FUZZY_THRESHOLD = 0.35;
const OLDEST_BIRTH_DATE = '1900-01-01';

const EDITABLE_FIELDS = [
  'firstName',
  'lastName',
  'fatherName',
  'finCode',
  'dateOfBirth',
  'gender',
  'bloodType',
  'phone',
  'email',
  'address',
  'emergencyContactName',
  'emergencyContactPhone',
  'emergencyContactRelation',
  'notes',
] as const;

// PATCH may not clear these (IsOptional lets null through the validators)
const REQUIRED_FIELDS = [
  'firstName',
  'lastName',
  'dateOfBirth',
  'gender',
  'phone',
] as const;

// Sort key → column(s)
const SORT_COLUMNS: Record<(typeof PATIENT_SORT_FIELDS)[number], string[]> = {
  createdAt: ['patient.createdAt'],
  name: ['patient.lastName', 'patient.firstName'],
  mrn: ['patient.mrn'],
  dateOfBirth: ['patient.dateOfBirth'],
};

const notFound = () =>
  new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'Patient not found',
  );

const isFinConflict = (error: unknown): boolean =>
  error instanceof QueryFailedError &&
  (error.driverError as { constraint?: string }).constraint ===
    'uq_patients_fin';

@Injectable()
export class PatientsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Patient)
    private readonly patients: Repository<Patient>,
    private readonly outbox: OutboxService,
  ) {}

  // Search-first list (DOC 6.1): fuzzy name, exact MRN / FIN / phone
  async list(query: ListPatientsQueryDto): Promise<Paginated<PatientResponse>> {
    const qb = this.patients.createQueryBuilder('patient');
    if (query.isActive !== undefined) {
      qb.andWhere('patient.isActive = :isActive', { isActive: query.isActive });
    }
    if (query.gender) {
      qb.andWhere('patient.gender = :gender', { gender: query.gender });
    }

    const search = query.search;
    if (search) {
      const exact: string[] = [];
      const mrn = mrnOf(search);
      if (mrn) exact.push('patient.mrn = :mrn');
      const fin = search.toUpperCase();
      if (/^[A-Z0-9]{7}$/.test(fin)) exact.push('patient.fin_code = :fin');
      // Phone typed any way: '050 123 45 67' finds '+994 50 123 45 67'
      // (the last 9 digits are the number without country / trunk prefix)
      const digits = search.replace(/\D/g, '');
      if (digits.length >= 7 && /^[\d\s()+-]+$/.test(search)) {
        exact.push(`regexp_replace(patient.phone, '\\D', '', 'g') LIKE :phone`);
      }
      const exactSql = exact.length ? exact.join(' OR ') : 'false';
      const key = searchKey(search);
      qb.setParameters({
        search: key,
        like: likePattern(key),
        rawLike: likePattern(search),
        prefix: `${key.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
        mrn,
        fin,
        phone: `%${digits.slice(-9)}`,
        threshold: FUZZY_THRESHOLD,
      });
      qb.andWhere(
        `(${exactSql}
          OR ${SEARCH_NAME} LIKE :like
          OR word_similarity(:search, ${SEARCH_NAME}) >= :threshold)`,
      );
      if (!query.sort) {
        // Best match first: exact ids, then names starting with the text,
        // then containing it, then typos by closeness
        qb.addSelect(
          `CASE WHEN ${exactSql} THEN 0
                WHEN ${SEARCH_NAME} LIKE :prefix
                  OR ${SEARCH_NAME} LIKE '% ' || :prefix THEN 1
                WHEN ${SEARCH_NAME} LIKE :like THEN 2
                ELSE 3 END`,
          'match_rank',
        )
          .addSelect(`word_similarity(:search, ${SEARCH_NAME})`, 'match_score')
          // the exact spelling before its variants (Leyla before Leila)
          .addSelect(
            `(patient.first_name || ' ' || patient.last_name) ILIKE :rawLike`,
            'match_exact',
          )
          .orderBy('match_rank', 'ASC')
          .addOrderBy('match_exact', 'DESC')
          .addOrderBy('match_score', 'DESC')
          .addOrderBy('patient.createdAt', 'DESC');
      }
    }

    if (!search || query.sort) {
      // Newest first by default, like every list in the app
      const sort = parseSort(query.sort, PATIENT_SORT_FIELDS, {
        createdAt: 'DESC',
      });
      for (const [field, direction] of Object.entries(sort)) {
        for (const column of SORT_COLUMNS[field as keyof typeof SORT_COLUMNS]) {
          qb.addOrderBy(column, direction);
        }
      }
    }
    qb.addOrderBy('patient.id', 'ASC'); // stable pages when sort values tie

    const [items, total] = await qb
      .skip(skipOf(query))
      .take(query.limit)
      .getManyAndCount();
    return paginated(items.map(toPatientResponse), total, query);
  }

  async findOne(id: string): Promise<PatientResponse> {
    const row = await this.patients.findOneBy({ id });
    if (!row) throw notFound();
    return toPatientResponse(row);
  }

  // MRN from the sequence + the patient + patient.registered, one transaction
  async create(
    dto: CreatePatientDto,
    actor: CurrentUserData,
  ): Promise<PatientResponse> {
    checkBirthDate(dto.dateOfBirth);
    try {
      const patient = await this.dataSource.transaction(async (em) => {
        const [{ n }] = await em.query<{ n: string }[]>(
          `SELECT nextval('patient_mrn_seq') AS n`,
        );
        const saved = await em.save(
          em.create(Patient, {
            ...dto,
            mrn: formatMrn(n),
            registeredBy: actor.id,
          }),
        );
        await this.outbox.add(em, {
          eventType: PatientEvents.PATIENT_REGISTERED,
          aggregateType: AGGREGATE,
          aggregateId: saved.id,
          actor,
          payload: toPatientPayload(saved),
        });
        return saved;
      });
      return toPatientResponse(patient);
    } catch (error) {
      throw await this.toFinConflict(error, dto.finCode);
    }
  }

  // Demographics. The row lock makes parallel edits run one after the
  // other, so each event lists what really changed. Nothing changed → no event.
  async update(
    id: string,
    dto: UpdatePatientDto,
    actor: CurrentUserData,
  ): Promise<PatientResponse> {
    const cleared = REQUIRED_FIELDS.filter((field) => dto[field] === null);
    if (cleared.length) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'Validation failed',
        cleared.map((field) => ({
          field,
          errors: [`${field} cannot be empty`],
        })),
      );
    }
    if (dto.dateOfBirth) checkBirthDate(dto.dateOfBirth);

    try {
      const patient = await this.dataSource.transaction(async (em) => {
        const row = await em.findOne(Patient, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!row) throw notFound();
        if (!row.isActive) {
          throw new AppException(
            HttpStatus.CONFLICT,
            ErrorCode.INVALID_STATUS,
            'An inactive patient record cannot be edited',
          );
        }

        const changedFields = EDITABLE_FIELDS.filter(
          (field) => dto[field] !== undefined && dto[field] !== row[field],
        );
        if (changedFields.length === 0) return row;

        em.merge(Patient, row, dto);
        const saved = await em.save(row);
        await this.outbox.add(em, {
          eventType: PatientEvents.PATIENT_UPDATED,
          aggregateType: AGGREGATE,
          aggregateId: saved.id,
          actor,
          payload: { ...toPatientPayload(saved), changedFields },
        });
        return saved;
      });
      return toPatientResponse(patient);
    } catch (error) {
      throw await this.toFinConflict(error, dto.finCode, id);
    }
  }

  // Duplicate or deceased record (ADMIN) — and back, when done by mistake
  async setActive(
    id: string,
    isActive: boolean,
    actor: CurrentUserData,
  ): Promise<PatientResponse> {
    const patient = await this.dataSource.transaction(async (em) => {
      const row = await em.findOne(Patient, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw notFound();
      if (row.isActive === isActive) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATUS,
          isActive
            ? 'Patient is already active'
            : 'Patient is already inactive',
        );
      }
      row.isActive = isActive;
      const saved = await em.save(row);
      await this.outbox.add(em, {
        eventType: isActive
          ? PatientEvents.PATIENT_REACTIVATED
          : PatientEvents.PATIENT_DEACTIVATED,
        aggregateType: AGGREGATE,
        aggregateId: saved.id,
        actor,
        payload: toPatientPayload(saved),
      });
      return saved;
    });
    return toPatientResponse(patient);
  }

  // Same FIN as another patient → 409 naming that patient, so the desk can
  // open the existing record instead of registering a duplicate (DOC 6.1)
  private async toFinConflict(
    error: unknown,
    finCode: string | null | undefined,
    selfId?: string,
  ): Promise<unknown> {
    if (!isFinConflict(error) || !finCode) return error;
    const existing = await this.patients.findOneBy({ finCode });
    if (!existing || existing.id === selfId) return error;
    return new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.CONFLICT,
      `A patient with this FIN already exists (${existing.mrn})`,
      {
        field: 'finCode',
        existingPatient: {
          id: existing.id,
          mrn: existing.mrn,
          firstName: existing.firstName,
          lastName: existing.lastName,
          isActive: existing.isActive,
        },
      },
    );
  }
}

// A birth date in the future or before 1900 → 422 for the form field
function checkBirthDate(date: string): void {
  if (date > clinicToday() || date < OLDEST_BIRTH_DATE) {
    throw new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      ErrorCode.BUSINESS_RULE,
      date > clinicToday()
        ? 'Date of birth cannot be in the future'
        : 'Date of birth is too far in the past',
      { field: 'dateOfBirth' },
    );
  }
}
