import { ValueTransformer } from 'typeorm';

// PostgreSQL returns numeric columns (money, vitals) as strings to avoid
// precision loss. Amounts in MedFlow are small, so a JS number is safe.
// Usage: @Column({ type: 'numeric', precision: 12, scale: 2, transformer: new ColumnNumericTransformer() })
export class ColumnNumericTransformer implements ValueTransformer {
  to(value: number | null | undefined): number | null | undefined {
    return value;
  }

  from(value: string | null): number | null {
    return value === null ? null : parseFloat(value);
  }
}
