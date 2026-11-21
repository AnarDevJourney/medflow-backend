import type { AppointmentTypeName, EncounterPayload } from '@medflow/contracts';
import { Diagnosis } from './entities/diagnosis.entity';
import { Encounter } from './entities/encounter.entity';
import { VitalSigns } from './entities/vital-signs.entity';

export interface EncounterResponse {
  id: string;
  appointmentId: string;
  patientId: string;
  patientName: string;
  patientMrn: string;
  doctorId: string;
  doctorName: string;
  departmentId: string;
  departmentName: string;
  departmentCode: string;
  appointmentType: string;
  status: string;
  chiefComplaint: string | null;
  examinationNotes: string | null;
  treatmentPlan: string | null;
  followUpInDays: number | null;
  startedAt: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const toEncounterResponse = (row: Encounter): EncounterResponse => ({
  id: row.id,
  appointmentId: row.appointmentId,
  patientId: row.patientId,
  patientName: row.patientName,
  patientMrn: row.patientMrn,
  doctorId: row.doctorId,
  doctorName: row.doctorName,
  departmentId: row.departmentId,
  departmentName: row.departmentName,
  departmentCode: row.departmentCode,
  appointmentType: row.appointmentType,
  status: row.status,
  chiefComplaint: row.chiefComplaint,
  examinationNotes: row.examinationNotes,
  treatmentPlan: row.treatmentPlan,
  followUpInDays: row.followUpInDays,
  startedAt: row.startedAt.toISOString(),
  closedAt: row.closedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export const toEncounterPayload = (row: Encounter): EncounterPayload => ({
  encounterId: row.id,
  appointmentId: row.appointmentId,
  patientId: row.patientId,
  patientName: row.patientName,
  patientMrn: row.patientMrn,
  doctorId: row.doctorId,
  doctorName: row.doctorName,
  departmentId: row.departmentId,
  departmentName: row.departmentName,
  departmentCode: row.departmentCode,
  appointmentType: row.appointmentType as AppointmentTypeName,
  startedAt: row.startedAt.toISOString(),
});

export interface VitalsResponse {
  id: string;
  temperatureC: number | null;
  systolicBp: number | null;
  diastolicBp: number | null;
  heartRate: number | null;
  respiratoryRate: number | null;
  oxygenSaturation: number | null;
  weightKg: number | null;
  heightCm: number | null;
  bmi: number | null;
  recordedBy: string;
  recordedByName: string;
  recordedAt: string;
}

export const toVitalsResponse = (row: VitalSigns): VitalsResponse => ({
  id: row.id,
  temperatureC: row.temperatureC,
  systolicBp: row.systolicBp,
  diastolicBp: row.diastolicBp,
  heartRate: row.heartRate,
  respiratoryRate: row.respiratoryRate,
  oxygenSaturation: row.oxygenSaturation,
  weightKg: row.weightKg,
  heightCm: row.heightCm,
  bmi: row.bmi,
  recordedBy: row.recordedBy,
  recordedByName: row.recordedByName,
  recordedAt: row.recordedAt.toISOString(),
});

export interface Icd10Titles {
  titleEn: string;
  titleAz: string | null;
  titleRu: string | null;
}

export interface DiagnosisResponse {
  id: string;
  // null = uncoded (free text)
  icd10Code: string | null;
  // the ICD-10 names as listed (description may be refined by the doctor)
  icd10TitleEn: string | null;
  icd10TitleAz: string | null;
  icd10TitleRu: string | null;
  description: string;
  type: string;
  notes: string | null;
  createdAt: string;
}

export const toDiagnosisResponse = (
  row: Diagnosis,
  icd: Icd10Titles | undefined,
): DiagnosisResponse => ({
  id: row.id,
  icd10Code: row.icd10Code,
  icd10TitleEn: icd?.titleEn ?? null,
  icd10TitleAz: icd?.titleAz ?? null,
  icd10TitleRu: icd?.titleRu ?? null,
  description: row.description,
  type: row.type,
  notes: row.notes,
  createdAt: row.createdAt.toISOString(),
});

// GET /encounters/:id and every write in a visit: the visit with its
// measurements (newest first) and diagnoses (primary first)
export interface EncounterDetailResponse extends EncounterResponse {
  vitals: VitalsResponse[];
  diagnoses: DiagnosisResponse[];
}
