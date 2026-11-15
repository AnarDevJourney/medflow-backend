#!/usr/bin/env node
// Demo appointments for local development (DOC 12 demo seed: two weeks of
// appointments). Fills the schedules of the active doctors (with a
// department) around today:
//   • today and the next 7 days — booked through the gateway like the desk
//     does (free slots from /appointments/availability), so events, the
//     action history, reminder jobs and the patients' emails (Mailpit) are
//     real. About 55 % of the free slots are taken.
//   • the last 7 days — the API refuses past times, so these rows go in by
//     SQL with finished statuses: ~70 % completed, ~15 % no-show, ~15 %
//     cancelled. No events for them (nothing "happens" now).
// Deterministic: a slot is taken or not by a hash of doctor + time, so a
// second run picks the same slots and skips what exists. Appointments
// that are already there (e.g. booked by hand) are never touched.
//
// Usage (Docker stack running, patients seeded): node scripts/seed-appointments.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const API = 'http://localhost:3000/api/v1';
const ADMIN = { email: 'admin@medflow.az', password: 'Admin12345' };
const FUTURE_SHARE = 0.55;
const PAST_SHARE = 0.65;

// ── helpers ─────────────────────────────────────────────────────────────────
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const psql = (db, sql) =>
  sh('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'medflow', '-d', db, '-tAc', sql]);
// Long statements go through stdin (an argument this big hits E2BIG)
const psqlStdin = (db, sql) =>
  execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'medflow', '-d', db, '-tAq', '-v', 'ON_ERROR_STOP=1'],
    { encoding: 'utf8', input: sql, maxBuffer: 64 * 1024 * 1024 },
  ).trim();
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
const sqlText = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

// 0 ≤ x < 1 from a string — the same input always gives the same number
const hash01 = (key) => parseInt(createHash('sha1').update(key).digest('hex').slice(0, 8), 16) / 2 ** 32;
const pickBy = (key, list) => list[Math.floor(hash01(key) * list.length)];

// Clinic calendar (Asia/Baku, UTC+4 all year)
const clinicToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku' }).format(new Date());
const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const instant = (date, minutes) =>
  new Date(`${date}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00+04:00`);

const REASONS = {
  CARD: ['Sinə ağrısı', 'Təzyiq yüksəlir', 'Ürək döyüntüsü', 'EKQ nəticəsinin müzakirəsi', 'Nəfəs darlığı'],
  NEURO: ['Baş ağrısı', 'Başgicəllənmə', 'Yuxusuzluq', 'Əllərdə keyimə', 'Bel ağrısı'],
  PED: ['Qızdırma', 'Öskürək', 'Peyvənd məsləhəti', 'İştahsızlıq', 'Profilaktik müayinə'],
  ORTH: ['Diz ağrısı', 'Bel ağrısı', 'Çiyin ağrısı', 'Travmadan sonra kontrol', 'Ayaq biləyi zədəsi'],
  GEN: ['Ümumi müayinə', 'Halsızlıq', 'Analiz nəticələri', 'Soyuqdəymə', 'Təkrar müayinə'],
};
const TYPES = ['CONSULTATION', 'CONSULTATION', 'CONSULTATION', 'FOLLOW_UP', 'FOLLOW_UP', 'CHECK_UP'];
const CANCEL_REASONS = ['Pasiyent zəng edib imtina etdi', 'Pasiyent başqa vaxt istədi', 'Həkimin təcili əməliyyatı oldu'];

// ── start ───────────────────────────────────────────────────────────────────
flushRateLimit();
const login = await call('POST', '/auth/login', { body: ADMIN });
if (login.status !== 200) throw new Error(`admin login failed: ${login.status}`);
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const adminId = psql('auth_db', `select id from users where email = '${ADMIN.email}'`);

// Active patients (no e2e test records), with their snapshot fields
const patients = psql(
  'patient_db',
  `select id || '|' || first_name || ' ' || last_name || '|' || mrn || '|' || phone || '|' || coalesce(email, '')
     from patients where is_active and last_name not like 'Zt%' order by mrn`,
)
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [id, name, mrn, phone, email] = line.split('|');
    return { id, name, mrn, phone, email: email || null };
  });
if (patients.length < 10) throw new Error('Seed patients first: node scripts/seed-patients.mjs');

const today = clinicToday();
const pastFrom = addDays(today, -7);
const futureTo = addDays(today, 7);

// The doctors' days of the whole range from the calendar endpoint (it works
// for past days too) — skip e2e test doctors and doctors without department
async function doctorDays(from, to) {
  const res = await call('GET', `/appointments/calendar?from=${from}&to=${to}&includeCancelled=true`, { cookie });
  if (res.status !== 200) throw new Error(`calendar ${res.status}: ${res.error?.message}`);
  return res.data.doctors.filter((d) => d.departmentId && !/test/i.test(d.doctorName));
}

