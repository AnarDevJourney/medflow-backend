import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export interface SidebarGroup {
  id: string;
  // null = built-in group, the frontend shows its translated title
  name: string | null;
  collapsed: boolean;
  items: string[]; // page keys in display order
}

export interface PageVisit {
  count: number;
  lastVisitedAt: string; // ISO timestamp
}

// Sidebar configuration of one user. Page keys ('patients', 'invoices', …)
// are defined by the frontend; the backend only checks their shape.
@Entity('sidebar_settings')
export class SidebarSettings {
  // auth user id
  @PrimaryColumn('uuid')
  userId: string;

  // Icons-only mode
  @Column({ type: 'boolean', default: false })
  collapsed: boolean;

  // null until the user changes the grouping or order
  @Column({ type: 'jsonb', nullable: true })
  groups: SidebarGroup[] | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  favorites: string[];

  @Column({ type: 'boolean', default: true })
  showFrequent: boolean;

  @Column({ type: 'boolean', default: true })
  showRecent: boolean;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  pageVisits: Record<string, PageVisit>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
