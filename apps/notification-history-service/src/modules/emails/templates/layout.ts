// Shared HTML frame of every email: calm, white, one teal accent (DOC 9).
// {{{body}}} is the rendered template (already escaped by Handlebars).
export const LAYOUT_HTML = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f7f7;font-family:Arial,Helvetica,sans-serif;color:#1f2933">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;padding:32px">
          <tr><td style="font-size:20px;font-weight:bold;color:#0f766e;padding-bottom:16px">MedFlow</td></tr>
          <tr><td style="font-size:15px;line-height:1.6">{{{body}}}</td></tr>
          <tr><td style="font-size:12px;color:#7b8794;padding-top:24px">
            This is an automatic message from MedFlow. Please do not reply.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

export const BUTTON = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${href}" style="background:#0f766e;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${label}</a></p>`;