// ── past 7 days (SQL) ───────────────────────────────────────────────────────
let pastRows = 0;
const pastDoctors = await doctorDays(pastFrom, addDays(today, -1));
const values = [];
for (const doctor of pastDoctors) {
  for (const day of doctor.days) {
    if (!day.working) continue;
    const end = toMinutes(day.end);
    for (let m = toMinutes(day.start); m + day.slotMinutes <= end; m += day.slotMinutes) {
      const key = `${doctor.userId}|${day.date}|${m}`;
      if (hash01(`take|${key}`) >= PAST_SHARE) continue;
      const patient = pickBy(`patient|${key}`, patients);
      const startsAt = instant(day.date, m);
      const endsAt = new Date(startsAt.getTime() + day.slotMinutes * 60_000);
      const roll = hash01(`status|${key}`);
      const status = roll < 0.7 ? 'COMPLETED' : roll < 0.85 ? 'NO_SHOW' : 'CANCELLED';
      const createdAt = new Date(startsAt.getTime() - (1 + Math.floor(hash01(`created|${key}`) * 6)) * 86_400_000);
      const iso = (d) => sqlText(d.toISOString());
      values.push(`(
        ${sqlText(patient.id)}, ${sqlText(doctor.userId)}, ${sqlText(doctor.departmentId)},
        ${sqlText(patient.name)}, ${sqlText(patient.mrn)}, ${sqlText(patient.phone)}, ${sqlText(patient.email)},
        ${sqlText(doctor.doctorName)}, ${sqlText(doctor.departmentName)}, ${sqlText(doctor.departmentCode)},
        ${iso(startsAt)}, ${iso(endsAt)}, ${sqlText(pickBy(`type|${key}`, TYPES))}, '${status}',
        ${sqlText(pickBy(`reason|${key}`, REASONS[doctor.departmentCode] ?? REASONS.GEN))},
        ${status === 'COMPLETED' ? iso(new Date(startsAt.getTime() - 7 * 60_000)) : 'NULL'},
        ${status === 'COMPLETED' ? sqlText('System Administrator') : 'NULL'},
        ${status === 'COMPLETED' ? iso(startsAt) : 'NULL'},
        ${status === 'COMPLETED' ? iso(endsAt) : 'NULL'},
        ${status === 'CANCELLED' ? iso(new Date(startsAt.getTime() - 86_400_000)) : 'NULL'},
        ${status === 'CANCELLED' ? sqlText('System Administrator') : 'NULL'},
        ${status === 'CANCELLED' ? sqlText(pickBy(`cancel|${key}`, CANCEL_REASONS)) : 'NULL'},
        ${sqlText(adminId)}, 'System Administrator', ${iso(createdAt)}, ${iso(createdAt)}
      )`);
    }
  }
}
// One statement per 200 rows; an existing appointment of the doctor at that
// time (any status) or a patient overlap → the row is skipped
for (let i = 0; i < values.length; i += 200) {
  const out = psqlStdin(
    'appointment_db',
    `WITH v (patient_id, doctor_id, department_id, patient_name, patient_mrn, patient_phone, patient_email,
             doctor_name, department_name, department_code, starts_at, ends_at, type, status, reason,
             checked_in_at, checked_in_by_name, started_at, completed_at, cancelled_at, cancelled_by_name,
             cancellation_reason, created_by, created_by_name, created_at, updated_at) AS (VALUES ${values.slice(i, i + 200).join(',')})
     INSERT INTO appointments (patient_id, doctor_id, department_id, patient_name, patient_mrn, patient_phone, patient_email,
             doctor_name, department_name, department_code, starts_at, ends_at, type, status, reason,
             checked_in_at, checked_in_by_name, started_at, completed_at, cancelled_at, cancelled_by_name,
             cancellation_reason, created_by, created_by_name, created_at, updated_at)
     SELECT patient_id::uuid, doctor_id::uuid, department_id::uuid, patient_name, patient_mrn, patient_phone, patient_email,
            doctor_name, department_name, department_code, starts_at::timestamptz, ends_at::timestamptz,
            type::appointment_type, status::appointment_status, reason,
            checked_in_at::timestamptz, checked_in_by_name, started_at::timestamptz, completed_at::timestamptz,
            cancelled_at::timestamptz, cancelled_by_name, cancellation_reason, created_by::uuid, created_by_name,
            created_at::timestamptz, updated_at::timestamptz
       FROM v
      WHERE NOT EXISTS (SELECT 1 FROM appointments a WHERE a.doctor_id = v.doctor_id::uuid AND a.starts_at = v.starts_at::timestamptz)
     ON CONFLICT DO NOTHING
     RETURNING 1;`,
  );
  pastRows += out ? out.split('\n').length : 0;
}
console.log(`past 7 days: ${pastRows} appointment(s) inserted (${values.length} planned)`);

// ── today + next 7 days (API) ───────────────────────────────────────────────
let booked = 0;
let skipped = 0;
const futureDoctors = await doctorDays(today, futureTo);
for (const doctor of futureDoctors) {
  for (const day of doctor.days) {
    if (!day.working) continue;
    const res = await call('GET', `/appointments/availability?doctorId=${doctor.userId}&date=${day.date}`, { cookie });
    if (res.status !== 200 || !res.data.working) continue;
    for (const slot of res.data.slots) {
      if (!slot.available) continue;
      const key = `${doctor.userId}|${slot.startsAt}`;
      if (hash01(`take|${key}`) >= FUTURE_SHARE) continue;
      // A patient already busy then → the next one in the list
      const first = Math.floor(hash01(`patient|${key}`) * patients.length);
      for (let tries = 0; tries < 5; tries++) {
        const patient = patients[(first + tries * 7) % patients.length];
        const r = await call('POST', '/appointments', {
          cookie,
          body: {
            patientId: patient.id,
            doctorId: doctor.userId,
            startsAt: slot.startsAt,
            type: pickBy(`type|${key}`, TYPES),
            reason: pickBy(`reason|${key}`, REASONS[doctor.departmentCode] ?? REASONS.GEN),
          },
        });
        if (r.status === 201) {
          booked++;
          break;
        }
        if (r.status !== 409 || r.error?.details?.conflict !== 'PATIENT') {
          skipped++;
          break;
        }
      }
    }
  }
}
console.log(`today + 7 days: ${booked} appointment(s) booked through the API, ${skipped} skipped`);
flushRateLimit();
