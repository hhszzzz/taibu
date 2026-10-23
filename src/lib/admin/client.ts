import { getSession } from '@/lib/auth';
import { getCurrentUserProfileBundle } from '@/lib/user/profile';

export type AdminClientAccessState = {
  loading: boolean;
  isAuthed: boolean;
  isAdmin: boolean;
};

export const UNAUTHED_ADMIN_ACCESS_STATE: AdminClientAccessState = {
  loading: false,
  isAuthed: false,
  isAdmin: false,
};

export async function loadAdminClientAccessState(): Promise<AdminClientAccessState> {
  const session = await getSession();
  if (!session) {
    return UNAUTHED_ADMIN_ACCESS_STATE;
  }

  const bundle = await getCurrentUserProfileBundle();
  return {
    loading: false,
    isAuthed: true,
    isAdmin: !!bundle.profile?.is_admin,
  };
}
