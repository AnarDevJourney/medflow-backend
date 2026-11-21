import { HttpStatus } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AppException, ErrorCode } from '@medflow/common';
import type { CurrentUserData } from '@medflow/common';
import type { EncounterRefPayload } from '@medflow/contracts';
import { Encounter, EncounterStatus } from './entities/encounter.entity';

// Who may write what in a visit, shared by notes, vitals and diagnoses.

export const AGGREGATE = 'ENCOUNTER';

export const notFound = (what = 'Visit') =>
  new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    `${what} not found`,
  );

// Only the visit's doctor writes in it (DOC 4: "own DOCTOR")
export function assertDoctor(
  doctorId: string,
  actor: CurrentUserData,
  action: string,
): void {
  if (doctorId !== actor.id) {
    throw new AppException(
      HttpStatus.FORBIDDEN,
      ErrorCode.FORBIDDEN,
      `Only the appointment's doctor can ${action}`,
    );
  }
}

function assertOpen(row: Encounter, action: string): void {
  if (row.status !== EncounterStatus.OPEN) {
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.INVALID_STATUS,
      `Cannot ${action} a visit that is ${row.status}`,
      { status: row.status },
    );
  }
}

// The visit, locked until the transaction ends; must be open and the
// caller's own (notes, close, diagnoses)
export async function lockedOpenOwn(
  em: EntityManager,
  id: string,
  actor: CurrentUserData,
  action: string,
): Promise<Encounter> {
  const row = await em.findOne(Encounter, {
    where: { id },
    lock: { mode: 'pessimistic_write' },
  });
  if (!row) throw notFound();
  assertDoctor(row.doctorId, actor, `${action} this visit`);
  assertOpen(row, action);
  return row;
}

// Vitals (DOC 4: "own DOCTOR, NURSE"): anyone with vitals.record, except
// that a role that runs visits (encounters.manage) only in its own ones.
// A shared lock: several sets may be saved at once, but not while the
// visit is being closed.
export async function lockedOpenForVitals(
  em: EntityManager,
  id: string,
  actor: CurrentUserData,
): Promise<Encounter> {
  const row = await em.findOne(Encounter, {
    where: { id },
    lock: { mode: 'pessimistic_read' },
  });
  if (!row) throw notFound();
  if (actor.permissions.includes('encounters.manage')) {
    assertDoctor(row.doctorId, actor, 'record vitals in this visit');
  }
  assertOpen(row, 'record vitals in');
  return row;
}

export const toEncounterRef = (row: Encounter): EncounterRefPayload => ({
  encounterId: row.id,
  patientId: row.patientId,
  patientName: row.patientName,
  patientMrn: row.patientMrn,
  doctorId: row.doctorId,
  doctorName: row.doctorName,
});
