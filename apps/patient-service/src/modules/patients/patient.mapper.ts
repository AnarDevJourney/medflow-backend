import type { PatientPayload } from '@medflow/contracts';
import { Patient } from './entities/patient.entity';

export interface PatientResponse {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  fatherName: string | null;
  finCode: string | null;
  dateOfBirth: string; // 'YYYY-MM-DD'
  gender: string;
  bloodType: string | null;
  phone: string;
  email: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const toPatientResponse = (row: Patient): PatientResponse => ({
  id: row.id,
  mrn: row.mrn,
  firstName: row.firstName,
  lastName: row.lastName,
  fatherName: row.fatherName,
  finCode: row.finCode,
  dateOfBirth: row.dateOfBirth,
  gender: row.gender,
  bloodType: row.bloodType,
  phone: row.phone,
  email: row.email,
  address: row.address,
  emergencyContactName: row.emergencyContactName,
  emergencyContactPhone: row.emergencyContactPhone,
  emergencyContactRelation: row.emergencyContactRelation,
  notes: row.notes,
  isActive: row.isActive,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export const toPatientPayload = (row: Patient): PatientPayload => ({
  patientId: row.id,
  mrn: row.mrn,
  firstName: row.firstName,
  lastName: row.lastName,
  phone: row.phone,
  email: row.email,
});

// 7 → 'P-000007'. No truncation past a million: 'P-1000000'.
export const formatMrn = (n: number | string): string =>
  `P-${String(n).padStart(6, '0')}`;

// What a search may mean as an MRN: 'P-000123', 'p123', '123' → 'P-000123'
export const mrnOf = (search: string): string | null => {
  const match = /^(?:P-?)?(\d{1,9})$/i.exec(search);
  return match ? formatMrn(Number(match[1])) : null;
};

// "Today" in the clinic (DOC 12: Asia/Baku), as 'YYYY-MM-DD'
export const clinicToday = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku' }).format(
    new Date(),
  );

// The search text folded like the names in the index (SQL function
// patient_search_name, same mapping): ə / a → e, ı / İ / y → i, q / ğ → g,
// ö → o, ü → u, ş → s, ç → c. So 'Mammadova', 'Mamedova' and 'Məmmədova'
// are one name, as are 'Ismailova' / 'İsmayılova' and 'Guliyev' / 'Quliyev'.
const FROM = 'ƏəAaIıİYyÖöÜüŞşÇçĞğQq';
const TO = 'eeeeiiiiioouussccgggg';
export const searchKey = (text: string): string =>
  [...text]
    .map((c) => {
      const i = FROM.indexOf(c);
      return i === -1 ? c : TO[i];
    })
    .join('')
    .toLowerCase();
