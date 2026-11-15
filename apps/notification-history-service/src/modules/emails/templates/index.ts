import { BUTTON, VISIT_CARD } from './layout';

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
  // Patients (phase 7.4) — Azerbaijani (user decision). {{visitTime x}}
  // prints "27 noyabr 2026, cümə, saat 09:00" in clinic time.
  'appointment-booked': {
    lang: 'az',
    html: `<p>Hörmətli {{patientName}},</p>
<p>Sizin qəbula yazılışınız təsdiqləndi.</p>
${VISIT_CARD}
<p>Zəhmət olmasa, qəbuldan 10 dəqiqə əvvəl gəlin və şəxsiyyət vəsiqənizi özünüzlə götürün. Gələ bilməyəcəksinizsə, qəbul şöbəsinə zəng edin ki, vaxtı başqa pasiyentə verək.</p>`,
    text: `Hörmətli {{patientName}},

Sizin qəbula yazılışınız təsdiqləndi.

Vaxt: {{visitTime startsAt}}
Həkim: {{doctorName}} ({{departmentName}})
Qəbulun növü: {{typeLabel}}

Zəhmət olmasa, qəbuldan 10 dəqiqə əvvəl gəlin və şəxsiyyət vəsiqənizi özünüzlə götürün. Gələ bilməyəcəksinizsə, qəbul şöbəsinə zəng edin.`,
  },

  'appointment-rescheduled': {
    lang: 'az',
    html: `<p>Hörmətli {{patientName}},</p>
<p>Qəbulunuzun vaxtı dəyişdirildi. Əvvəlki vaxt: <s>{{visitTime previousStartsAt}}</s>{{#if doctorChanged}}, {{previousDoctorName}}{{/if}}.</p>
<p><strong>Yeni vaxt:</strong></p>
${VISIT_CARD}
<p>Yeni vaxt sizə uyğun deyilsə, qəbul şöbəsinə zəng edin.</p>`,
    text: `Hörmətli {{patientName}},

Qəbulunuzun vaxtı dəyişdirildi.
Əvvəlki vaxt: {{visitTime previousStartsAt}}{{#if doctorChanged}}, {{previousDoctorName}}{{/if}}

Yeni vaxt: {{visitTime startsAt}}
Həkim: {{doctorName}} ({{departmentName}})

Yeni vaxt sizə uyğun deyilsə, qəbul şöbəsinə zəng edin.`,
  },

  'appointment-cancelled': {
    lang: 'az',
    html: `<p>Hörmətli {{patientName}},</p>
<p>{{doctorName}} həkimin ({{departmentName}}) qəbuluna <strong>{{visitTime startsAt}}</strong> vaxtına yazılışınız ləğv edildi.</p>
<p>Yeni vaxta yazılmaq üçün qəbul şöbəsinə zəng edin.</p>`,
    text: `Hörmətli {{patientName}},

{{doctorName}} həkimin ({{departmentName}}) qəbuluna {{visitTime startsAt}} vaxtına yazılışınız ləğv edildi.

Yeni vaxta yazılmaq üçün qəbul şöbəsinə zəng edin.`,
  },

  'appointment-reminder': {
    lang: 'az',
    html: `<p>Hörmətli {{patientName}},</p>
<p>Xatırladırıq ki, sabah qəbulunuz var.</p>
${VISIT_CARD}
<p>Zəhmət olmasa, 10 dəqiqə əvvəl gəlin. Gələ bilməyəcəksinizsə, qəbul şöbəsinə zəng edin.</p>`,
    text: `Hörmətli {{patientName}},

Xatırladırıq ki, sabah qəbulunuz var.

Vaxt: {{visitTime startsAt}}
Həkim: {{doctorName}} ({{departmentName}})

Zəhmət olmasa, 10 dəqiqə əvvəl gəlin. Gələ bilməyəcəksinizsə, qəbul şöbəsinə zəng edin.`,
  },
} as const;

export type EmailTemplateName = keyof typeof EMAIL_TEMPLATES;
