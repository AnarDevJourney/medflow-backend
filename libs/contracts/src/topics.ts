// One topic per producing service (DOC 5.1). Created by
// docker/kafka/create-topics.sh — auto-create is disabled on the broker.
export const Topics = {
  AUTH: 'auth.events',
  STAFF: 'staff.events',
  PATIENT: 'patient.events',
  APPOINTMENT: 'appointment.events',
  RECORD: 'record.events',
  BILLING: 'billing.events',
  FILE: 'file.events',
  DEAD_LETTER: 'dead-letter.events',
} as const;

export type Topic = (typeof Topics)[keyof typeof Topics];

// Every business topic (not the dead letters) — what notification-history reads
export const DOMAIN_TOPICS: readonly Topic[] = Object.values(Topics).filter(
  (topic) => topic !== Topics.DEAD_LETTER,
);
