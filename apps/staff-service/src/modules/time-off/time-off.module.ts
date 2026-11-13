import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeOff } from './entities/time-off.entity';
import { TimeOffController } from './time-off.controller';
import { TimeOffService } from './time-off.service';

@Module({
  imports: [TypeOrmModule.forFeature([TimeOff])],
  controllers: [TimeOffController],
  providers: [TimeOffService],
})
export class TimeOffModule {}
