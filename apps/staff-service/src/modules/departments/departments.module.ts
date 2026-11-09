import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DepartmentsCache } from './departments.cache';
import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';
import { Department } from './entities/department.entity';
import { InternalDepartmentsController } from './internal-departments.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Department])],
  controllers: [DepartmentsController, InternalDepartmentsController],
  providers: [DepartmentsService, DepartmentsCache],
})
export class DepartmentsModule {}
