import { getSession } from '@/lib/auth';
import { getCurrentUserProfileBundle } from '@/lib/user/profile';

/** Whether the viewer is an administrator; signed-out visitors are not. */
export async function loadAdminClientAccessState(): Promise<{ isAdmin: boolean }> {
  const session = await getSession();
  if (!session) {
    return { isAdmin: false };
  }

  const bundle = await getCurrentUserProfileBundle();
  return { isAdmin: !!bundle.profile?.is_admin };
}
