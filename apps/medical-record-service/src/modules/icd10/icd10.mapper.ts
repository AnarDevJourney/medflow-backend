// One entry of the ICD-10 catalogue as the API returns it
export interface Icd10Response {
  code: string;
  titleEn: string; // official
  titleAz: string | null;
  titleRu: string | null;
  // false = machine-translated, not yet checked by an admin
  titleAzVerified: boolean;
  titleRuVerified: boolean;
  synonyms: string[];
  chapter: string;
  chapterNo: number | null;
  isLeaf: boolean;
  isActive: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
}

export interface Icd10Row {
  code: string;
  title_en: string;
  title_az: string | null;
  title_ru: string | null;
  title_az_verified: boolean;
  title_ru_verified: boolean;
  synonyms: string[];
  chapter: string;
  chapter_no: number | null;
  is_leaf: boolean;
  is_active: boolean;
  updated_at: Date | null;
  updated_by_name: string | null;
}

export const ICD10_COLUMNS = `code, title_en, title_az, title_ru, title_az_verified,
  title_ru_verified, synonyms, chapter,
  chapter_no, is_leaf, is_active, updated_at, updated_by_name`;

export const toIcd10Response = (r: Icd10Row): Icd10Response => ({
  code: r.code,
  titleEn: r.title_en,
  titleAz: r.title_az,
  titleRu: r.title_ru,
  titleAzVerified: r.title_az_verified,
  titleRuVerified: r.title_ru_verified,
  synonyms: r.synonyms,
  chapter: r.chapter,
  chapterNo: r.chapter_no,
  isLeaf: r.is_leaf,
  isActive: r.is_active,
  updatedAt: r.updated_at?.toISOString() ?? null,
  updatedByName: r.updated_by_name,
});
