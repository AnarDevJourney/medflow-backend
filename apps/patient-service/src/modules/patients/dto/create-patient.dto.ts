import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { BloodType, Gender } from '../entities/patient.entity';

export const PHONE_PATTERN = /^\+?[0-9 ()-]{5,19}$/;
export const FIN_PATTERN = /^[A-Z0-9]{7}$/;
export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// An empty optional field is stored as NULL, not as ''
const trimToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

const upperToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() || null : value;

const lowerToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() || null : value;

// POST /patients (DOC 8.4). MRN is generated, never sent.
export class CreatePatientDto {
  @ApiProperty({ example: 'Leyla' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Mammadova' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;

  @ApiPropertyOptional({ example: 'Rashid', nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(100)
  fatherName?: string | null;

  // Stored in upper case; optional (foreigners, newborns)
  @ApiPropertyOptional({ example: '5ZK8L2M', nullable: true })
  @IsOptional()
  @Transform(upperToNull)
  @IsString()
  @Matches(FIN_PATTERN, { message: 'finCode must be 7 letters or digits' })
  finCode?: string | null;

  // Not in the future, not before 1900 (checked in the service)
  @ApiProperty({ example: '1990-05-14' })
  @IsDateString({ strict: true })
  @Matches(DAY_PATTERN, { message: 'dateOfBirth must be YYYY-MM-DD' })
  dateOfBirth: string;

  @ApiProperty({ enum: Gender })
  @IsEnum(Gender)
  gender: Gender;

  @ApiPropertyOptional({ enum: BloodType, nullable: true })
  @IsOptional()
  @IsEnum(BloodType)
  bloodType?: BloodType | null;

  @ApiProperty({ example: '+994 50 123 45 67' })
  @Transform(trim)
  @IsString()
  @Matches(PHONE_PATTERN, { message: 'phone must be a valid phone number' })
  phone: string;

  @ApiPropertyOptional({ example: 'leyla@mail.az', nullable: true })
  @IsOptional()
  @Transform(lowerToNull)
  @IsEmail({}, { message: 'email must be a valid email' })
  @MaxLength(255)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @ApiPropertyOptional({ example: 'Rashid Mammadov', nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(150)
  emergencyContactName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @Matches(PHONE_PATTERN, {
    message: 'emergencyContactPhone must be a valid phone number',
  })
  emergencyContactPhone?: string | null;

  @ApiPropertyOptional({ example: 'Father', nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(50)
  emergencyContactRelation?: string | null;

  // Front-desk notes (language, accessibility) — not clinical notes
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
