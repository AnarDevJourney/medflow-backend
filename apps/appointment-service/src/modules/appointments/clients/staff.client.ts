import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { internalGet } from './internal-http';

export interface WorkingDay {
  working: true;
  date: string;
  start: string; // 'HH:mm' clinic time
  end: string;
  slotMinutes: number;
  doctorName: string;
  departmentId: string | null;
  departmentName: string | null;
  departmentCode: string | null;
}

// NOT_A_DOCTOR | DEACTIVATED | VACATION | SICK_LEAVE | TRAINING | DAY_OFF |
// NOT_SCHEDULED (staff-service DoctorDayService)
export interface NotWorkingDay {
  working: false;
  date: string;
  reason: string;
}

export type DoctorDay = WorkingDay | NotWorkingDay;

// staff-service GET /internal/doctors/days — many doctors × many days
export type RangeDay =
  | {
      date: string;
      working: true;
      start: string;
      end: string;
      slotMinutes: number;
    }
  | { date: string; working: false; reason: string };

export interface DoctorDays {
  userId: string;
  doctorName: string;
  departmentId: string | null;
  departmentName: string | null;
  departmentCode: string | null;
  days: RangeDay[];
}

// staff-service internal API: one day of a doctor (hours, slot length,
// time off). Sync on purpose — the desk needs the answer now (DOC 5.1).
@Injectable()
export class StaffClient {
  private readonly logger = new Logger(StaffClient.name);
  private readonly service: {
    name: string;
    label: string;
    baseUrl: string;
    key: string;
  };

  constructor(config: ConfigService) {
    this.service = {
      name: 'staff-service',
      label: 'Staff service',
      baseUrl: config
        .getOrThrow<string>('STAFF_SERVICE_URL')
        .replace(/\/+$/, ''),
      key: config.getOrThrow<string>('INTERNAL_API_KEY'),
    };
  }

  // Every doctor (not deactivated) of the department / the one doctor,
  // with each day of the range
  async doctorDays(query: {
    from: string;
    to: string;
    departmentId?: string;
    doctorId?: string;
  }): Promise<DoctorDays[]> {
    const params = new URLSearchParams({ from: query.from, to: query.to });
    if (query.departmentId) params.set('departmentId', query.departmentId);
    if (query.doctorId) params.set('doctorId', query.doctorId);
    return (
      (await internalGet<DoctorDays[]>(
        this.logger,
        this.service,
        `/internal/doctors/days?${params.toString()}`,
      )) ?? []
    );
  }

  // null = no staff profile with this user id
  doctorDay(userId: string, date: string): Promise<DoctorDay | null> {
    return internalGet<DoctorDay>(
      this.logger,
      this.service,
      `/internal/doctors/${encodeURIComponent(userId)}/day?date=${date}`,
    );
  }
}
