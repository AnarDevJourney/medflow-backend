import { PatientAllergy } from './entities/patient-allergy.entity';
import { PatientCondition } from './entities/patient-condition.entity';

export interface AllergyResponse {
  id: string;
  allergen: string;
  category: string;
  severity: string;
  reaction: string | null;
  recordedByName: string | null;
  createdAt: string;
}

export interface ConditionResponse {
  id: string;
  name: string;
  icd10Code: string | null;
  diagnosedOn: string | null; // 'YYYY-MM-DD'
  status: string;
  notes: string | null;
  recordedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export const toAllergyResponse = (row: PatientAllergy): AllergyResponse => ({
  id: row.id,
  allergen: row.allergen,
  category: row.category,
  severity: row.severity,
  reaction: row.reaction,
  recordedByName: row.recordedByName,
  createdAt: row.createdAt.toISOString(),
});

export const toConditionResponse = (
  row: PatientCondition,
): ConditionResponse => ({
  id: row.id,
  name: row.name,
  icd10Code: row.icd10Code,
  diagnosedOn: row.diagnosedOn,
  status: row.status,
  notes: row.notes,
  recordedByName: row.recordedByName,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
