#!/usr/bin/env node
// Demo patients for local development (DOC 12 demo seed: 50 patients).
// Goes through the gateway like the UI does, so MRNs, events and the action
// history are real. Allergies / chronic conditions are written as an active
// doctor or nurse (an access token signed with the dev JWT secret).
// Safe to run again: a patient whose FIN (or, without one, name + birth
// date) already exists is skipped.
// Registration dates are then spread over the last 12 months (SQL), so the
// dashboard chart has something to show.
//
// Usage (Docker stack running): node scripts/seed-patients.mjs
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import jwt from 'jsonwebtoken';

const API = 'http://localhost:3000/api/v1';
const ADMIN = { email: 'admin@medflow.az', password: 'Admin12345' };

// ── helpers ─────────────────────────────────────────────────────────────────
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
const psql = (db, sql) =>
  sh('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'medflow', '-d', db, '-tAc', sql]);
// The gateway allows 100 requests a minute per IP — clear the counters now and then
const flushRateLimit = () =>
  sh('docker', [
    'compose', 'exec', '-T', 'redis', 'sh', '-c',
    "redis-cli --scan --pattern 'ratelimit:*' | xargs -r redis-cli del",
  ]);
let calls = 0;
async function call(method, path, { cookie, body } = {}) {
  if (++calls % 80 === 0) flushRateLimit();
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, data: json.data, error: json.error, headers: res.headers };
}

// Deterministic "random" so every run builds the same people. The people
// are all built first from one sequence; each patient's clinical data uses
// its own sequence, so skipping a patient on a re-run shifts nothing.
let seed = 20261114;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const reseed = (value) => {
  seed = value;
};
const pick = (list) => list[Math.floor(rand() * list.length)];
const chance = (p) => rand() < p;
const pad = (n, len = 2) => String(n).padStart(len, '0');

// ── people ──────────────────────────────────────────────────────────────────
const FEMALE = ['Leyla', 'Nərmin', 'Aysel', 'Günay', 'Səbinə', 'Lalə', 'Fidan', 'Könül', 'Aynur', 'Nigar',
  'Sevinc', 'Ülviyyə', 'Gülnar', 'Nərgiz', 'Aytən', 'Zəhra', 'Mədinə', 'Röya', 'Şəbnəm', 'Xədicə',
  'Elnarə', 'Türkan', 'Aida', 'Vüsalə', 'Səidə'];
const MALE = ['Elvin', 'Kənan', 'Rauf', 'Murad', 'Orxan', 'Tural', 'Rəşad', 'Emil', 'Vüsal', 'Fərid',
  'Cavid', 'Samir', 'Toğrul', 'Ramil', 'Nihad', 'Elçin', 'Anar', 'Rüstəm', 'Kamran', 'İlkin',
  'Səməd', 'Vüqar', 'Əli', 'Hüseyn', 'Ruslan'];
// Surname roots: -ov/-ev for men, -ova/-eva for women
const SURNAMES = ['Məmmədov', 'Həsənov', 'Əliyev', 'Quliyev', 'İsmayılov', 'Babayev', 'Səfərov',
  'Cəfərov', 'Hüseynov', 'Abbasov', 'Kərimov', 'Rzayev', 'Nəsirov', 'Qasımov', 'Orucov', 'Vəliyev',
  'Bayramov', 'Mustafayev', 'Süleymanov', 'Paşayev', 'Rəhimov', 'Novruzov', 'Zeynalov', 'Allahverdiyev'];
const FATHERS = ['Rəşid', 'Kamal', 'Tofiq', 'Vüqar', 'Elşən', 'Ramiz', 'Səməd', 'Fikrət', 'Natiq',
  'Arif', 'Mübariz', 'Eldar', 'Zaur', 'İlqar', 'Rafiq', 'Vaqif', 'Akif', 'Nadir'];
