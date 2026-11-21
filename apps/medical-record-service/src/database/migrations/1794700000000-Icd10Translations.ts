import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { MigrationInterface, QueryRunner } from 'typeorm';

// ICD-10 names in every language.
// - title → title_en (the official English title).
// - title_az_verified / title_ru_verified: false = machine-translated, an
//   admin has not checked it yet. Names written by hand (seed/icd10-names.ts,
//   the catalogue page) and the official Russian МКБ-10 text count as checked.
// - seed/icd10-translations.tsv.gz: code \t az \t ru \t ru_src (official |
//   translated) for every code; names that already exist are kept.
export class Icd10Translations1794700000000 implements MigrationInterface {
  name = 'Icd10Translations1794700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE icd10_codes RENAME COLUMN title TO title_en;
      ALTER TABLE icd10_codes
        ADD COLUMN title_az_verified boolean NOT NULL DEFAULT false,
        ADD COLUMN title_ru_verified boolean NOT NULL DEFAULT false;
      UPDATE icd10_codes SET title_az_verified = title_az IS NOT NULL,
                             title_ru_verified = title_ru IS NOT NULL;
    `);

    const file = join(__dirname, 'seed', 'icd10-translations.tsv.gz');
    if (existsSync(file)) {
      const rows = gunzipSync(readFileSync(file))
        .toString('utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split('\t'));
      for (let i = 0; i < rows.length; i += 2000) {
        const batch = rows.slice(i, i + 2000);
        await q.query(
          `UPDATE icd10_codes c SET
             title_az = coalesce(c.title_az, t.az),
             title_ru = coalesce(c.title_ru, t.ru),
             title_ru_verified = c.title_ru_verified OR (c.title_ru IS NULL AND t.official)
           FROM unnest($1::varchar[], $2::varchar[], $3::varchar[], $4::boolean[])
             AS t(code, az, ru, official)
           WHERE c.code = t.code`,
          [
            batch.map(([code]) => code),
            batch.map(([, az]) => az.slice(0, 255)),
            batch.map(([, , ru]) => ru.slice(0, 255)),
            batch.map(([, , , src]) => src === 'official'),
          ],
        );
      }
    }

    await q.query(`
      UPDATE icd10_codes SET search_text = icd10_fold(
        code || ' ' || title_en || ' ' || coalesce(title_az, '') || ' ' ||
        coalesce(title_ru, '') || ' ' || array_to_string(synonyms, ' '));
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE icd10_codes SET title_az = NULL WHERE NOT title_az_verified;
      UPDATE icd10_codes SET title_ru = NULL WHERE NOT title_ru_verified;
      ALTER TABLE icd10_codes DROP COLUMN title_az_verified, DROP COLUMN title_ru_verified;
      ALTER TABLE icd10_codes RENAME COLUMN title_en TO title;
      UPDATE icd10_codes SET search_text = icd10_fold(
        code || ' ' || title || ' ' || coalesce(title_az, '') || ' ' ||
        coalesce(title_ru, '') || ' ' || array_to_string(synonyms, ' '));
    `);
  }
}
