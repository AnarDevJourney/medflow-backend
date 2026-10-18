import { EmailTemplates } from './email-template';

// auth.events — DOC 5.6: invite, reset and the two security emails
export const authEmails: EmailTemplates = {
  // The seeded admin has no link (already active) → no email
  'user.invited': (event) => {
    const p = event.payload;
    if (!p.inviteLink) return [];
    return [
      {
        to: p.email,
        template: 'staff-invite',
        subject: "You're invited to MedFlow",
        data: {
          firstName: p.firstName,
          role: p.role,
          invitedBy: event.actor?.name ?? 'An administrator',
          inviteLink: p.inviteLink,
          expiresAt: p.expiresAt,
        },
        expiresAt: p.expiresAt,
      },
    ];
  },

  'user.password_reset_requested': (event) => [
    {
      to: event.payload.email,
      template: 'password-reset',
      subject: 'Reset your MedFlow password',
      data: {
        firstName: event.payload.firstName,
        resetLink: event.payload.resetLink,
        expiresAt: event.payload.expiresAt,
      },
      expiresAt: event.payload.expiresAt,
    },
  ],

  'user.password_changed': (event) => [
    {
      to: event.payload.email,
      template: 'password-changed',
      subject: 'Your MedFlow password was changed',
      data: {
        firstName: event.payload.firstName,
        viaReset: event.payload.via === 'RESET',
        occurredAt: event.occurredAt,
      },
      expiresAt: securityNoticeExpiry(event.occurredAt),
    },
  ],

  'user.session_revoked': (event) => {
    // Published before the payload carried the email (phase 4.2) → skip
    if (!event.payload.email) return [];
    return [
      {
        to: event.payload.email,
        template: 'session-revoked',
        subject: 'You were signed out of MedFlow everywhere',
        data: {
          firstName: event.payload.firstName,
          occurredAt: event.occurredAt,
        },
        expiresAt: securityNoticeExpiry(event.occurredAt),
      },
    ];
  },
};

// A security notice that arrives a day late (e.g. events replayed after an
// outage) only confuses — it is dropped instead of sent
const SECURITY_NOTICE_TTL_MS = 24 * 60 * 60 * 1000;

function securityNoticeExpiry(occurredAt: string): string {
  return new Date(
    Date.parse(occurredAt) + SECURITY_NOTICE_TTL_MS,
  ).toISOString();
}
