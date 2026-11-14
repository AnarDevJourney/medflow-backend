import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

const TZ = 'Asia/Baku'; // DOC 12: months and ages in clinic time

export const AGE_GROUPS = ['0-17', '18-39', '40-64', '65+'] as const;

export interface PatientStats {
  totals: {
    active: number;
    inactive: number;
    newThisMonth: number;
    newLastMonth: number;
  };
  // The last 12 months, oldest first, empty months as 0 — 'YYYY-MM'
  monthly: { month: string; count: number }[];
  // Active patients only
  gender: { MALE: number; FEMALE: number };
  ageGroups: { group: (typeof AGE_GROUPS)[number]; count: number }[];
}

// GET /patients/stats (DOC 8.4, ADMIN): totals, new per month, gender and
// age-group distribution. Plain aggregate SQL — a few thousand rows at most.
@Injectable()
export class PatientStatsService {
  constructor(private readonly dataSource: DataSource) {}

  async stats(): Promise<PatientStats> {
    const [totals] = await this.dataSource.query<
      {
        active: string;
        inactive: string;
        this_month: string;
        last_month: string;
      }[]
    >(
      `WITH m AS (SELECT date_trunc('month', now() AT TIME ZONE $1) AS start)
       SELECT count(*) FILTER (WHERE is_active)     AS active,
              count(*) FILTER (WHERE NOT is_active) AS inactive,
              count(*) FILTER (WHERE (created_at AT TIME ZONE $1) >= m.start) AS this_month,
              count(*) FILTER (WHERE (created_at AT TIME ZONE $1) >= m.start - interval '1 month'
                                 AND (created_at AT TIME ZONE $1) <  m.start) AS last_month
       FROM patients, m`,
      [TZ],
    );

    const monthly = await this.dataSource.query<
      { month: string; count: string }[]
    >(
      `WITH months AS (
         SELECT generate_series(
           date_trunc('month', now() AT TIME ZONE $1) - interval '11 months',
           date_trunc('month', now() AT TIME ZONE $1),
           interval '1 month') AS start
       )
       SELECT to_char(months.start, 'YYYY-MM') AS month, count(p.id) AS count
       FROM months
       LEFT JOIN patients p
         ON date_trunc('month', p.created_at AT TIME ZONE $1) = months.start
       GROUP BY months.start
       ORDER BY months.start`,
      [TZ],
    );

    const gender = await this.dataSource.query<
      { gender: 'MALE' | 'FEMALE'; count: string }[]
    >(
      `SELECT gender, count(*) AS count FROM patients WHERE is_active GROUP BY gender`,
    );

    const ages = await this.dataSource.query<
      { group: string; count: string }[]
    >(
      `SELECT CASE
                WHEN a < 18 THEN '0-17'
                WHEN a < 40 THEN '18-39'
                WHEN a < 65 THEN '40-64'
                ELSE '65+'
              END AS group, count(*) AS count
       FROM (SELECT date_part('year', age((now() AT TIME ZONE $1)::date, date_of_birth)) AS a
             FROM patients WHERE is_active) t
       GROUP BY 1`,
      [TZ],
    );

    const byGender = Object.fromEntries(
      gender.map((g) => [g.gender, Number(g.count)]),
    );
    const byAge = Object.fromEntries(
      ages.map((a) => [a.group, Number(a.count)]),
    );
    return {
      totals: {
        active: Number(totals.active),
        inactive: Number(totals.inactive),
        newThisMonth: Number(totals.this_month),
        newLastMonth: Number(totals.last_month),
      },
      monthly: monthly.map((m) => ({ month: m.month, count: Number(m.count) })),
      gender: { MALE: byGender.MALE ?? 0, FEMALE: byGender.FEMALE ?? 0 },
      ageGroups: AGE_GROUPS.map((group) => ({
        group,
        count: byAge[group] ?? 0,
      })),
    };
  }
}
