'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import Link from 'next/link';
import { Camera, ChevronRight } from 'lucide-react';
import { ensureUserRecord, updateNickname } from '@/lib/auth';
import { uploadAvatarForCurrentUser } from '@/lib/user/profile';
import { buildMembershipInfo, formatMembershipExpiryDate, getPlanConfig } from '@/lib/user/membership';
import { getUserEmailDisplay } from '@/lib/user-email';
import { getSettingsCenterRouteTarget } from '@/lib/settings-center';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { StatusBanner } from '@/components/profile/StatusBanner';
import { PasswordSection } from '@/components/profile/PasswordSection';
import { SettingsRow } from '@/components/settings/SettingsControls';
import { SettingsLoginRequired } from '@/components/settings/SettingsLoginRequired';
import { useCurrentUserProfile } from '@/lib/hooks/useCurrentUserProfile';
import { useUnsavedSettingsGuard } from '@/lib/hooks/useUnsavedSettingsGuard';

function Avatar({ src, name }: { src: string | null; name: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) {
    return <span aria-hidden="true" className="settings-avatar-fallback">{Array.from(name)[0]?.toUpperCase() ?? '我'}</span>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={name} className="settings-avatar-image" onError={() => setFailedSrc(src)} />
  );
}

export default function ProfilePanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ensuredUserIdRef = useRef<string | null>(null);
  const { user, loading: sessionLoading } = useSessionSafe();
  const { profile, loading: profileLoading, resolved: profileResolved, error: profileError, refresh: refreshProfile } = useCurrentUserProfile({ enabled: !!user });
  const [nickname, setNickname] = useState('');
  const [originalNickname, setOriginalNickname] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  useUnsavedSettingsGuard(!loading && !!user && nickname !== originalNickname);

  useEffect(() => {
    if (sessionLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    if (profileLoading) {
      return;
    }

    if (profile) {
      ensuredUserIdRef.current = null;
      setNickname(profile.nickname || '');
      setOriginalNickname(profile.nickname || '');
      setAvatarUrl(profile.avatar_url || null);
      setError('');
      setLoading(false);
      return;
    }

    setLoading(false);
    if (profileError) {
      setError(profileError.message || '加载账户失败');
      return;
    }
    if (!profileResolved) {
      return;
    }
    if (ensuredUserIdRef.current === user.id) {
      return;
    }
    ensuredUserIdRef.current = user.id;
    void ensureUserRecord(user).then(() => refreshProfile());
  }, [profile, profileError, profileLoading, profileResolved, refreshProfile, sessionLoading, user]);

  const handleSave = async () => {
    if (!user || !nickname.trim()) return;

    setSaving(true);
    setError('');
    setSuccess('');

    const result = await updateNickname(user.id, nickname.trim());
    if (result.success) {
      setOriginalNickname(nickname.trim());
      setSuccess('昵称已更新');
      window.setTimeout(() => setSuccess(''), 3000);
    } else {
      setError(result.error?.message || '保存失败');
    }

    setSaving(false);
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('图片大小不能超过 2MB');
      return;
    }

    setUploadingAvatar(true);
    setError('');

    try {
      const uploadResult = await uploadAvatarForCurrentUser(user.id, file);
      if (!uploadResult.success || !uploadResult.publicUrl) {
        throw new Error(uploadResult.error?.message || '头像上传失败');
      }

      setAvatarUrl(uploadResult.publicUrl);
      setSuccess('头像已更新');
      window.setTimeout(() => setSuccess(''), 3000);
    } catch (uploadError) {
      console.error('Avatar upload error:', uploadError);
      setError('头像上传失败，请重试');
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  if (loading || sessionLoading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <SoundWaveLoader variant="inline" />
      </div>
    );
  }

  if (!user) {
    return <SettingsLoginRequired title="请先登录后查看账户" />;
  }

  const hasNicknameChanges = nickname !== originalNickname;
  const displayEmail = getUserEmailDisplay(user);
  const membership = buildMembershipInfo(profile);
  const planName = getPlanConfig(membership.type).name;
  const membershipText = membership.expiresAt ? `${planName} · ${formatMembershipExpiryDate(membership.expiresAt)} 到期` : planName;

  return (
    <div>
      <StatusBanner error={error} success={success} />

      <section className="settings-section">
        <h3 className="settings-section-title">个人资料</h3>
        <div className="settings-card settings-profile-card">
          <div className="settings-avatar">
            <Avatar src={avatarUrl} name={nickname || displayEmail} />
            <button type="button" aria-label="更换头像" onClick={handleAvatarClick} disabled={uploadingAvatar} className="settings-avatar-button">
              <Camera size={15} aria-hidden="true" />
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
          </div>
          <div className="settings-profile-fields">
            <label htmlFor="account-nickname" className="text-[13px] text-foreground-secondary">显示昵称</label>
            <div className="flex gap-2">
              <input
                id="account-nickname"
                type="text"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                className="settings-input min-w-0 flex-1"
              />
              {hasNicknameChanges ? (
                <button type="button" onClick={handleSave} disabled={saving || !nickname.trim()} className="settings-button settings-button-primary">
                  {saving ? '保存中...' : '保存'}
                </button>
              ) : null}
            </div>
            <span className="text-xs text-foreground-tertiary">{uploadingAvatar ? '头像上传中...' : '社区发帖与评论时显示此昵称'}</span>
          </div>
        </div>
        <div className="settings-group">
          <SettingsRow label="电子邮箱" control={<span className="text-sm text-foreground-secondary">{displayEmail}</span>} />
          <SettingsRow
            label="会员"
            control={(
              <Link href={getSettingsCenterRouteTarget('upgrade')} className="inline-flex items-center gap-1 text-sm text-accent hover:text-accent-hover">
                {membershipText}<ChevronRight size={15} aria-hidden="true" />
              </Link>
            )}
          />
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-section-title">安全</h3>
        <PasswordSection email={user.email || ''} />
      </section>
    </div>
  );
}
