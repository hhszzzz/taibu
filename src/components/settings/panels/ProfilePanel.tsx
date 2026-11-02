'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import Link from 'next/link';
import { Camera, ChevronRight } from 'lucide-react';
import { ensureUserRecord, updateNickname } from '@/lib/auth';
import { uploadAvatarForCurrentUser } from '@/lib/user/profile';
import { formatUsd } from '@/lib/billing/money';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { getUserEmailDisplay } from '@/lib/user-email';
import { getSettingsCenterRouteTarget } from '@/lib/settings-center';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { IconButton } from '@/components/ui/IconButton';
import { StatusBanner } from '@/components/profile/StatusBanner';
import { PasswordSection } from '@/components/profile/PasswordSection';
import { SettingsRow, SettingsSaveBar } from '@/components/settings/SettingsControls';
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
  const { profile, balance, loading: profileLoading, resolved: profileResolved, error: profileError, refresh: refreshProfile } = useCurrentUserProfile({ enabled: !!user });
  const { isFeatureEnabled } = useFeatureToggles();
  const billingEnabled = isFeatureEnabled('billing');
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
    void Promise.resolve().then(() => {
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
      void ensureUserRecord().then(() => refreshProfile());
    });
  }, [profile, profileError, profileLoading, profileResolved, refreshProfile, sessionLoading, user]);

  const handleSave = async () => {
    if (!user || !nickname.trim()) return;

    setSaving(true);
    setError('');
    setSuccess('');

    const result = await updateNickname(nickname.trim());
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
      const uploadResult = await uploadAvatarForCurrentUser(file);
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
  const balanceText = balance ? `可用 ${formatUsd(balance.spendableMicros)}` : '—';

  return (
    <div>
      <StatusBanner error={error} success={success} />

      <section className="settings-section">
        <div className="settings-section-heading">
          <h3 className="settings-section-title">个人资料</h3>
          <p className="settings-section-description">你在社区与对话中的公开身份。</p>
        </div>
        <div className="settings-section-body">
          <div className="settings-card settings-profile-card">
            <div className="settings-avatar">
              <Avatar src={avatarUrl} name={nickname || displayEmail} />
              <IconButton label="更换头像" size="xs" variant="secondary" onClick={handleAvatarClick} disabled={uploadingAvatar} className="settings-avatar-button">
                <Camera size={15} aria-hidden="true" />
              </IconButton>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
            </div>
            <div className="settings-profile-fields">
              <Field
                label="显示昵称"
                controlId="account-nickname"
                description={uploadingAvatar ? '头像上传中…' : '社区发帖与评论时显示此昵称'}
                className="min-w-0 flex-1"
              >
                <Input
                  id="account-nickname"
                  type="text"
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                />
              </Field>
            </div>
          </div>
          <div className="settings-group">
            <SettingsRow label="电子邮箱" control={<span className="text-sm text-foreground-secondary">{displayEmail}</span>} />
            {billingEnabled ? (
              <SettingsRow
                label="余额"
                control={
                  <Link href={getSettingsCenterRouteTarget('billing')} className="inline-flex items-center gap-1 text-sm tabular-nums text-accent hover:text-accent-hover">
                    {balanceText}<ChevronRight size={15} aria-hidden="true" />
                  </Link>
                }
              />
            ) : null}
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-heading">
          <h3 className="settings-section-title">安全</h3>
          <p className="settings-section-description">通过绑定邮箱验证后修改密码。</p>
        </div>
        <div className="settings-section-body">
          <PasswordSection email={user.email || ''} />
        </div>
      </section>

      {hasNicknameChanges ? (
        <SettingsSaveBar
          message="昵称有未保存的更改"
          saving={saving}
          saveDisabled={!nickname.trim()}
          saveLabel="保存昵称"
          onCancel={() => { setNickname(originalNickname); setError(''); }}
          onSave={() => void handleSave()}
        />
      ) : null}
    </div>
  );
}
