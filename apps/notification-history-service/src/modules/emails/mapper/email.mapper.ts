import { Injectable } from '@nestjs/common';
import type { DomainEvent, EventEnvelope } from '@medflow/contracts';
import type { EmailTemplateName } from '../templates';
import { authEmails } from './auth.emails';
import { EmailDraft, EmailTemplates } from './email-template';

// What EmailConsumer stores (email_logs columns) plus what the BullMQ job
// needs to render and send it
export interface EmailRow {
  eventId: string;
  recipientEmail: string;
  template: EmailTemplateName;
  subject: string;
  data: Record<string, unknown>;
  expiresAt: string | null;
}

// Every event that sends an email → its template. Each phase spreads the
// templates of its service in here (appointmentEmails, billingEmails, …).
const TEMPLATES: EmailTemplates = {
  ...authEmails,
};

// (eventType, envelope) → emails, one per (template, recipient) (DOC 6.7)
@Injectable()
export class EmailMapper {
  // [] = the event sends no email
  map(event: EventEnvelope): EmailRow[] {
    const template = TEMPLATES[event.eventType as keyof EmailTemplates] as
      ((event: DomainEvent) => EmailDraft[]) | undefined;
    if (!template) return [];

    const rows = new Map<string, EmailRow>();
    for (const draft of template(event as DomainEvent)) {
      const to = draft.to.toLowerCase();
      rows.set(`${draft.template}|${to}`, {
        eventId: event.eventId,
        recipientEmail: to,
        template: draft.template,
        subject: clip(draft.subject, 255),
        data: draft.data,
        expiresAt: draft.expiresAt ?? null,
      });
    }
    return [...rows.values()];
  }
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
