import type { AppointmentPayload } from '@medflow/contracts';
import { Appointment } from './entities/appointment.entity';

export interface AppointmentResponse {
  id: string;
  patientId: string;
  patientName: string;
  patientMrn: string;
  patientPhone: string;
  patientEmail: string | null;
  doctorId: string;
  doctorName: string;
  departmentId: string;
  departmentName: string;
  departmentCode: string;
  startsAt: string;
  endsAt: string;
  type: string;
  status: string;
  reason: string | null;
  notes: string | null;
  encounterId: string | null;
  checkedInAt: string | null;
  checkedInByName: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
  cancellationReason: string | null;
  createdByName: string | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

export const toAppointmentResponse = (
  row: Appointment,
): AppointmentResponse => ({
  id: row.id,
  patientId: row.patientId,
  patientName: row.patientName,
  patientMrn: row.patientMrn,
  patientPhone: row.patientPhone,
  patientEmail: row.patientEmail,
  doctorId: row.doctorId,
  doctorName: row.doctorName,
  departmentId: row.departmentId,
  departmentName: row.departmentName,
  departmentCode: row.departmentCode,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt.toISOString(),
  type: row.type,
  status: row.status,
  reason: row.reason,
  notes: row.notes,
  encounterId: row.encounterId,
  checkedInAt: iso(row.checkedInAt),
  checkedInByName: row.checkedInByName,
  startedAt: iso(row.startedAt),
  completedAt: iso(row.completedAt),
  cancelledAt: iso(row.cancelledAt),
  cancelledByName: row.cancelledByName,
  cancellationReason: row.cancellationReason,
  createdByName: row.createdByName,
  updatedByName: row.updatedByName,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export const toAppointmentPayload = (row: Appointment): AppointmentPayload => ({
  appointmentId: row.id,
  patientId: row.patientId,
  patientName: row.patientName,
  patientMrn: row.patientMrn,
  patientEmail: row.patientEmail,
  doctorId: row.doctorId,
  doctorName: row.doctorName,
  departmentId: row.departmentId,
  departmentName: row.departmentName,
  departmentCode: row.departmentCode,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt.toISOString(),
  type: row.type,
});
