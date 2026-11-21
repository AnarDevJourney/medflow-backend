import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  AppException,
  ErrorCode,
  paginated,
  skipOf,
  type Paginated,
} from '@medflow/common';
import type { CurrentUserData } from '@medflow/common';
import { icd10AggregateId, RecordEvents } from '@medflow/contracts';
import { OutboxService } from '@medflow/kafka';
import { Icd10CatalogQueryDto, UpdateIcd10Dto } from './dto/icd10.dto';
import {
  ICD10_COLUMNS,
  Icd10Response,
  Icd10Row,
  toIcd10Response,
} from './icd10.mapper';

type Field =
  | 'isActive'
  | 'titleAz'
  | 'titleRu'
  | 'titleAzVerified'
  | 'titleRuVerified'
  | 'synonyms';
const COLUMN: Record<Field, string> = {
  isActive: 'is_active',
  titleAz: 'title_az',
  titleRu: 'title_ru',
  titleAzVerified: 'title_az_verified',
  titleRuVerified: 'title_ru_verified',
  synonyms: 'synonyms',
};

// Text matching shared by both searches: code prefix, then every name and
// synonym (folded: "ureyin" finds "ürəyin"), then similar words (typos).
// $1 = raw text, $2 = LIKE-escaped raw text.
const MATCH = `
  (c.code ILIKE $2 || '%'
   OR c.search_text LIKE '%' || q.pattern || '%'
   OR word_similarity(q.folded, c.search_text) > 0.3)`;
const QUERY = `(SELECT icd10_fold($1) AS folded,
  replace(replace(replace(icd10_fold($1), '\\', '\\\\'), '%', '\\%'), '_', '\\_') AS pattern) q`;
// Among matches, codes with a hand-checked Azerbaijani name come first
// (the curated, commonly used ones and those an admin reviewed), then the
// closest whole entry (similarity favours short, exact names)
const RANK = `(c.code ILIKE $2 || '%') DESC,
  (c.search_text LIKE '%' || q.pattern || '%') DESC,
  c.title_az_verified DESC,
  similarity(q.folded, c.search_text) DESC,
  word_similarity(q.folded, c.search_text) DESC, c.code`;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// The ICD-10 catalogue (~12 000 codes). Doctors search it; admins switch
