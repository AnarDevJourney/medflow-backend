import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  EncounterDetailResponse,
  Icd10Titles,
  toDiagnosisResponse,
  toEncounterResponse,
  toVitalsResponse,
} from './encounter.mapper';
import { Diagnosis } from './entities/diagnosis.entity';
import { Encounter } from './entities/encounter.entity';
import { VitalSigns } from './entities/vital-signs.entity';

// Builds the full visit the API returns: notes + vitals + diagnoses. Every
// write in a visit answers with it, so the page simply replaces its copy.
@Injectable()
export class EncounterDetailService {
  constructor(private readonly dataSource: DataSource) {}

  async of(
    row: Encounter,
    em: EntityManager = this.dataSource.manager,
  ): Promise<EncounterDetailResponse> {
    const vitals = await em.find(VitalSigns, {
      where: { encounterId: row.id },
      order: { recordedAt: 'DESC', id: 'DESC' },
    });
    // PRIMARY sorts first (enum order), then in the order added
    const diagnoses = await em.find(Diagnosis, {
      where: { encounterId: row.id },
      order: { type: 'ASC', createdAt: 'ASC' },
    });
    const titles = new Map<string, Icd10Titles>();
    const codes = diagnoses.flatMap((d) => (d.icd10Code ? [d.icd10Code] : []));
    if (codes.length > 0) {
      const rows = await em.query<
        {
          code: string;
          title_en: string;
          title_az: string | null;
          title_ru: string | null;
        }[]
      >(
        'SELECT code, title_en, title_az, title_ru FROM icd10_codes WHERE code = ANY($1)',
        [codes],
      );
      for (const r of rows) {
        titles.set(r.code, {
          titleEn: r.title_en,
          titleAz: r.title_az,
          titleRu: r.title_ru,
        });
      }
    }
    return {
      ...toEncounterResponse(row),
      vitals: vitals.map(toVitalsResponse),
      diagnoses: diagnoses.map((d) =>
        toDiagnosisResponse(
          d,
          d.icd10Code ? titles.get(d.icd10Code) : undefined,
        ),
      ),
    };
  }
}
