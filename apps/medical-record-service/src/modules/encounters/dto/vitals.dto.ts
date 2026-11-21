import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

// POST /encounters/:id/vitals — one set of measurements; every value is
// optional but at least one is needed. Ranges reject typos (370 °C), not
// unusual patients: the UI flags values outside the normal range.
export class RecordVitalsDto {
  @ApiPropertyOptional({ example: 36.6, minimum: 30, maximum: 45 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(30)
  @Max(45)
  temperatureC?: number;

  @ApiPropertyOptional({ example: 120, minimum: 50, maximum: 300 })
  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(300)
  systolicBp?: number;

  @ApiPropertyOptional({ example: 80, minimum: 20, maximum: 200 })
  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(200)
  diastolicBp?: number;

  @ApiPropertyOptional({ example: 72, minimum: 20, maximum: 250 })
  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(250)
  heartRate?: number;

  @ApiPropertyOptional({ example: 16, minimum: 4, maximum: 80 })
  @IsOptional()
  @IsInt()
  @Min(4)
  @Max(80)
  respiratoryRate?: number;

  @ApiPropertyOptional({ example: 98, minimum: 50, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(100)
  oxygenSaturation?: number;

  @ApiPropertyOptional({ example: 72.5, minimum: 0.5, maximum: 400 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.5)
  @Max(400)
  weightKg?: number;

  @ApiPropertyOptional({ example: 175, minimum: 30, maximum: 250 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(30)
  @Max(250)
  heightCm?: number;
}

export const VITAL_FIELDS = [
  'temperatureC',
  'systolicBp',
  'diastolicBp',
  'heartRate',
  'respiratoryRate',
  'oxygenSaturation',
  'weightKg',
  'heightCm',
] as const;
