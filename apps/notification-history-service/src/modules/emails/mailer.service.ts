import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Handlebars from 'handlebars';
import { createTransport, Transporter } from 'nodemailer';
import { EMAIL_TEMPLATES, EmailTemplateName } from './templates';
import { LAYOUT_HTML } from './templates/layout';

type Render = (data: Record<string, unknown>) => string;

// Times in emails are local clinic time (DOC 12: UTC in the API, Asia/Baku
// in the UI and in emails)
const dateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Baku',
  dateStyle: 'medium',
  timeStyle: 'short',
});

// Renders a Handlebars template and sends it with Nodemailer over SMTP
// (Mailpit in dev). Used only by EmailWorker.
@Injectable()
export class MailerService {
  private readonly transport: Transporter;
  private readonly from: string;
  private readonly templates = new Map<
    EmailTemplateName,
    { html: Render; text: Render }
  >();

  constructor(config: ConfigService) {
    const user = config.get<string>('SMTP_USER');
    const port = config.getOrThrow<number>('SMTP_PORT');
    this.transport = createTransport({
      host: config.getOrThrow<string>('SMTP_HOST'),
      port,
      secure: port === 465,
      auth: user ? { user, pass: config.get<string>('SMTP_PASS') } : undefined,
      // A dead SMTP server must fail the attempt within seconds, so the job
      // retries later instead of hanging
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    this.from = config.getOrThrow<string>('SMTP_FROM');

    const hbs = Handlebars.create();
    hbs.registerHelper('formatDate', (value: unknown) =>
      typeof value === 'string' && !Number.isNaN(Date.parse(value))
        ? dateFormat.format(new Date(value))
        : '',
    );
    const layout = hbs.compile(LAYOUT_HTML);
    for (const [name, source] of Object.entries(EMAIL_TEMPLATES)) {
      const html = hbs.compile(source.html); // HTML-escaped (names come from users)
      const text = hbs.compile(source.text, { noEscape: true });
      this.templates.set(name as EmailTemplateName, {
        html: (data) => layout({ body: html(data) }),
        text,
      });
    }
  }

  // messageId: stable per email_logs row, so a mail client can tell a
  // retried duplicate from a new message
  async send(email: {
    messageId: string;
    to: string;
    subject: string;
    template: EmailTemplateName;
    data: Record<string, unknown>;
  }): Promise<void> {
    const template = this.templates.get(email.template);
    if (!template) throw new Error(`Unknown email template ${email.template}`);
    await this.transport.sendMail({
      from: this.from,
      to: email.to,
      subject: email.subject,
      html: template.html(email.data),
      text: template.text(email.data),
      messageId: `<${email.messageId}@medflow.az>`,
    });
  }
}
