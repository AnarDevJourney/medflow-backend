import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppException, ErrorCode } from '@medflow/common';
import { Department } from './entities/department.entity';

// Service-to-service only (x-internal-key, never routed by the gateway).
// auth-service checks the department of an invite here: it must exist
// and be active.
@ApiTags('internal')
@Controller('internal/departments')
export class InternalDepartmentsController {
  constructor(
    @InjectRepository(Department)
    private readonly departments: Repository<Department>,
  ) {}

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const department = await this.departments.findOneBy({ id });
    if (!department) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Department not found',
      );
    }
    return {
      id: department.id,
      code: department.code,
      name: department.name,
      isActive: department.isActive,
    };
  }
}
