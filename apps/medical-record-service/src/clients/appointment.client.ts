import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { internalGet } from '@medflow/common';
import type { AppointmentTypeName } from '@medflow/contracts';

// What a visit needs from appointment-service GET /internal/appointments/:id
export interface AppointmentInfo {
  id: string;
  patientId: string;
  patientName: string;
  patientMrn: string;
  patientEmail: string | null;
  doctorId: string;
  doctorName: string;
  departmentId: string;
  departmentName: string;
  departmentCode: string;
  startsAt: string;
  type: AppointmentTypeName;
  status: string;
  encounterId: string | null;
}

// appointment-service internal API: the appointment a visit starts from
@Injectable()
export class AppointmentClient {
  private readonly logger = new Logger(AppointmentClient.name);
  private readonly service: {
    name: string;
    label: string;
    baseUrl: string;
    key: string;
  };

  constructor(config: ConfigService) {
    this.service = {
      name: 'appointment-service',
      label: 'Appointment service',
      baseUrl: config
        .getOrThrow<string>('APPOINTMENT_SERVICE_URL')
        .replace(/\/+$/, ''),
      key: config.getOrThrow<string>('INTERNAL_API_KEY'),
    };
  }

  // null = unknown appointment
  findOne(id: string): Promise<AppointmentInfo | null> {
    return internalGet<AppointmentInfo>(
      this.logger,
      this.service,
      `/internal/appointments/${encodeURIComponent(id)}`,
    );
  }
}
