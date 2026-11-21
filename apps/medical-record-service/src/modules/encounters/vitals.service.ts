import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException, ErrorCode } from '@medflow/common';
import type { CurrentUserData } from '@medflow/common';
import { RecordEvents } from '@medflow/contracts';
import { OutboxService } from '@medflow/kafka';
import { RecordVitalsDto, VITAL_FIELDS } from './dto/vitals.dto';
import {
  AGGREGATE,
  lockedOpenForVitals,
  toEncounterRef,
} from './encounter-access';
import { EncounterDetailService } from './encounter-detail.service';
import { EncounterDetailResponse } from './encounter.mapper';
import { VitalSigns } from './entities/vital-signs.entity';

const invalid = (message: string, field: string) =>
  new AppException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.VALIDATION_ERROR,
    message,
    { field },
  );

// DOC 6.3 step 6: the doctor or a nurse saves a set of vitals in an open
// visit. Sets are never edited — a new measurement is a new set.
@Injectable()
export class VitalsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: OutboxService,
    private readonly detail: EncounterDetailService,
  ) {}

  async record(
    encounterId: string,
    dto: RecordVitalsDto,
    actor: CurrentUserData,
  ): Promise<EncounterDetailResponse> {
    if (VITAL_FIELDS.every((f) => dto[f] === undefined || dto[f] === null)) {
      throw invalid('Enter at least one measurement', 'vitals');
    }
    if (
      dto.systolicBp != null &&
      dto.diastolicBp != null &&
      dto.systolicBp <= dto.diastolicBp
    ) {
      throw invalid(
        'Systolic pressure must be higher than diastolic',
        'diastolicBp',
      );
    }

    return this.dataSource.transaction(async (em) => {
      const encounter = await lockedOpenForVitals(em, encounterId, actor);
      const values = Object.fromEntries(
        VITAL_FIELDS.map((f) => [f, dto[f] ?? null]),
      );
      const saved = await em.save(
        em.create(VitalSigns, {
          ...values,
          encounterId: encounter.id,
          patientId: encounter.patientId,
          recordedBy: actor.id,
          recordedByName: actor.name,
          recordedAt: new Date(),
        }),
      );
      await this.outbox.add(em, {
        eventType: RecordEvents.VITALS_RECORDED,
        aggregateType: AGGREGATE,
        aggregateId: encounter.id,
        actor,
        payload: {
          ...toEncounterRef(encounter),
          vitalsId: saved.id,
          recordedAt: saved.recordedAt.toISOString(),
        },
      });
      return this.detail.of(encounter, em);
    });
  }
}
