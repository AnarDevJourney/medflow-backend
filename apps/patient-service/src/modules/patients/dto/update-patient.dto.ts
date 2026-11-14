import { PartialType } from '@nestjs/swagger';
import { CreatePatientDto } from './create-patient.dto';

// PATCH /patients/:id — any demographic field. Required ones (name, birth
// date, gender, phone) cannot be cleared: their validators reject null.
export class UpdatePatientDto extends PartialType(CreatePatientDto) {}
