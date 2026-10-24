/**
 * Runs once per server process before the first request.
 *
 * Mail settings are validated here so a broken relay fails the deployment
 * health check instead of silently failing queued OTP deliveries later.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { validateMailer } = await import('@/lib/email/mailer.server');
  validateMailer();
}