const STREETS = ['Nizami küç.', 'Füzuli küç.', 'Azadlıq pr.', 'Neftçilər pr.', 'Həsən bəy Zərdabi küç.',
  'Şərifzadə küç.', 'Babək pr.', 'Qara Qarayev pr.', 'Xətai pr.', 'Atatürk pr.', 'Səməd Vurğun küç.'];
const DISTRICTS = ['Nəsimi', 'Yasamal', 'Nərimanov', 'Xətai', 'Binəqədi', 'Səbail', 'Nizami', 'Sabunçu'];
const RELATIONS = { MALE: ['Atası', 'Qardaşı', 'Oğlu', 'Həyat yoldaşı'], FEMALE: ['Anası', 'Bacısı', 'Qızı', 'Həyat yoldaşı'] };
const BLOOD = ['A_POS', 'A_POS', 'O_POS', 'O_POS', 'B_POS', 'AB_POS', 'A_NEG', 'O_NEG', 'B_NEG', 'AB_NEG'];
const NOTES = ['Rus dilində danışmağa üstünlük verir.', 'Eşitmə qabiliyyəti zəifdir, yavaş danışın.',
  'Əlil arabasından istifadə edir.', 'Qəbula həmişə qızı ilə gəlir.', 'SMS ilə xatırlatma istəyir.'];
const TRANSLIT = { ə: 'e', ı: 'i', ö: 'o', ü: 'u', ş: 's', ç: 'c', ğ: 'g', İ: 'i', Ə: 'e', Ş: 's', Ç: 'c', Ü: 'u', Ö: 'o', Ğ: 'g' };
const latin = (s) => [...s].map((c) => TRANSLIT[c] ?? c).join('').toLowerCase();

const ALLERGIES = [
  ['Penisillin', 'DRUG', 'SEVERE', 'Anafilaksiya'],
  ['Amoksisillin', 'DRUG', 'MODERATE', 'Dəri səpgisi'],
  ['Aspirin', 'DRUG', 'MODERATE', 'Nəfəs darlığı'],
  ['İbuprofen', 'DRUG', 'MILD', 'Mədə ağrısı'],
  ['Sulfanilamidlər', 'DRUG', 'SEVERE', 'Quincke ödemi'],
  ['Fıstıq', 'FOOD', 'SEVERE', 'Anafilaksiya'],
  ['Süd zülalı', 'FOOD', 'MILD', 'Qarın köpü'],
  ['Yumurta', 'FOOD', 'MODERATE', 'Övrə'],
  ['Dəniz məhsulları', 'FOOD', 'MODERATE', 'Dodaqlarda şişkinlik'],
  ['Lateks', 'ENVIRONMENTAL', 'MODERATE', 'Kontakt dermatit'],
  ['Ev tozu gənəsi', 'ENVIRONMENTAL', 'MILD', 'Asqırma, burun axması'],
  ['Arı sancması', 'OTHER', 'SEVERE', 'Anafilaksiya'],
];
const CONDITIONS = [
  ['2-ci tip şəkərli diabet', 'E11', 'Metformin qəbul edir'],
  ['Arterial hipertenziya', 'I10', 'Lizinopril 10 mq'],
  ['Bronxial astma', 'J45', 'Salbutamol inhalyatoru'],
  ['Hipotireoz', 'E03.9', 'L-tiroksin 50 mkq'],
  ['Xroniki qastrit', 'K29.5', null],
  ['Dəmir çatışmazlığı anemiyası', 'D50.9', 'Dəmir preparatı'],
  ['Osteoartroz', 'M19.9', null],
  ['Miqren', 'G43.9', 'Tutmalar ayda 1–2 dəfə'],
  ['Xroniki böyrək xəstəliyi', 'N18.3', 'Nefroloq nəzarətində'],
  ['İşemik ürək xəstəliyi', 'I25.9', 'Kardioloq nəzarətində'],
];

