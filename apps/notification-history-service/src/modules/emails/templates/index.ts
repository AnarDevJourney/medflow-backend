import { BUTTON } from './layout';

// Handlebars sources per template: HTML body (wrapped in LAYOUT_HTML) and a
// plain-text alternative. {{formatDate x}} prints Asia/Baku time (DOC 12).
export const EMAIL_TEMPLATES = {
  'staff-invite': {
    html: `<p>Hello {{firstName}},</p>
<p>{{invitedBy}} invited you to MedFlow as <strong>{{role}}</strong>. Set your password to activate your account:</p>
${BUTTON('{{inviteLink}}', 'Accept the invitation')}
<p>The link works until {{formatDate expiresAt}}.</p>`,
    text: `Hello {{firstName}},

{{invitedBy}} invited you to MedFlow as {{role}}. Set your password to activate your account:
{{inviteLink}}

The link works until {{formatDate expiresAt}}.`,
  },

  'password-reset': {
    html: `<p>Hello {{firstName}},</p>
<p>Someone asked to reset the password of your MedFlow account. If it was you, choose a new password:</p>
${BUTTON('{{resetLink}}', 'Reset password')}
<p>The link works until {{formatDate expiresAt}}. If you did not ask for this, ignore this email — your password stays the same.</p>`,
    text: `Hello {{firstName}},

Someone asked to reset the password of your MedFlow account. If it was you, choose a new password:
{{resetLink}}

The link works until {{formatDate expiresAt}}. If you did not ask for this, ignore this email.`,
  },

  'password-changed': {
    html: `<p>Hello {{firstName}},</p>
<p>The password of your MedFlow account was {{#if viaReset}}reset with an email link{{else}}changed{{/if}} on {{formatDate occurredAt}}. Your other sessions were signed out.</p>
<p>If this was not you, contact your administrator immediately.</p>`,
    text: `Hello {{firstName}},

The password of your MedFlow account was {{#if viaReset}}reset with an email link{{else}}changed{{/if}} on {{formatDate occurredAt}}. Your other sessions were signed out.

If this was not you, contact your administrator immediately.`,
  },

  'session-revoked': {
    html: `<p>Hello {{firstName}},</p>
<p>On {{formatDate occurredAt}} an old sign-in token of your MedFlow account was used again. To be safe, we signed you out on every device.</p>
<p>Sign in again. If you did not expect this, change your password.</p>`,
    text: `Hello {{firstName}},

On {{formatDate occurredAt}} an old sign-in token of your MedFlow account was used again. To be safe, we signed you out on every device.

Sign in again. If you did not expect this, change your password.`,
  },
} as const;

export type EmailTemplateName = keyof typeof EMAIL_TEMPLATES;
