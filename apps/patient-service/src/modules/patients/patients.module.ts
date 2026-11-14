import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClinicalController } from './clinical.controller';
import { ClinicalService } from './clinical.service';
import { PatientAllergy } from './entities/patient-allergy.entity';
import { PatientCondition } from './entities/patient-condition.entity';
import { Patient } from './entities/patient.entity';
import { InternalPatientsController } from './internal-patients.controller';
import { InternalPatientsService } from './internal-patients.service';
import { PatientStatsService } from './patient-stats.service';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Patient, PatientAllergy, PatientCondition]),
  ],
  controllers: [
    PatientsController,
    ClinicalController,
    InternalPatientsController,
  ],
  providers: [
    PatientsService,
    ClinicalService,
    InternalPatientsService,
    PatientStatsService,
  ],
})
export class PatientsModule {}