function buildPatient(i) {
  const gender = i % 2 === 0 ? 'FEMALE' : 'MALE';
  const firstName = gender === 'FEMALE' ? FEMALE[(i / 2) % FEMALE.length | 0] : MALE[((i - 1) / 2) % MALE.length | 0];
  const root = pick(SURNAMES);
  const lastName = gender === 'FEMALE' ? `${root}a` : root;
  // Ages 0–88, weighted to adults
  const age = chance(0.15) ? Math.floor(rand() * 18) : chance(0.2) ? 65 + Math.floor(rand() * 24) : 18 + Math.floor(rand() * 47);
  const year = new Date().getFullYear() - age - 1;
  const dateOfBirth = `${year}-${pad(1 + Math.floor(rand() * 12))}-${pad(1 + Math.floor(rand() * 28))}`;
  const prefix = pick(['50', '51', '55', '70', '77', '99']);
  const phone = `+994 ${prefix} ${pad(100 + Math.floor(rand() * 900), 3)} ${pad(Math.floor(rand() * 100))} ${pad(Math.floor(rand() * 100))}`;
  const fin = `${pad(i + 1)}MF${String.fromCharCode(65 + (i % 26))}${pad(Math.floor(rand() * 100))}`.slice(0, 7).toUpperCase();
  const adult = age >= 18;
  return {
    firstName,
    lastName,
    fatherName: chance(0.9) ? pick(FATHERS) : null,
    finCode: adult || chance(0.5) ? fin : null, // children often have no FIN yet
    dateOfBirth,
    gender,
    bloodType: chance(0.75) ? pick(BLOOD) : null,
    phone,
    email: adult && chance(0.6) ? `${latin(firstName)}.${latin(root)}${i}@mail.az` : null,
    address: chance(0.8) ? `Bakı, ${pick(DISTRICTS)} r., ${pick(STREETS)} ${1 + Math.floor(rand() * 120)}` : null,
    emergencyContactName: chance(0.7) ? `${pick(chance(0.5) ? FEMALE : MALE)} ${root}${chance(0.5) ? 'a' : ''}` : null,
    emergencyContactPhone: null,
    emergencyContactRelation: null,
    notes: chance(0.12) ? pick(NOTES) : null,
  };
}

// ── run ─────────────────────────────────────────────────────────────────────
flushRateLimit();
const login = await call('POST', '/auth/login', { body: ADMIN });
if (login.status !== 200) throw new Error(`Admin login failed (${login.status}) — is the stack running?`);
const adminCookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

// An active doctor and nurse write the clinical summary
const secret = readFileSync('.env', 'utf8').match(/^JWT_ACCESS_SECRET=(.+)$/m)?.[1]?.trim();
const clinician = (role) => {
  const row = psql('auth_db', `select id, first_name, last_name, email from users where role='${role}' and status='ACTIVE' and first_name || last_name !~* 'test' order by created_at limit 1`);
  if (!row) return null;
  const [id, first, last, email] = row.split('|');
  const token = jwt.sign(
    { sub: id, role, name: `${first} ${last}`, email, jti: randomUUID(), iatMs: Date.now() },
    secret,
    { expiresIn: 900 },
  );
  return { cookie: `access_token=${token}`, name: `${first} ${last}` };
};
// Accounts whose name says "test" (left by the e2e scripts) are not used;
// without a real nurse the doctor writes everything
const doctor = clinician('DOCTOR');
if (!doctor) throw new Error('No active doctor account to write clinical data');
const nurse = clinician('NURSE') ?? doctor;

