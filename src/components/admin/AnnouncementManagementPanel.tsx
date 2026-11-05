'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUnsavedSettingsGuard } from '@/lib/hooks/useUnsavedSettingsGuard';
import { ArrowLeft, Eye, EyeOff, PencilLine, Plus, Trash2 } from 'lucide-react';
import { requestBrowserData } from '@/lib/browser-api';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { getAnnouncementExcerpt, type Announcement } from '@/lib/announcement';
import { Textarea } from '@/components/ui/Textarea';

type PanelView = 'history' | 'editor';

const CARD = 'rounded-2xl border border-border bg-surface';
type EditorMode = 'create' | 'edit';

type AnnouncementFormState = {
  id: string | null;
  content: string;
  publishedAt: string | null;
};

function emptyFormState(): AnnouncementFormState {
  return {
    id: null,
    content: '',
    publishedAt: null,
  };
}

function announcementToFormState(announcement: Announcement): AnnouncementFormState {
  return {
    id: announcement.id,
    content: announcement.content,
    publishedAt: announcement.publishedAt,
  };
}

function formatPublishedAt(value: string | null) {
  if (!value) return '未发布';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AnnouncementManagementPanel() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);
  const [view, setView] = useState<PanelView>('history');
  const [mode, setMode] = useState<EditorMode>('create');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<AnnouncementFormState>(emptyFormState());
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();
  const selectedIdRef = useRef<string | null>(selectedId);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const resetToHistory = useCallback(() => {
    setView('history');
    setMode('create');
    setSelectedId(null);
    setForm(emptyFormState());
    setPreviewOpen(false);
  }, []);

  const loadAnnouncements = useCallback(async (preferredSelectedId?: string | null) => {
    setLoading(true);
    setError(null);

    try {
      const { announcements: nextAnnouncements = [] } = await requestBrowserData<{ announcements?: Announcement[] }>(
        '/api/admin/announcements',
        { method: 'GET' },
        { fallbackMessage: '获取公告列表失败' },
      );
      setAnnouncements(nextAnnouncements);

      const nextSelectedId = preferredSelectedId ?? selectedIdRef.current;
      if (!nextSelectedId) {
        return;
      }

      const selected = nextAnnouncements.find((item) => item.id === nextSelectedId);
      if (!selected) {
        resetToHistory();
        return;
      }

      setMode('edit');
      setSelectedId(selected.id);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '获取公告列表失败');
    } finally {
      setLoading(false);
    }
  }, [resetToHistory]);

  useEffect(() => {
    void Promise.resolve().then(() => loadAnnouncements());
  }, [loadAnnouncements]);

  const selectedAnnouncement = useMemo(
    () => announcements.find((item) => item.id === selectedId) || null,
    [announcements, selectedId],
  );
  useUnsavedSettingsGuard(view === 'editor' && JSON.stringify(form) !== JSON.stringify(selectedAnnouncement ? announcementToFormState(selectedAnnouncement) : emptyFormState()));

  const startCreateAnnouncement = () => {
    setView('editor');
    setMode('create');
    setSelectedId(null);
    setForm(emptyFormState());
    setPreviewOpen(false);
  };

  const selectAnnouncement = (announcement: Announcement) => {
    setView('editor');
    setMode('edit');
    setSelectedId(announcement.id);
    setForm(announcementToFormState(announcement));
    setPreviewOpen(false);
  };

  const saveAnnouncement = async () => {
    if (!form.content.trim()) {
      showToast('error', '公告内容不能为空');
      return;
    }

    setSaving(true);
    try {
      const { announcement: saved } = await requestBrowserData<{ announcement: Announcement }>(
        form.id ? `/api/admin/announcements/${form.id}` : '/api/admin/announcements',
        {
          method: form.id ? 'PATCH' : 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content: form.content,
          }),
        },
        { fallbackMessage: '保存公告失败' },
      );

      setView('editor');
      setMode('edit');
      setSelectedId(saved.id);
      setForm(announcementToFormState(saved));
      setPreviewOpen(false);
      showToast('success', form.id ? '公告已更新' : '公告已发布');
      await loadAnnouncements(saved.id);
    } catch (saveError) {
      showToast('error', saveError instanceof Error ? saveError.message : '保存公告失败');
    } finally {
      setSaving(false);
    }
  };

  const deleteAnnouncement = async (announcement: Announcement) => {
    setDeletingId(announcement.id);
    try {
      await requestBrowserData(
        `/api/admin/announcements/${announcement.id}`,
        {
          method: 'DELETE',
        },
        { fallbackMessage: '删除公告失败' },
      );

      const deletingSelected = selectedId === announcement.id;
      if (deletingSelected) {
        resetToHistory();
      }

      setDeleteTarget(null);
      showToast('success', '公告已删除');
      await loadAnnouncements(deletingSelected ? null : selectedId);
    } catch (deleteError) {
      showToast('error', deleteError instanceof Error ? deleteError.message : '删除公告失败');
    } finally {
      setDeletingId(null);
    }
  };

  if (view === 'history') {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[13px] font-medium text-foreground-tertiary">
            公告历史{loading || error ? null : <span className="ml-1.5 font-normal tabular-nums">{announcements.length}</span>}
          </h3>
          <Button onClick={startCreateAnnouncement}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            新建公告
          </Button>
        </div>

        {loading ? (
          <div className="flex min-h-[240px] items-center justify-center">
            <SoundWaveLoader variant="inline" />
          </div>
        ) : error ? (
          <div role="alert" className="settings-alert">
            {error}
            <Button variant="ghost" size="xs" onClick={() => { void loadAnnouncements(); }}>重试</Button>
          </div>
        ) : announcements.length === 0 ? (
          <div className={`px-6 py-12 text-center text-[15px] text-foreground ${CARD}`}>还没有任何公告</div>
        ) : (
          <ul className={`overflow-hidden ${CARD}`}>
            {announcements.map((announcement) => (
              // 整行点击进入编辑：编辑按钮的伪元素铺满整行，删除按钮叠在其上。
              <li
                key={announcement.id}
                className="relative flex items-start gap-3 py-3.5 pl-5 pr-2.5 transition-colors duration-150 hover:bg-background-secondary/50 [&+li]:border-t [&+li]:border-border"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs tabular-nums text-foreground-tertiary">{formatPublishedAt(announcement.publishedAt)}</p>
                  <p className="mt-1 line-clamp-2 text-sm leading-6 text-foreground">
                    {getAnnouncementExcerpt(announcement.content) || <span className="text-foreground-tertiary">暂无内容</span>}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-0.5">
                  <IconButton
                    onClick={() => selectAnnouncement(announcement)}
                    label={`编辑公告（${formatPublishedAt(announcement.publishedAt)}）`}
                    title="编辑"
                    size="sm"
                    expand="none"
                    className="after:absolute after:inset-0 after:content-['']"
                  >
                    <PencilLine aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    onClick={() => setDeleteTarget(announcement)}
                    disabled={deletingId === announcement.id}
                    label={`删除公告（${formatPublishedAt(announcement.publishedAt)}）`}
                    title="删除"
                    size="sm"
                    tone="danger"
                    className="z-10"
                  >
                    <Trash2 aria-hidden="true" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        )}

        <ConfirmDialog
          isOpen={!!deleteTarget}
          onClose={() => { if (!deletingId) setDeleteTarget(null); }}
          onConfirm={() => (deleteTarget ? deleteAnnouncement(deleteTarget) : undefined)}
          title="删除公告"
          description="删除后用户将不再看到这条公告，此操作无法撤销。"
          confirmText="确认删除"
          variant="danger"
          loading={!!deletingId}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={resetToHistory} className="-ml-3">
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          返回历史
        </Button>
        <Button onClick={() => void saveAnnouncement()} loading={saving} loadingText="保存中…" disabled={saving}>
          {mode === 'create' ? '发布公告' : '保存修改'}
        </Button>
      </div>

      <section className="flex flex-col gap-5" aria-labelledby="announcement-editor-heading">
        <div className="flex flex-col gap-1">
          <h3 id="announcement-editor-heading" className="font-display text-xl font-medium text-foreground">
            {mode === 'create' ? '新建公告' : '编辑公告'}
          </h3>
          <p className="settings-help">
            {selectedAnnouncement
              ? `已发布于 ${formatPublishedAt(selectedAnnouncement.publishedAt)}，保存后即时生效。`
              : '未发布，保存后即时生效。'}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="announcement-content" className="settings-label">公告内容</label>
          <Textarea
            id="announcement-content"
            aria-describedby="announcement-content-hint"
            value={form.content}
            onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
            className="min-h-[220px]" 
            placeholder="输入公告内容，支持多段文本..."
          />
          <p id="announcement-content-hint" className="settings-help">支持 Markdown，建议用标题、列表、加粗、链接等基础语法。</p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="settings-label">Markdown 预览</h4>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPreviewOpen((current) => !current)}
              aria-expanded={previewOpen}
              aria-controls="announcement-preview"
            >
              {previewOpen ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
              {previewOpen ? '收起预览' : '展开预览'}
            </Button>
          </div>

          <div id="announcement-preview" hidden={!previewOpen} className={`px-5 py-4 ${CARD}`}>
            {form.content.trim() ? (
              <MarkdownContent content={form.content} className="text-sm leading-7 text-foreground" />
            ) : (
              <div className="flex min-h-[120px] items-center justify-center text-sm text-foreground-secondary">
                输入公告内容后，这里会显示 Markdown 预览
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
