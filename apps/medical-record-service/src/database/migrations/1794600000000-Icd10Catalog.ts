import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { MigrationInterface, QueryRunner } from 'typeorm';
import { chapterOf, ICD10_CHAPTERS, ICD10_NAMES } from './seed/icd10-names';

// Phase 8.2 follow-up — the full ICD-10 list and a catalogue admins manage.
// - ~12 000 codes at WHO depth (seed/icd10.tsv.gz, built by
//   scripts/build-icd10-seed.mjs). Existing codes keep their titles.
// - is_leaf: a category with subcategories is not picked for a diagnosis.
// - is_active, title_az, title_ru, synonyms: set by admins (never new codes).
// - search_text: code + every name + synonyms, lower-case with Azerbaijani
//   letters folded (ə → e …), trigram-indexed for the autocomplete.
// - diagnoses.icd10_code nullable: an uncoded (free-text) diagnosis, only
//   as SECONDARY — the primary one is always coded (statistics, billing).
export class Icd10Catalog1794600000000 implements MigrationInterface {
  name = 'Icd10Catalog1794600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE FUNCTION icd10_fold(value text) RETURNS text
        LANGUAGE sql IMMUTABLE PARALLEL SAFE
        RETURN translate(lower(translate(value, 'İIƏ', 'iie')), 'əıöüşçğё', 'eiouscgе');

      ALTER TABLE icd10_codes
        ADD COLUMN chapter_no      smallint,
        ADD COLUMN is_leaf         boolean      NOT NULL DEFAULT true,
        ADD COLUMN is_active       boolean      NOT NULL DEFAULT true,
        ADD COLUMN title_az        varchar(255),
        ADD COLUMN title_ru        varchar(255),
        ADD COLUMN synonyms        text[]       NOT NULL DEFAULT '{}',
        ADD COLUMN search_text     text         NOT NULL DEFAULT '',
        ADD COLUMN updated_at      timestamptz,
        ADD COLUMN updated_by      uuid,
        ADD COLUMN updated_by_name varchar(200);
    `);

    // The full list (titles of codes already there are kept)
    const lines = gunzipSync(
      readFileSync(join(__dirname, 'seed', 'icd10.tsv.gz')),
    )
      .toString('utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t'));
    for (let i = 0; i < lines.length; i += 2000) {
      const batch = lines.slice(i, i + 2000);
      await q.query(
        `INSERT INTO icd10_codes (code, title, chapter, is_leaf)
         SELECT * FROM unnest($1::varchar[], $2::varchar[], $3::varchar[], $4::boolean[])
         ON CONFLICT (code) DO UPDATE SET is_leaf = EXCLUDED.is_leaf`,
        [
          batch.map(([code]) => code),
          batch.map(([, title]) => title.slice(0, 255)),
          batch.map(([code]) => chapterOf(code)?.[3] ?? 'Other'),
          batch.map(([, , leaf]) => leaf === '1'),
        ],
      );
    }

    // One chapter name per chapter (the old seed used short names)
    for (const [no, from, to, title] of ICD10_CHAPTERS) {
      await q.query(
        `UPDATE icd10_codes SET chapter_no = $1, chapter = $2
         WHERE left(code, 3) BETWEEN $3 AND $4`,
        [no, title, from, to],
      );
    }

    for (const [code, az, ru, synonyms] of ICD10_NAMES) {
      await q.query(
        `UPDATE icd10_codes SET title_az = $2, title_ru = $3, synonyms = $4 WHERE code = $1`,
        [code, az, ru, synonyms],
      );
    }

    await q.query(`
      UPDATE icd10_codes SET search_text = icd10_fold(
        code || ' ' || title || ' ' || coalesce(title_az, '') || ' ' ||
        coalesce(title_ru, '') || ' ' || array_to_string(synonyms, ' '));

      DROP INDEX idx_icd10_title_trgm;
      CREATE INDEX idx_icd10_search_trgm ON icd10_codes USING gin (search_text gin_trgm_ops);
      CREATE INDEX idx_icd10_chapter ON icd10_codes (chapter_no, code);

      ALTER TABLE diagnoses ALTER COLUMN icd10_code DROP NOT NULL;
      ALTER TABLE diagnoses ADD CONSTRAINT chk_diagnoses_primary_coded
        CHECK (icd10_code IS NOT NULL OR type = 'SECONDARY');
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DELETE FROM diagnoses WHERE icd10_code IS NULL;
      ALTER TABLE diagnoses DROP CONSTRAINT chk_diagnoses_primary_coded;
      ALTER TABLE diagnoses ALTER COLUMN icd10_code SET NOT NULL;

      DROP INDEX idx_icd10_chapter;
      DROP INDEX idx_icd10_search_trgm;
      CREATE INDEX idx_icd10_title_trgm ON icd10_codes USING gin (title gin_trgm_ops);

      DELETE FROM icd10_codes c
      WHERE NOT EXISTS (SELECT 1 FROM diagnoses d WHERE d.icd10_code = c.code)
        AND c.title_az IS NULL;

      ALTER TABLE icd10_codes
        DROP COLUMN chapter_no, DROP COLUMN is_leaf, DROP COLUMN is_active,
        DROP COLUMN title_az, DROP COLUMN title_ru, DROP COLUMN synonyms,
        DROP COLUMN search_text, DROP COLUMN updated_at, DROP COLUMN updated_by,
        DROP COLUMN updated_by_name;
      DROP FUNCTION icd10_fold(text);
    `);
  }
}
