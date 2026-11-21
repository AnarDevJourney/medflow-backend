import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppointmentClient } from '../../clients/appointment.client';
import { ClinicalController } from './clinical.controller';
import { DiagnosesService } from './diagnoses.service';
import { EncounterDetailService } from './encounter-detail.service';
import { EncountersController } from './encounters.controller';
import { EncountersService } from './encounters.service';
import { Diagnosis } from './entities/diagnosis.entity';
import { Encounter } from './entities/encounter.entity';
import { VitalSigns } from './entities/vital-signs.entity';
import { VitalsService } from './vitals.service';

@Module({
  imports: [TypeOrmModule.forFeature([Encounter, VitalSigns, Diagnosis])],
  controllers: [EncountersController, ClinicalController],
  providers: [
    EncountersService,
    EncounterDetailService,
    VitalsService,
    DiagnosesService,
    AppointmentClient,
  ],
})
export class EncountersModule {}
