import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export const TABLE_DENSITIES = ['compact', 'comfortable'] as const;
export type TableDensity = (typeof TABLE_DENSITIES)[number];

export const COLUMN_PINS = ['left', 'right'] as const;
export type ColumnPin = (typeof COLUMN_PINS)[number];

export interface TableColumnSetting {
  key: string;
  visible: boolean;
  width: number | null; // null = the column's default width
  pinned: ColumnPin | null;
}

// Settings of one table ('patients', 'invoices', …) for one user. Table and
// column keys are defined by the frontend; NULL = use the table's default.
@Entity('table_settings')
export class TableSettings {
  @PrimaryColumn('uuid')
  userId: string;

  @PrimaryColumn({ type: 'varchar', length: 60 })
  tableKey: string;

  @Column({ type: 'jsonb', nullable: true })
  columns: TableColumnSetting[] | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  density: TableDensity | null;

  // Preset look ('classic', 'striped', 'grid', …)
  @Column({ type: 'varchar', length: 40, nullable: true })
  view: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
