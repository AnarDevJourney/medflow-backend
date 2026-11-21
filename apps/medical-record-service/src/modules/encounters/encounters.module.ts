import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppointmentClient } from '../../clients/appointment.client';
import { EncountersController } from './encounters.controller';
import { EncountersService } from './encounters.service';
import { Encounter } from './entities/encounter.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Encounter])],
  controllers: [EncountersController],
  providers: [EncountersService, AppointmentClient],
})
export class EncountersModule {}
