import 'server-only';

import { createTransport, type Transporter } from 'nodemailer';
import { resolveMailerConfig, type MailerConfig } from '@/lib/email/providers';

export type OutgoingMail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

let cachedTransport: Transporter | null | undefined;

/** What the current environment resolves to, without the password. */
export function describeMailer(): MailerConfig & { hasPassword: boolean } {
  const config = resolveMailerConfig();
  return { ...config, password: undefined, hasPassword: Boolean(config.password) };
}

function getTransport(): Transporter | null {
  if (cachedTransport !== undefined) return cachedTransport;
  const config = resolveMailerConfig();
  if (config.transport === 'log') {
    cachedTransport = null;
    return cachedTransport;
  }
  cachedTransport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.user ? { auth: { user: config.user, pass: config.password } } : {}),
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
    from: resolveMailerConfig().from,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    ...(mail.html ? { html: mail.html } : {}),
  });
}
