import type { MailMessage } from './mailer.js';

const NAVY = '#0B2D5B';

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** Minimal, inline-styled layout; mail clients ignore most of CSS. */
function layout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1d1d1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:40px 16px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:18px;padding:40px 32px">
<tr><td>
<p style="margin:0 0 24px;font-size:15px;font-weight:600;color:${NAVY};letter-spacing:-0.01em">disslxt</p>
${bodyHtml}
</td></tr></table>
</td></tr></table>
</body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:32px 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:${NAVY};color:#ffffff;text-decoration:none;font-size:17px;font-weight:500;padding:14px 28px;border-radius:980px">${escapeHtml(label)}</a></p>`;
}

const p = (text: string, muted = false) =>
  `<p style="margin:0 0 16px;font-size:17px;line-height:1.47;color:${muted ? '#6e6e73' : '#1d1d1f'}">${text}</p>`;

export function verificationMail(opts: {
  to: string;
  username: string;
  link: string;
  ttlHours: number;
}): MailMessage {
  const subject = 'Bestätige deine E-Mail-Adresse für disslxt';
  const text = [
    `Hallo ${opts.username},`,
    '',
    'bitte bestätige deine E-Mail-Adresse, um dein disslxt-Konto zu aktivieren:',
    '',
    opts.link,
    '',
    `Der Link ist ${opts.ttlHours} Stunden gültig und kann nur einmal verwendet werden.`,
    '',
    'Wenn du dich nicht bei disslxt registriert hast, ignoriere diese E-Mail einfach.',
    'Es wird dann kein Konto angelegt.',
  ].join('\n');
  const html = layout(
    subject,
    [
      `<h1 style="margin:0 0 16px;font-size:28px;line-height:1.14;font-weight:600;letter-spacing:-0.015em">E-Mail bestätigen</h1>`,
      p(`Hallo ${escapeHtml(opts.username)},`),
      p('bitte bestätige deine E-Mail-Adresse, um dein disslxt-Konto zu aktivieren.'),
      button(opts.link, 'E-Mail bestätigen'),
      p(`Der Link ist ${opts.ttlHours} Stunden gültig und kann nur einmal verwendet werden.`, true),
      p(
        'Wenn du dich nicht bei disslxt registriert hast, ignoriere diese E-Mail einfach. Es wird dann kein Konto angelegt.',
        true,
      ),
    ].join('\n'),
  );
  return { to: opts.to, subject, text, html };
}

/**
 * Sent instead of a confirmation when someone registers with an address that already has an
 * account. The API answers both cases identically, so only the mailbox owner learns which it was.
 */
export function accountExistsMail(opts: { to: string; loginLink: string }): MailMessage {
  const subject = 'Registrierungsversuch bei disslxt';
  const text = [
    'Hallo,',
    '',
    'jemand hat versucht, mit dieser E-Mail-Adresse ein neues disslxt-Konto anzulegen.',
    'Für diese Adresse gibt es aber bereits ein Konto. Du kannst dich hier anmelden:',
    '',
    opts.loginLink,
    '',
    'Wenn du das nicht warst, kannst du diese E-Mail ignorieren. An deinem Konto wurde nichts geändert.',
  ].join('\n');
  const html = layout(
    subject,
    [
      `<h1 style="margin:0 0 16px;font-size:28px;line-height:1.14;font-weight:600;letter-spacing:-0.015em">Du hast schon ein Konto</h1>`,
      p(
        'Jemand hat versucht, mit dieser E-Mail-Adresse ein neues disslxt-Konto anzulegen. Für diese Adresse gibt es aber bereits ein Konto.',
      ),
      button(opts.loginLink, 'Anmelden'),
      p(
        'Wenn du das nicht warst, kannst du diese E-Mail ignorieren. An deinem Konto wurde nichts geändert.',
        true,
      ),
    ].join('\n'),
  );
  return { to: opts.to, subject, text, html };
}

/** "Passwort vergessen": one-time link to set a new password. */
export function passwordResetMail(opts: {
  to: string;
  username: string;
  link: string;
  ttlMinutes: number;
}): MailMessage {
  const subject = 'Neues Passwort für disslxt';
  const text = [
    `Hallo ${opts.username},`,
    '',
    'für dein disslxt-Konto wurde ein neues Passwort angefordert. Hier kannst du es festlegen:',
    '',
    opts.link,
    '',
    `Der Link ist ${opts.ttlMinutes} Minuten gültig und funktioniert nur einmal. Danach bist du auf allen Geräten abgemeldet.`,
    '',
    'Wenn du das nicht warst, ignoriere diese E-Mail einfach – dein Passwort bleibt, wie es ist.',
  ].join('\n');
  const html = layout(
    subject,
    [
      `<h1 style="margin:0 0 16px;font-size:28px;line-height:1.14;font-weight:600;letter-spacing:-0.015em">Neues Passwort</h1>`,
      p(`Hallo ${escapeHtml(opts.username)},`),
      p('für dein disslxt-Konto wurde ein neues Passwort angefordert.'),
      button(opts.link, 'Neues Passwort festlegen'),
      p(
        `Der Link ist ${opts.ttlMinutes} Minuten gültig und funktioniert nur einmal. Danach bist du auf allen Geräten abgemeldet.`,
        true,
      ),
      p(
        'Wenn du das nicht warst, ignoriere diese E-Mail einfach – dein Passwort bleibt, wie es ist.',
        true,
      ),
    ].join('\n'),
  );
  return { to: opts.to, subject, text, html };
}
