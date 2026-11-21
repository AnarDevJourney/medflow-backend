import type { AppointmentTypeName, EncounterPayload } from '@medflow/contracts';
import { Encounter } from './entities/encounter.entity';

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
