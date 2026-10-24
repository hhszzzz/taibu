/**
 * One SMTP client, many providers. Every relay we care about — Brevo, Resend,
 * Tencent SES, a self-hosted Postfix — speaks SMTP, so the only thing that
 * differs is the host, the port and whether the connection starts encrypted.
 * A provider preset fills those in; credentials and the From address stay
 * explicit. Anything the preset cannot know (Tencent's region, a private
 * relay's hostname) is left to the operator.
 *
 * This module is pure: it reads a plain environment object and returns a
 * resolved configuration or throws with an actionable message. `mailer.server.ts`
 * is the only caller that turns it into a nodemailer transport.
 */

export type MailTransport = 'smtp' | 'mailpit' | 'log';

export type MailProviderId = 'custom' | 'brevo' | 'resend' | 'tencent' | 'mailpit' | 'log';

export interface MailProviderPreset {
    /** The driver that ultimately sends. */
    transport: MailTransport;
    /** Shown in error messages. */
    label: string;
    /** Fixed relay host, or null when the operator must supply one. */
    host: string | null;
    /** Why a host is required, for providers whose host depends on the account. */
    hostHint?: string;
    port: number;
    /** Implicit TLS from the first byte (port 465). False means STARTTLS or plain. */
    secure: boolean;
    requiresAuth: boolean;
}

export const MAIL_PROVIDERS: Readonly<Record<MailProviderId, MailProviderPreset>> = {
    custom: { transport: 'smtp', label: '自定义 SMTP', host: null, hostHint: 'SMTP_HOST', port: 587, secure: false, requiresAuth: true },
    brevo: { transport: 'smtp', label: 'Brevo', host: 'smtp-relay.brevo.com', port: 587, secure: false, requiresAuth: true },
    resend: { transport: 'smtp', label: 'Resend', host: 'smtp.resend.com', port: 465, secure: true, requiresAuth: true },
    tencent: {
        transport: 'smtp',
        label: '腾讯云邮件推送',
        host: null,
        hostHint: 'SMTP_HOST：广州区 gz-smtp.qcloudmail.com，香港区 smtp.qcloudmail.com，国际站 sg-smtp.qcloudmail.com',
        port: 465,
        secure: true,
        requiresAuth: true,
    },
    mailpit: { transport: 'mailpit', label: 'Mailpit（本地）', host: '127.0.0.1', port: 1025, secure: false, requiresAuth: false },
    log: { transport: 'log', label: '仅记录日志', host: null, port: 0, secure: false, requiresAuth: false },
};

export interface MailerConfig {
    provider: MailProviderId;
    transport: MailTransport;
    host?: string;
    port?: number;
    secure?: boolean;
    user?: string;
    password?: string;
    from?: string;
}

export type MailerEnv = Record<string, string | undefined>;

function present(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

/**
 * Ports that carry implicit TLS and ports that upgrade with STARTTLS are not
 * interchangeable: a client that guesses wrong fails to connect with an error
 * that does not name the real cause. Reject the mismatch instead.
 */
function secureForPort(port: number): boolean | null {
    if (port === 465) return true;
    if (port === 587 || port === 2525) return false;
    return null;
}

export function resolveMailerConfig(env: MailerEnv = process.env): MailerConfig {
    if (present(env.EMAIL_TRANSPORT)) {
        // Better a startup failure than silently falling back to log.
        throw new Error('EMAIL_TRANSPORT is no longer supported; set EMAIL_PROVIDER (smtp is now the custom preset)');
    }
    const requested = (present(env.EMAIL_PROVIDER) ?? '').toLowerCase();
    const providerId = (requested || 'log') as MailProviderId;

    const preset = MAIL_PROVIDERS[providerId];
    if (!preset) {
        throw new Error(
            `EMAIL_PROVIDER must be one of ${Object.keys(MAIL_PROVIDERS).join(', ')}; got ${providerId}`,
        );
    }

    if (preset.transport === 'log') {
        if (env.NODE_ENV === 'production') {
            throw new Error('EMAIL_PROVIDER=log never delivers mail and is not allowed in production');
        }
        return { provider: providerId, transport: 'log', from: present(env.SMTP_FROM) };
    }

    const host = present(env.SMTP_HOST) ?? preset.host ?? undefined;
    if (!host) {
        throw new Error(`${preset.label} needs a relay host. Set ${preset.hostHint ?? 'SMTP_HOST'}.`);
    }

    const port = Number(present(env.SMTP_PORT) ?? preset.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
        throw new Error(`SMTP_PORT is not a port: ${env.SMTP_PORT}`);
    }

    const expectedSecure = secureForPort(port);
    const configuredSecure = present(env.SMTP_SECURE);
    const secure = configuredSecure === undefined ? preset.secure : configuredSecure === 'true';
    if (expectedSecure !== null && secure !== expectedSecure) {
        throw new Error(
            `SMTP_SECURE=${secure} does not match SMTP_PORT=${port}: ` +
                `port ${port} needs SMTP_SECURE=${expectedSecure} (${expectedSecure ? 'implicit TLS' : 'STARTTLS'})`,
        );
    }

    const user = present(env.SMTP_USER);
    const password = present(env.SMTP_PASS);
    if (preset.requiresAuth) {
        if (!user) throw new Error(`${preset.label} needs SMTP_USER (the relay login, not the relay hostname)`);
        if (!password) throw new Error(`${preset.label} needs SMTP_PASS (the SMTP key, not an API key)`);
    }

    const from = present(env.SMTP_FROM);
    if (!from) throw new Error('SMTP_FROM is required; it must be an address on a verified sending domain');

    return {
        provider: providerId,
        transport: preset.transport,
        host,
        port,
        secure,
        ...(user ? { user } : {}),
        ...(password ? { password } : {}),
        from,
    };
}