const TOTAL = 50;
let created = 0, skipped = 0, allergies = 0, conditions = 0;
const seeded = [];
const people = Array.from({ length: TOTAL }, (_, i) => {
  const p = buildPatient(i);
  if (p.emergencyContactName) {
    p.emergencyContactPhone = `+994 ${pick(['50', '55', '70'])} ${pad(100 + Math.floor(rand() * 900), 3)} ${pad(Math.floor(rand() * 100))} ${pad(Math.floor(rand() * 100))}`;
    p.emergencyContactRelation = pick(RELATIONS[p.gender]);
  }
  return p;
});
for (let i = 0; i < TOTAL; i++) {
  const p = people[i];
  // Without a FIN (children) the same name + birth date means already seeded
  if (!p.finCode) {
    const q = encodeURIComponent(`${p.firstName} ${p.lastName}`);
    const found = await call('GET', `/patients?search=${q}&isActive=true&limit=20`, { cookie: adminCookie });
    if (found.data?.items.some((x) => x.dateOfBirth === p.dateOfBirth && x.lastName === p.lastName)) {
      skipped++;
      continue;
    }
  }
  const res = await call('POST', '/patients', { cookie: adminCookie, body: p });
  if (res.status === 409) { skipped++; continue; }
  if (res.status !== 201) throw new Error(`Patient ${i}: ${res.status} ${JSON.stringify(res.error)}`);
  created++;
  const id = res.data.id;
  seeded.push(id);
  reseed(1000 + i); // this patient's own sequence for the clinical data

  // ~40 % with allergies, ~40 % with chronic conditions (older people more often)
  const age = new Date().getFullYear() - Number(p.dateOfBirth.slice(0, 4));
  if (chance(0.4)) {
    const count = chance(0.3) ? 2 : 1;
    const used = new Set();
    for (let k = 0; k < count; k++) {
      const [allergen, category, severity, reaction] = pick(ALLERGIES);
      if (used.has(allergen)) continue;
      used.add(allergen);
      const r = await call('POST', `/patients/${id}/allergies`, {
        cookie: (k % 2 ? nurse : doctor).cookie,
        body: { allergen, category, severity, reaction },
      });
      if (r.status === 201) allergies++;
    }
  }
  if (chance(age > 50 ? 0.75 : 0.25)) {
    const count = age > 60 && chance(0.5) ? 2 : 1;
    const used = new Set();
    for (let k = 0; k < count; k++) {
      const [name, icd10Code, notes] = pick(CONDITIONS);
      if (used.has(name)) continue;
      used.add(name);
      const diagnosedYear = Math.max(Number(p.dateOfBirth.slice(0, 4)) + 1, new Date().getFullYear() - 1 - Math.floor(rand() * 12));
      const r = await call('POST', `/patients/${id}/conditions`, {
        cookie: doctor.cookie,
        body: {
          name,
          icd10Code,
          diagnosedOn: `${diagnosedYear}-${pad(1 + Math.floor(rand() * 12))}-${pad(1 + Math.floor(rand() * 28))}`,
          status: chance(0.15) ? 'RESOLVED' : 'ACTIVE',
          notes,
        },
      });
      if (r.status === 201) conditions++;
    }
  }
}

// Two records deactivated (a duplicate and a deceased patient)
for (const id of seeded.slice(-2)) {
  await call('PATCH', `/patients/${id}/deactivate`, { cookie: adminCookie });
}

// Registration dates over the last 12 months (only the patients made now)
if (seeded.length > 0) {
  const ids = seeded.map((id) => `'${id}'`).join(',');
  psql('patient_db', `update patients set created_at = now() - (floor(random() * 330) || ' days')::interval - (floor(random() * 10) || ' hours')::interval where id in (${ids}) and created_at > now() - interval '1 hour'`);
  // A few registered this month, so the "new this month" tile is not empty
  psql('patient_db', `update patients set created_at = now() - (floor(random() * 10) || ' days')::interval where id in (${seeded.slice(0, 4).map((id) => `'${id}'`).join(',')})`);
}
flushRateLimit();

console.log(`Patients: ${created} created, ${skipped} skipped (already there)`);
const writers = [...new Set([doctor.name, nurse.name])].join(' / ');
console.log(`Allergies: ${allergies} · chronic conditions: ${conditions} (written as ${writers})`);
