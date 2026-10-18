import type { DomainEvent, EventType } from '@medflow/contracts';
import type { EmailTemplateName } from '../templates';

// One email an event produces (DOC 5.6 "notif: … email")
export interface EmailDraft {
  to: string;
  template: EmailTemplateName;
  subject: string;
  // Variables of the Handlebars template (may hold a link with a raw token
  // — lives only in the BullMQ job, never in email_logs)
  data: Record<string, unknown>;
  // A link inside dies at this time — sending later is pointless
  expiresAt?: string | null;
}

// Only events that send an email have a template
export type EmailTemplates = {
  [K in EventType]?: (event: DomainEvent<K>) => EmailDraft[];
};
