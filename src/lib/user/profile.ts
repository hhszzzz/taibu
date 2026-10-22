import type { MembershipType } from '@/lib/user/membership';
import type { UserSettingsSnapshot } from '@/lib/user/settings';
import { normalizeBrowserApiError, requestBrowserJson } from '@/lib/browser-api';

export type UserProfile = {
  id: string;
  nickname: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  membership: MembershipType | null;
  membership_expires_at: string | null;
  ai_chat_count: number | null;
};

export type UserProfileBundle = {
  profile: UserProfile | null;
  settings: UserSettingsSnapshot | null;
};

export type ProfileUpdateInput = {
  profile?: {
    nickname?: string;
    avatar_url?: string | null;
  };
};

export type ProfileUpdateResult = {
  success: boolean;
  profile: UserProfile | null;
  settings: UserSettingsSnapshot | null;
  error?: { message: string; code?: string };
};

function toProfileUpdateResult(result: Awaited<ReturnType<typeof requestBrowserJson<UserProfileBundle>>>): ProfileUpdateResult {
  if (result.error) {
    return {
      success: false,
      profile: null,
      settings: null,
      error: {
        message: result.error.message || '更新用户资料失败',
        code: result.error.code,
      },
    };
  }

  return {
    success: true,
    profile: result.data?.profile ?? null,
    settings: result.data?.settings ?? null,
  };
}

export async function getCurrentUserProfileBundle(): Promise<UserProfileBundle> {
  const result = await requestBrowserJson<UserProfileBundle>('/api/user/profile', {
    method: 'GET',
  });

  if (result.error) {
    throw new Error(result.error.message || '获取用户资料失败');
  }

  if (!result.data) {
    throw new Error('获取用户资料失败');
  }

  return result.data;
}

export async function updateCurrentUserProfile(input: ProfileUpdateInput): Promise<ProfileUpdateResult> {
  const payload: ProfileUpdateInput = {};

  if (input.profile) {
    payload.profile = {};
    if (typeof input.profile.nickname === 'string') {
      payload.profile.nickname = input.profile.nickname.trim();
    }
    if (typeof input.profile.avatar_url === 'string' || input.profile.avatar_url === null) {
      payload.profile.avatar_url = input.profile.avatar_url;
    }
  }

  const result = await requestBrowserJson<UserProfileBundle>('/api/user/profile', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

  return toProfileUpdateResult(result);
}

export async function updateAvatarUrl(avatarUrl: string | null) {
  return updateCurrentUserProfile({
    profile: {
      avatar_url: avatarUrl,
    },
  });
}

export async function updateNickname(nickname: string) {
  return updateCurrentUserProfile({
    profile: {
      nickname,
    },
  });
}

export async function uploadAvatarForCurrentUser(file: File | Blob): Promise<{
  success: boolean;
  publicUrl: string | null;
  error?: { message: string; code?: string };
}> {
  const formData = new FormData();
  formData.append('file', file);

  // 上传路由按会话用户生成 key、写入 public.users.avatar_url 并清理旧文件。
  const uploadResult = await fetch('/api/files/avatars', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  const uploadPayload = await uploadResult.json().catch(() => null) as {
    data?: { publicUrl?: string | null } | null;
    error?: unknown;
  } | null;

  const uploadError = !uploadResult.ok
    ? normalizeBrowserApiError(uploadPayload?.error ?? null)
    : null;

  const publicUrl = uploadPayload?.data?.publicUrl ?? null;
  if (uploadError || !publicUrl) {
    return {
      success: false,
      publicUrl: null,
      error: uploadError || { message: '头像上传失败' },
    };
  }

  return {
    success: true,
    publicUrl,
  };
}
