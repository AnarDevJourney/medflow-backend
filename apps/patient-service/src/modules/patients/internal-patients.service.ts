import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppException, ErrorCode } from '@medflow/common';
import { PatientAllergy } from './entities/patient-allergy.entity';
import { Patient } from './entities/patient.entity';

export interface InternalPatientSummary {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  isActive: boolean;
}

export interface InternalAllergy {
  allergen: string;
  category: string; // DRUG | FOOD | ENVIRONMENTAL | OTHER
  severity: string; // SEVERE | MODERATE | MILD
  reaction: string | null;
}

const notFound = () =>
  new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'Patient not found',
  );

@Injectable()
export class InternalPatientsService {
  constructor(
    @InjectRepository(Patient)
    private readonly patients: Repository<Patient>,
    @InjectRepository(PatientAllergy)
    private readonly allergyRepo: Repository<PatientAllergy>,
  ) {}

  // What a booking needs: does the patient exist, are they active, and the
  // name / MRN / contacts to snapshot (DOC 5.4)
  async summary(id: string): Promise<InternalPatientSummary> {
    const p = await this.patients.findOneBy({ id });
    if (!p) throw notFound();
    return {
      id: p.id,
      mrn: p.mrn,
      firstName: p.firstName,
      lastName: p.lastName,
      phone: p.phone,
      email: p.email,
      isActive: p.isActive,
    };
  }

  // For the prescription check (DOC 6.3): most severe first
  async allergies(id: string): Promise<InternalAllergy[]> {
    if (!(await this.patients.existsBy({ id }))) throw notFound();
    const rows = await this.allergyRepo
      .createQueryBuilder('allergy')
      .where('allergy.patientId = :id', { id })
      .orderBy('allergy.severity', 'DESC')
      .addOrderBy('allergy.allergen', 'ASC')
      .getMany();
    return rows.map((a) => ({
      allergen: a.allergen,
      category: a.category,
      severity: a.severity,
      reaction: a.reaction,
    }));
  }
}
