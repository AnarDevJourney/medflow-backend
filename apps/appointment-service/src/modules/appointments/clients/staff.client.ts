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

  // null = no staff profile with this user id
  doctorDay(userId: string, date: string): Promise<DoctorDay | null> {
    return internalGet<DoctorDay>(
      this.logger,
      this.service,
      `/internal/doctors/${encodeURIComponent(userId)}/day?date=${date}`,
    );
  }
}
