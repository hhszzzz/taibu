import 'server-only';

import { createTransport, type Transporter } from 'nodemailer';

export type OutgoingMail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

type TransportName = 'smtp' | 'mailpit' | 'log';

function transportName(): TransportName {
  const name = (process.env.EMAIL_TRANSPORT ?? 'log').trim();
  if (name !== 'smtp' && name !== 'mailpit' && name !== 'log') {
    throw new Error(`EMAIL_TRANSPORT must be smtp, mailpit or log, got ${name}`);
  }
  return name;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} configuration`);
  return value;
}

let cachedTransport: Transporter | null | undefined;

function getTransport(): Transporter | null {
  if (cachedTransport !== undefined) return cachedTransport;
  const name = transportName();
  if (name === 'log') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('EMAIL_TRANSPORT=log is not allowed in production');
    }
    cachedTransport = null;
    return cachedTransport;
  }
  const mailpit = name === 'mailpit';
  const host = mailpit ? (process.env.SMTP_HOST || '127.0.0.1') : requireEnv('SMTP_HOST');
  const port = Number(mailpit ? (process.env.SMTP_PORT || '1025') : requireEnv('SMTP_PORT'));
  const user = process.env.SMTP_USER;
  cachedTransport = createTransport({
    host,
    port,
    secure: mailpit ? false : process.env.SMTP_SECURE === 'true',
    ...(user ? { auth: { user, pass: requireEnv('SMTP_PASS') } } : {}),
  });
  return cachedTransport;
}

export async function sendMail(mail: OutgoingMail): Promise<void> {
  const transport = getTransport();
  if (!transport) {
    console.info(`[email:log] to=${mail.to} subject=${mail.subject}\n${mail.text}`);
    return;
  }
  await transport.sendMail({
    from: requireEnv('SMTP_FROM'),
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    ...(mail.html ? { html: mail.html } : {}),
  });
}
