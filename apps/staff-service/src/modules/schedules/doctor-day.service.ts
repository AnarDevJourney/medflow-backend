import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { AppException, ErrorCode, Role } from '@medflow/common';
import {
  StaffMember,
  StaffStatus,
} from '../staff/entities/staff-member.entity';
import { TimeOff, TimeOffType } from '../time-off/entities/time-off.entity';
import { clinicToday } from '../time-off/time-off.mapper';
import { DoctorSchedule } from './entities/doctor-schedule.entity';
import { toHHmm } from './schedule.mapper';

export type NotWorkingReason =
  'NOT_A_DOCTOR' | 'DEACTIVATED' | TimeOffType | 'NOT_SCHEDULED';

export interface WorkingDay {
  working: true;
  date: string;
  start: string; // 'HH:mm'
  end: string;
  slotMinutes: number;
  doctorName: string;
  departmentId: string | null;
  departmentName: string | null;
  departmentCode: string | null;
}

export interface NotWorkingDay {
  working: false;
  date: string;
  reason: NotWorkingReason;
}

export type DoctorDay = WorkingDay | NotWorkingDay;

// ISO weekday of a calendar day: 1 = Monday … 7 = Sunday. Read as UTC so
// the server's time zone never shifts the day.
export const isoWeekday = (date: string): number =>
  new Date(`${date}T00:00:00Z`).getUTCDay() || 7;

// One day of a doctor for booking (appointment-service). The first rule
// that matches wins: role → status → time off → weekly schedule.
// Invited doctors count as working: they can be booked before first login.
@Injectable()
export class DoctorDayService {
  constructor(
    @InjectRepository(StaffMember)
    private readonly staff: Repository<StaffMember>,
    @InjectRepository(TimeOff)
    private readonly timeOff: Repository<TimeOff>,
    @InjectRepository(DoctorSchedule)
    private readonly schedules: Repository<DoctorSchedule>,
  ) {}

  async day(userId: string, date = clinicToday()): Promise<DoctorDay> {
    const member = await this.staff.findOne({
      where: { userId },
      relations: { department: true },
    });
    if (!member) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Staff member not found',
      );
    }
    const off = (reason: NotWorkingReason): NotWorkingDay => ({
      working: false,
      date,
      reason,
    });

    if (member.role !== Role.DOCTOR) return off('NOT_A_DOCTOR');
    if (member.status === StaffStatus.DEACTIVATED) return off('DEACTIVATED');

    const leave = await this.timeOff.findOne({
      where: {
        staffMemberId: member.id,
        startDate: LessThanOrEqual(date),
        endDate: MoreThanOrEqual(date),
      },
      order: { startDate: 'ASC' },
    });
    if (leave) return off(leave.type);

    const slot = await this.schedules.findOneBy({
      staffMemberId: member.id,
      dayOfWeek: isoWeekday(date),
      isActive: true,
    });
    if (!slot) return off('NOT_SCHEDULED');

    return {
      working: true,
      date,
      start: toHHmm(slot.startTime),
      end: toHHmm(slot.endTime),
      slotMinutes: slot.slotMinutes,
      doctorName: `${member.firstName} ${member.lastName}`,
      departmentId: member.department?.id ?? null,
      departmentName: member.department?.name ?? null,
      departmentCode: member.department?.code ?? null,
    };
  }
}
