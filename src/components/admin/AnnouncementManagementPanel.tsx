'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Eye, EyeOff, PencilLine, Trash2 } from 'lucide-react';
import { requestBrowserData } from '@/lib/browser-api';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import type { Announcement } from '@/lib/announcement';

type PanelView = 'history' | 'editor';
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
      const payload = await requestBrowserData<{ announcements?: Announcement[] }>(
        '/api/admin/announcements',
        { method: 'GET' },
        { fallbackMessage: '获取公告列表失败' },
      );
      const nextAnnouncements = (payload.announcements || []) as Announcement[];
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
    void loadAnnouncements();
  }, [loadAnnouncements]);

  const selectedAnnouncement = useMemo(
    () => announcements.find((item) => item.id === selectedId) || null,
    [announcements, selectedId],
  );

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
      const payload = await requestBrowserData<{ announcement?: Announcement }>(
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

      const saved = payload.announcement as Announcement;
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
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="min-w-0 text-lg font-semibold text-[#37352f]">公告历史</h2>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={startCreateAnnouncement}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#2383e2] px-3 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-[#1d74c9] active:bg-[#1a64b0]"
            >
              新建公告
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-[240px] items-center justify-center">
            <SoundWaveLoader variant="inline" />
          </div>
        ) : error ? (
          <div className="py-12 text-center text-sm text-[#37352f]/45">{error}</div>
        ) : announcements.length === 0 ? (
          <div className="py-12 text-center text-sm text-[#37352f]/45">还没有任何公告</div>
        ) : (
          <div className="space-y-2">
            {announcements.map((announcement) => {
              const isSelected = announcement.id === selectedId;

              return (
                <div
                  key={announcement.id}
                  className={`rounded-xl border px-4 py-3 transition-colors duration-150 ${
                    isSelected
                      ? 'border-[#e2d8c6] bg-[#f7f2ea]'
                      : 'border-[#f0ece5] bg-white hover:bg-[#faf7f1]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => selectAnnouncement(announcement)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          selectAnnouncement(announcement);
                        }
                      }}
                      className="min-w-0 flex-1 cursor-pointer text-left"
                    >
                      <div className="text-[11px] font-medium tracking-tight text-[#37352f]/38">
                        {formatPublishedAt(announcement.publishedAt)}
                      </div>
                      {announcement.content.trim() ? (
                        <div className="mt-1 overflow-hidden text-sm leading-6 text-[#37352f]/82">
                          <MarkdownContent
                            content={announcement.content}
                            className="text-sm leading-6 text-[#37352f]/82"
                          />
                        </div>
                      ) : (
                        <div className="mt-1 text-sm leading-6 text-[#37352f]/45">
                          暂无内容
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => selectAnnouncement(announcement)}
                        className="rounded-md p-1.5 text-[#37352f]/45 transition-colors duration-150 hover:bg-[#ebe5db] hover:text-[#2eaadc]"
                        title="编辑"
                      >
                        <PencilLine className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteAnnouncement(announcement)}
                        disabled={deletingId === announcement.id}
                        className="rounded-md p-1.5 text-[#37352f]/45 transition-colors duration-150 hover:bg-[#ebe5db] hover:text-[#eb5757] disabled:opacity-50"
                        title="删除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={resetToHistory}
          className="inline-flex items-center gap-1.5 text-sm text-[#37352f]/50 transition-colors duration-150 hover:text-[#37352f]"
        >
          <ArrowLeft className="h-4 w-4" />
          返回历史
        </button>

        <button
          type="button"
          onClick={() => void saveAnnouncement()}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#2383e2] px-3 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-[#1d74c9] active:bg-[#1a64b0] disabled:opacity-50"
        >
          {saving ? '保存中...' : mode === 'create' ? '发布公告' : '保存修改'}
        </button>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[#37352f]">{mode === 'create' ? '新建公告' : '编辑公告'}</h2>

        <div className="grid gap-3 border-b border-[#ece7de] pb-4 text-sm md:grid-cols-[88px_minmax(0,1fr)]">
          <span className="text-[#37352f]/45">当前状态</span>
          <span className="leading-6 text-[#37352f]">
            {selectedAnnouncement
              ? `已发布于 ${formatPublishedAt(selectedAnnouncement.publishedAt)}，保存后即时生效。`
              : '未发布，保存后即时生效。'}
          </span>
        </div>

        <section className="space-y-2">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-[#37352f]">公告内容</h3>
            <p className="text-xs leading-5 text-[#37352f]/40">支持 Markdown，建议用标题、列表、加粗、链接等基础语法。</p>
          </div>
          <textarea
            value={form.content}
            onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
            className="min-h-[220px] w-full resize-y rounded-xl border border-[#e6e1d8] bg-[#fcfbf8] px-4 py-3 text-sm leading-7 text-[#37352f] outline-none transition-all duration-150 focus:border-gray-300 focus:ring-2 focus:ring-blue-500/20"
            placeholder="输入公告内容，支持多段文本..."
          />
        </section>

        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-[#37352f]">Markdown 预览</h3>
              <p className="text-xs leading-5 text-[#37352f]/40">默认收起，需要时再展开查看实际展示效果。</p>
            </div>
            <button
              type="button"
              onClick={() => setPreviewOpen((current) => !current)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#e6e1d8] bg-[#faf7f1] px-3 py-1.5 text-xs text-[#37352f]/70 transition-colors duration-150 hover:bg-[#f4efe6] hover:text-[#37352f]"
            >
              {previewOpen ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {previewOpen ? '收起预览' : '展开预览'}
            </button>
          </div>

          {previewOpen ? (
            <div className="rounded-xl border border-[#ece7de] bg-[#fbfaf7] px-4 py-4">
              {form.content.trim() ? (
                <MarkdownContent content={form.content} className="text-sm leading-7 text-[#37352f]/85" />
              ) : (
                <div className="flex min-h-[120px] items-center justify-center text-sm text-[#37352f]/35">
                  输入公告内容后，这里会显示 Markdown 预览
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[#ddd6ca] bg-[#faf7f1] px-4 py-4 text-sm text-[#37352f]/45">
              预览已收起。需要确认展示效果时再展开即可。
            </div>
          )}
        </section>
      </section>
    </div>
  );
}
