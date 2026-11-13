import { TimeOff } from './entities/time-off.entity';

export interface TimeOffResponse {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  type: string;
  startDate: string; // 'YYYY-MM-DD'
  endDate: string; // inclusive
  days: number;
  reason: string | null;
  createdByName: string | null; // null = that account has no profile
  createdAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Calendar days in the period, both ends included
export const daysBetween = (startDate: string, endDate: string): number =>
  Math.round((Date.parse(endDate) - Date.parse(startDate)) / DAY_MS) + 1;

// "Today" in the clinic (DOC 12: Asia/Baku), as 'YYYY-MM-DD'
export const clinicToday = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku' }).format(
    new Date(),
  );

// `staffMember` must be loaded with the row
export const toTimeOffResponse = (
  row: TimeOff,
  createdByName: string | null,
): TimeOffResponse => ({
  id: row.id,
  userId: row.staffMember.userId,
  firstName: row.staffMember.firstName,
  lastName: row.staffMember.lastName,
  type: row.type,
  startDate: row.startDate,
  endDate: row.endDate,
  days: daysBetween(row.startDate, row.endDate),
  reason: row.reason,
  createdByName,
  createdAt: row.createdAt.toISOString(),
});
