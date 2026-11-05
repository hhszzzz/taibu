import 'server-only';

import { createTransport, type Transporter } from 'nodemailer';
import { resolveMailerConfig, type MailerConfig } from '@/lib/email/providers';

export type OutgoingMail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

type Mailer = { config: MailerConfig; transport: Transporter | null };

let cachedMailer: Mailer | undefined;

/** Fails the process at startup instead of inside a queued delivery. */
export function validateMailer(): MailerConfig {
  return resolveMailerConfig();
}

/** What the current environment resolves to, without the password. */
export function describeMailer(): MailerConfig & { hasPassword: boolean } {
  const config = resolveMailerConfig();
  return { ...config, password: undefined, hasPassword: Boolean(config.password) };
}

/** The environment is static after boot, so the config and transport are resolved once. */
function getMailer(): Mailer {
  if (cachedMailer) return cachedMailer;
  const config = resolveMailerConfig();
  cachedMailer = {
    config,
    transport: config.transport === 'log'
      ? null
      : createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        ...(config.user ? { auth: { user: config.user, pass: config.password } } : {}),
      }),
  };
  return cachedMailer;
}

export async function sendMail(mail: OutgoingMail): Promise<void> {
  const { config, transport } = getMailer();
  if (!transport) {
    console.info(`[email:log] to=${mail.to} subject=${mail.subject}\n${mail.text}`);
    return;
  }
  await transport.sendMail({
    from: config.from,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    ...(mail.html ? { html: mail.html } : {}),
  });
}
