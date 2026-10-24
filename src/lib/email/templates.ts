export type OtpEmailType = 'sign-in' | 'email-verification' | 'forget-password' | 'change-email';

export type EmailTemplate = {
  subject: string;
  text: string;
  html: string;
};

const COPY: Record<OtpEmailType, { subject: string; action: string }> = {
  'sign-in': { subject: '登录验证码', action: '登录' },
  'email-verification': { subject: '邮箱验证码', action: '验证邮箱' },
  'forget-password': { subject: '重置密码验证码', action: '重置密码' },
  'change-email': { subject: '修改邮箱验证码', action: '修改邮箱' },
};

export function renderOtpEmail({ otp, type }: { otp: string; type: OtpEmailType }): EmailTemplate {
  const { subject, action } = COPY[type];
  const text = [
    `你正在${action}命理排盘账号，验证码：${otp}`,
    '',
    '验证码 10 分钟内有效，只能使用一次。',
    '如果不是你本人操作，请忽略这封邮件，不要向任何人透露验证码。',
  ].join('\n');
  const html = [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;line-height:1.7;color:#1f2937">',
    `<p>你正在${action}命理排盘账号，验证码：</p>`,
    `<p style="font-size:28px;font-weight:600;letter-spacing:6px;margin:16px 0">${otp}</p>`,
    '<p>验证码 10 分钟内有效，只能使用一次。</p>',
    '<p style="color:#6b7280">如果不是你本人操作，请忽略这封邮件，不要向任何人透露验证码。</p>',
    '</div>',
  ].join('');
  return { subject: `【命理排盘】${subject}`, text, html };
}

/**
 * Sent when someone tries to register with an address that already has an
 * account. Better Auth answers the browser generically so the form cannot be
 * used to enumerate accounts; only the mailbox owner learns what happened.
 */
export function renderExistingAccountEmail(): EmailTemplate {
  const text = [
    '有人刚刚尝试用这个邮箱注册命理排盘账号，但该邮箱已经注册过了。',
    '',
    '如果这是你本人：请直接登录。忘记密码时，在登录框选择“忘记密码”并重置。',
    '如果不是你本人：无需处理，这封邮件已经说明了情况，你的账号没有被改动。',
  ].join('\n');
  const html = [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;line-height:1.7;color:#1f2937">',
    '<p>有人刚刚尝试用这个邮箱注册命理排盘账号，但该邮箱已经注册过了。</p>',
    '<p>如果这是你本人：请直接登录。忘记密码时，在登录框选择“忘记密码”并重置。</p>',
    '<p style="color:#6b7280">如果不是你本人：无需处理，这封邮件已经说明了情况，你的账号没有被改动。</p>',
    '</div>',
  ].join('');
  return { subject: '【命理排盘】有人尝试用你的邮箱注册', text, html };
}
