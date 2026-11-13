import { DoctorSchedule } from './entities/doctor-schedule.entity';

export interface ScheduleDay {
  dayOfWeek: number;
  startTime: string; // 'HH:mm'
  endTime: string;
  slotMinutes: number;
}

export interface ScheduleResponse {
  userId: string;
  days: ScheduleDay[]; // working days only, Monday first
}

// '09:00:00' → '09:00'
export const toHHmm = (time: string): string => time.slice(0, 5);

export const minutesOf = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

export const toScheduleDay = (row: DoctorSchedule): ScheduleDay => ({
  dayOfWeek: row.dayOfWeek,
  startTime: toHHmm(row.startTime),
  endTime: toHHmm(row.endTime),
  slotMinutes: row.slotMinutes,
});

export const sameDay = (a: ScheduleDay, b: ScheduleDay): boolean =>
  a.startTime === b.startTime &&
  a.endTime === b.endTime &&
  a.slotMinutes === b.slotMinutes;
