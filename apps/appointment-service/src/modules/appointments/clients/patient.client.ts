import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { internalGet } from './internal-http';

export interface PatientSummary {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  isActive: boolean;
}

// patient-service internal API: the patient to validate and snapshot
@Injectable()
export class PatientClient {
  private readonly logger = new Logger(PatientClient.name);
  private readonly service: {
    name: string;
    label: string;
    baseUrl: string;
    key: string;
  };

  constructor(config: ConfigService) {
    this.service = {
      name: 'patient-service',
      label: 'Patient service',
      baseUrl: config
        .getOrThrow<string>('PATIENT_SERVICE_URL')
        .replace(/\/+$/, ''),
      key: config.getOrThrow<string>('INTERNAL_API_KEY'),
    };
  }

  // null = unknown patient
  summary(patientId: string): Promise<PatientSummary | null> {
    return internalGet<PatientSummary>(
      this.logger,
      this.service,
      `/internal/patients/${encodeURIComponent(patientId)}/summary`,
    );
  }
}
