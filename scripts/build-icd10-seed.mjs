// Builds the ICD-10 seed (apps/medical-record-service/src/database/migrations/seed/icd10.tsv.gz)
// from the CMS ICD-10-CM "order" file (public domain, US government):
//   https://www.cms.gov/medicare/coding-billing/icd-10-codes → "Code Descriptions in Tabular Order"
//   node scripts/build-icd10-seed.mjs path/to/icd10cm_order_2025.txt
// Only WHO depth is kept: 3-character categories and 4-character subcategories
// ("J45", "J45.9"), ~12 000 codes — the size of the WHO list used in Azerbaijan.
// A category with subcategories is not a leaf: a diagnosis uses the most
// specific code. Output lines: code \t title \t leaf (1|0).
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/build-icd10-seed.mjs <icd10cm_order_YYYY.txt>');
  process.exit(1);
}

// Fixed-width: order(5) _ code(7) _ header(1) _ short(60) _ long
const rows = [];
for (const line of readFileSync(file, 'latin1').split(/\r?\n/)) {
  const raw = line.slice(6, 13).trim();
  const title = line.slice(77).trim();
  if (!raw || raw.length > 4 || !title) continue;
  rows.push({ code: raw.length === 3 ? raw : `${raw.slice(0, 3)}.${raw.slice(3)}`, title });
}
const parents = new Set(rows.filter((r) => r.code.includes('.')).map((r) => r.code.slice(0, 3)));
const out = rows
  .map((r) => `${r.code}\t${r.title.replace(/\t/g, ' ')}\t${parents.has(r.code) ? 0 : 1}`)
  .join('\n');
const target = 'apps/medical-record-service/src/database/migrations/seed/icd10.tsv.gz';
writeFileSync(target, gzipSync(out + '\n', { level: 9 }));
console.log(`${rows.length} codes (${rows.length - parents.size} leaves) → ${target}`);