// codes on and off and give them local names and synonyms — nobody
// creates codes (the list is the international standard).
@Injectable()
export class Icd10Service {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: OutboxService,
  ) {}

  // Autocomplete: active, specific codes only (a category like "J45" has
  // subcodes to choose from). Top 20.
  async search(text: string | undefined): Promise<Icd10Response[]> {
    const q = (text ?? '').trim();
    if (!q) return [];
    const rows = await this.dataSource.query<Icd10Row[]>(
      `SELECT ${prefixed()} FROM icd10_codes c, ${QUERY}
       WHERE c.is_active AND c.is_leaf AND ${MATCH}
       ORDER BY ${RANK} LIMIT 20`,
      [q, escapeLike(q)],
    );
    return rows.map(toIcd10Response);
  }

  // What this doctor diagnosed most in the last year (still active)
  async frequent(
    doctorId: string,
  ): Promise<(Icd10Response & { uses: number })[]> {
    const rows = await this.dataSource.query<(Icd10Row & { uses: number })[]>(
      `SELECT ${prefixed()}, f.uses FROM (
         SELECT d.icd10_code, count(*)::int AS uses
         FROM diagnoses d JOIN encounters e ON e.id = d.encounter_id
         WHERE e.doctor_id = $1 AND d.icd10_code IS NOT NULL
           AND d.created_at > now() - interval '365 days'
         GROUP BY d.icd10_code
       ) f JOIN icd10_codes c ON c.code = f.icd10_code
       WHERE c.is_active AND c.is_leaf
       ORDER BY f.uses DESC, c.code LIMIT 8`,
      [doctorId],
    );
    return rows.map((r) => ({ ...toIcd10Response(r), uses: r.uses }));
  }

  // The admin's list: by code; with a search the best match first
  async catalog(
    query: Icd10CatalogQueryDto,
  ): Promise<Paginated<Icd10Response>> {
    const q = (query.search ?? '').trim();
    const where: string[] = [];
    const params: unknown[] = q ? [q, escapeLike(q)] : [];
    if (q) where.push(MATCH);
    if (query.chapterNo) {
      params.push(query.chapterNo);
      where.push(`c.chapter_no = $${params.length}`);
    }
    if (query.status === 'active') where.push('c.is_active');
    if (query.status === 'inactive') where.push('NOT c.is_active');
    if (query.named)
      where.push('(c.title_az IS NOT NULL OR c.title_ru IS NOT NULL)');
    if (query.unverified) {
      where.push(
        '((c.title_az IS NOT NULL AND NOT c.title_az_verified) OR (c.title_ru IS NOT NULL AND NOT c.title_ru_verified))',
      );
    }
    const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const order = q ? RANK : 'c.code';
    const from = q ? `icd10_codes c, ${QUERY}` : 'icd10_codes c';

    const [{ total }] = await this.dataSource.query<{ total: number }[]>(
      `SELECT count(*)::int AS total FROM ${from} ${filter}`,
      params,
    );
    const rows = await this.dataSource.query<Icd10Row[]>(
      `SELECT ${prefixed()} FROM ${from} ${filter}
       ORDER BY ${order} LIMIT ${query.limit} OFFSET ${skipOf(query)}`,
      params,
    );
    return paginated(rows.map(toIcd10Response), total, query);
  }

  async update(
    code: string,
    dto: UpdateIcd10Dto,
    actor: CurrentUserData,
  ): Promise<Icd10Response> {
    return this.dataSource.transaction(async (em) => {
      const [row] = await em.query<Icd10Row[]>(
        `SELECT ${ICD10_COLUMNS} FROM icd10_codes WHERE code = $1 FOR UPDATE`,
        [code],
      );
      if (!row) {
        throw new AppException(
          HttpStatus.NOT_FOUND,
          ErrorCode.NOT_FOUND,
          'ICD-10 code not found',
        );
      }
      const synonyms = dto.synonyms && cleanSynonyms(dto.synonyms);
      const next: Record<Field, unknown> = {
        isActive: dto.isActive,
        titleAz: dto.titleAz,
        titleRu: dto.titleRu,
        // a name written by an admin counts as checked
        titleAzVerified:
          dto.titleAzVerified ??
          (dto.titleAz !== undefined && dto.titleAz !== row.title_az
            ? dto.titleAz !== null
            : undefined),
        titleRuVerified:
          dto.titleRuVerified ??
          (dto.titleRu !== undefined && dto.titleRu !== row.title_ru
            ? dto.titleRu !== null
            : undefined),
        synonyms,
      };
      const current: Record<Field, unknown> = {
        isActive: row.is_active,
        titleAz: row.title_az,
        titleRu: row.title_ru,
        titleAzVerified: row.title_az_verified,
        titleRuVerified: row.title_ru_verified,
        synonyms: row.synonyms,
      };
      const changed = (Object.keys(next) as Field[]).filter(
        (f) =>
          next[f] !== undefined &&
          JSON.stringify(next[f]) !== JSON.stringify(current[f]),
      );
      if (changed.length === 0) return toIcd10Response(row);

      const sets = changed.map((f, i) => `${COLUMN[f]} = $${i + 2}`);
      // UPDATE … RETURNING through TypeORM → [rows, affected]
      const [[updated]] = await em.query<[Icd10Row[], number]>(
        `UPDATE icd10_codes SET ${sets.join(', ')},
           updated_at = now(), updated_by = $${changed.length + 2},
           updated_by_name = $${changed.length + 3}
         WHERE code = $1 RETURNING ${ICD10_COLUMNS}`,
        [code, ...changed.map((f) => next[f]), actor.id, actor.name],
      );
      await em.query(
        `UPDATE icd10_codes SET search_text = icd10_fold(
           code || ' ' || title_en || ' ' || coalesce(title_az, '') || ' ' ||
           coalesce(title_ru, '') || ' ' || array_to_string(synonyms, ' '))
         WHERE code = $1`,
        [code],
      );
      await this.outbox.add(em, {
        eventType: RecordEvents.ICD10_UPDATED,
        aggregateType: 'ICD10_CODE',
        aggregateId: icd10AggregateId(code),
        actor,
        payload: {
          code,
          title: updated.title_en,
          changedFields: changed,
          isActive: updated.is_active,
        },
      });
      return toIcd10Response(updated);
    });
  }
}

const prefixed = () =>
  ICD10_COLUMNS.split(',')
    .map((c) => `c.${c.trim()}`)
    .join(', ');

// Trimmed, no blanks, no duplicates (case-insensitive), in the given order
function cleanSynonyms(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const value = raw.trim();
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}
