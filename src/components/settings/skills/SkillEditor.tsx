/**
 * 技能弹窗：管理员的平台技能与用户自己的技能共用。
 * 只接受上传包含 SKILL.md 的文件夹，正文与附属文件都由所选文件夹决定，不在本地编辑。
 *
 * 'use client' 标记说明：
 * - 读取所选文件、提交中状态
 */
'use client';

import { useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { FolderUp, X } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import {
  SKILL_CONTENT_MAX_BYTES, SKILL_DOCUMENT, SKILL_FILES_TOTAL_MAX_BYTES, formatSkillBytes,
  type SkillInput, type SkillView,
} from '@/lib/agent/skills/config';
import { readPickedSkill } from '@/lib/agent/skills/folder';

export type SkillEditorSeed = { skill: SkillView | null };

type Picked = { content: string; files: Array<{ path: string; content: string; bytes: number }>; skipped: string[] };

/** The first value of a top-level frontmatter key, for the preview only; the server validates the document. */
function frontmatterValue(content: string, key: string) {
  const block = content.match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1];
  const lines = block?.split(/\r?\n/u) ?? [];
  const index = lines.findIndex(line => line.startsWith(`${key}:`));
  if (index < 0) return '';
  const inline = lines[index].slice(key.length + 1).trim();
  if (/^[>|][+-]?$/u.test(inline)) {
    const parts: string[] = [];
    for (const line of lines.slice(index + 1)) {
      if (!/^\s+/u.test(line)) break;
      parts.push(line.trim());
    }
    return parts.join(' ').trim();
  }
  return inline.replace(/^['"]|['"]$/gu, '');
}

export function SkillEditor({ seed, onClose, onSubmit }: {
  /** Null while closed. */
  seed: SkillEditorSeed | null;
  onClose: () => void;
  /** Resolves when saved; a rejection's message is shown in the dialog. */
  onSubmit: (input: SkillInput) => Promise<void>;
}) {
  const titleId = useId();
  const folderRef = useRef<HTMLInputElement | null>(null);
  const uploadRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<{ seed: SkillEditorSeed | null; picked: Picked | null }>({ seed: null, picked: null });
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A new seed (opening the dialog) starts empty; closing keeps the last one for the exit animation.
  if (seed && seed !== state.seed) {
    setState({ seed, picked: null });
    setError(null);
  }
  const picked = state.picked;
  const editing = state.seed?.skill ?? null;

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!list.length) return;
    setReading(true);
    setError(null);
    try {
      const read = await readPickedSkill(list);
      if (read.content === null) throw new Error(`所选文件夹里没有可读取的 ${SKILL_DOCUMENT}（须为 UTF-8 文本）`);
      const bytes = new TextEncoder().encode(read.content).length;
      if (bytes > SKILL_CONTENT_MAX_BYTES) throw new Error(`${SKILL_DOCUMENT} 最大 ${SKILL_CONTENT_MAX_BYTES / 1024} KB`);
      if (read.files.reduce((sum, file) => sum + file.bytes, 0) > SKILL_FILES_TOTAL_MAX_BYTES)
        throw new Error(`附属文件合计最大 ${SKILL_FILES_TOTAL_MAX_BYTES / 1024 / 1024} MB`);
      setState(current => ({ ...current, picked: { content: read.content!, files: read.files, skipped: read.skipped } }));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : '读取文件失败');
    } finally {
      setReading(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!picked || !state.seed || saving || reading) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        content: picked.content,
        files: picked.files.map(file => ({ path: file.path, content: file.content })),
        enabled: state.seed.skill?.enabled ?? true,
      });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || reading;
  const size = picked ? picked.files.reduce((sum, file) => sum + file.bytes, 0) + new TextEncoder().encode(picked.content).length : 0;
  const name = picked ? frontmatterValue(picked.content, 'name') : '';
  const description = picked ? frontmatterValue(picked.content, 'description') : '';
  return (
    <Dialog bare open={seed !== null} onClose={() => { if (!busy) onClose(); }} labelledBy={titleId} busy={busy}
      className="mcp-editor skill-editor" initialFocusRef={uploadRef}>
      {state.seed ? (
        <form onSubmit={event => { void submit(event); }} noValidate>
          <div className="mcp-editor-head">
            <h2 id={titleId}>{editing ? `替换技能「${editing.name}」` : '上传技能'}</h2>
            <IconButton label="关闭" size="sm" disabled={busy} onClick={onClose}><X size={17} aria-hidden="true" /></IconButton>
          </div>
          <div className="mcp-editor-body">
            <p className="mcp-hint">选择一个包含 {SKILL_DOCUMENT} 的文件夹；正文与附属文件都取自该文件夹。</p>
            <div className="skill-upload">
              <Button ref={uploadRef} variant="secondary" disabled={busy} onClick={() => folderRef.current?.click()}>
                <FolderUp size={14} aria-hidden="true" />上传技能
              </Button>
              {reading ? <SoundWaveLoader variant="inline" /> : null}
              <input ref={element => { folderRef.current = element; element?.setAttribute('webkitdirectory', ''); }} type="file" multiple hidden
                aria-hidden="true" tabIndex={-1} onChange={event => { void pick(event); }} />
            </div>
            {picked ? (
              <dl className="skill-upload-summary">
                <dt>名称</dt><dd>{name || '—'}</dd>
                <dt>说明</dt><dd>{description || '—'}</dd>
                <dt>文件</dt><dd>{SKILL_DOCUMENT} 与 {picked.files.length} 个附属文件 · {formatSkillBytes(size)}</dd>
                {picked.skipped.length ? <><dt>跳过</dt><dd>{picked.skipped.length} 个不支持的文件</dd></> : null}
              </dl>
            ) : null}
          </div>
          <div className="mcp-editor-foot">
            {error ? <p role="alert">{error}</p> : null}
            <Button type="button" variant="ghost" size="lg" disabled={busy} onClick={onClose}>取消</Button>
            <Button type="submit" size="lg" loading={saving} disabled={busy || !picked}>{editing ? '替换' : '保存'}</Button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}
