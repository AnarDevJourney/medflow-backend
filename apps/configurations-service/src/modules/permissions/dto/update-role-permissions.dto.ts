import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class UpdateRolePermissionsDto {
  // Role → its full permission list. Checked in the service (role names,
  // known codes, ADMIN keeps the permissions page).
  @ApiProperty({
    example: { DOCTOR: ['patients.read', 'records.read'] },
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'string' } },
  })
  @IsObject()
  roles: Record<string, unknown>;
}
