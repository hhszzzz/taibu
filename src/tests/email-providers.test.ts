import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMailerConfig, MAIL_PROVIDERS } from '../lib/email/providers';

const base = { SMTP_USER: 'relay-login@smtp-brevo.com', SMTP_PASS: 'secret', SMTP_FROM: 'noreply@mingai.fun' };

test('a provider preset supplies the relay host, port and encryption', () => {
  const config = resolveMailerConfig({ EMAIL_PROVIDER: 'brevo', ...base });
  assert.deepEqual(
    [config.transport, config.host, config.port, config.secure, config.user, config.from],
    ['smtp', 'smtp-relay.brevo.com', 587, false, 'relay-login@smtp-brevo.com', 'noreply@mingai.fun'],
  );

  const resend = resolveMailerConfig({ EMAIL_PROVIDER: 'resend', ...base });
  assert.deepEqual([resend.host, resend.port, resend.secure], ['smtp.resend.com', 465, true]);
});

test('explicit SMTP_* values override the preset, so any relay can be reached', () => {
  // A self-hosted Postfix on the compose network, and Tencent, whose host
  // depends on the account's region.
  const selfHosted = resolveMailerConfig({
    EMAIL_PROVIDER: 'custom',
    SMTP_HOST: 'mailrelay',
    SMTP_PORT: '25',
    SMTP_SECURE: 'false',
    ...base,
  });
  assert.deepEqual([selfHosted.host, selfHosted.port, selfHosted.secure], ['mailrelay', 25, false]);

  const tencent = resolveMailerConfig({
    EMAIL_PROVIDER: 'tencent',
    SMTP_HOST: 'sg-smtp.qcloudmail.com',
    ...base,
  });
  assert.deepEqual([tencent.host, tencent.port, tencent.secure], ['sg-smtp.qcloudmail.com', 465, true]);
});

test('Tencent without a host names the three regional hosts instead of failing obscurely', () => {
  assert.throws(
    () => resolveMailerConfig({ EMAIL_PROVIDER: 'tencent', ...base }),
    /gz-smtp\.qcloudmail\.com.*sg-smtp\.qcloudmail\.com/u,
  );
});

test('a port and an encryption setting that disagree are refused', () => {
  // The single most common relay misconfiguration: 465 needs implicit TLS.
  assert.throws(
    () => resolveMailerConfig({ EMAIL_PROVIDER: 'custom', SMTP_HOST: 'relay', SMTP_PORT: '465', SMTP_SECURE: 'false', ...base }),
    /SMTP_SECURE=false does not match SMTP_PORT=465/u,
  );
  assert.throws(
    () => resolveMailerConfig({ EMAIL_PROVIDER: 'custom', SMTP_HOST: 'relay', SMTP_PORT: '587', SMTP_SECURE: 'true', ...base }),
    /SMTP_SECURE=true does not match SMTP_PORT=587/u,
  );
});

test('credentials and the From address are required, and the message says which', () => {
  const { SMTP_USER: _user, ...noUser } = base;
  assert.throws(() => resolveMailerConfig({ EMAIL_PROVIDER: 'brevo', ...noUser }), /needs SMTP_USER/u);

  const { SMTP_PASS: _pass, ...noPass } = base;
  assert.throws(() => resolveMailerConfig({ EMAIL_PROVIDER: 'brevo', ...noPass }), /needs SMTP_PASS \(the SMTP key, not an API key\)/u);

  const { SMTP_FROM: _from, ...noFrom } = base;
  assert.throws(() => resolveMailerConfig({ EMAIL_PROVIDER: 'brevo', ...noFrom }), /SMTP_FROM is required/u);
});

test('an unknown provider is rejected with the list of known ones', () => {
  assert.throws(
    () => resolveMailerConfig({ EMAIL_PROVIDER: 'sendgrid', ...base }),
    new RegExp(`EMAIL_PROVIDER must be one of ${Object.keys(MAIL_PROVIDERS).join(', ')}`, 'u'),
  );
});

test('the retired EMAIL_TRANSPORT fails loudly instead of falling back to log', () => {
  assert.throws(
    () => resolveMailerConfig({ EMAIL_TRANSPORT: 'smtp', SMTP_HOST: 'relay', SMTP_PORT: '587', SMTP_SECURE: 'false', ...base }),
    /EMAIL_TRANSPORT is no longer supported/u,
  );
});

test('the log transport needs no relay but is refused in production', () => {
  assert.equal(resolveMailerConfig({}).transport, 'log');
  assert.throws(() => resolveMailerConfig({ NODE_ENV: 'production' }), /never delivers mail/u);
});

test('a password is never carried on a config that describes itself', async () => {
  const { describeMailer } = await import('../lib/email/mailer.server');
  process.env.EMAIL_PROVIDER = 'brevo';
  Object.assign(process.env, base);
  try {
    const described = describeMailer();
    assert.equal(described.password, undefined);
    assert.equal(described.hasPassword, true);
    assert.equal(described.host, 'smtp-relay.brevo.com');
  } finally {
    delete process.env.EMAIL_PROVIDER;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
  }
});
