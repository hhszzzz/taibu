/**
 * 技能编辑弹窗：管理员的平台技能与用户自己的技能共用。SKILL.md 可以直接粘贴或上传文件夹，附属文件按相对路径保存。
 *
 * 'use client' 标记说明：
 * - 草稿状态、读取所选文件、提交中状态
 *
 * 名称与描述写在 SKILL.md 的 frontmatter 里，保存时由服务端按 pi 的规则校验。
 */
'use client';

import { useId, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { FilePlus2, FolderUp, Trash2, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { SettingsSwitch } from '@/components/settings/SettingsControls';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { MEMBERSHIP_TIERS, MEMBERSHIP_TIER_LABELS } from '@/lib/agent/mcp/config';
import {
  SKILL_CONTENT_MAX_BYTES, SKILL_DOCUMENT, SKILL_FILES_MAX, SKILL_FILES_TOTAL_MAX_BYTES, formatSkillBytes,
  type SkillDetail, type SkillInput, type SkillScope,
} from '@/lib/agent/skills/config';
import { readPickedSkill } from '@/lib/agent/skills/folder';
import { estimateTokens } from '@/lib/agent/token-estimate';
import type { MembershipType } from '@/lib/user/membership';

/** What the editor starts from: a saved skill with its SKILL.md, or nothing for a new one. */
export type SkillEditorSeed = { skill: SkillDetail } | { skill: null };

/** A file the skill keeps: stored ones carry no content, picked ones carry theirs until saved. */
type DraftFile = { path: string; bytes: number; content?: string };
type Draft = { content: string; files: DraftFile[]; requiredTier: MembershipType; enabled: boolean; sortOrder: string };

const TEMPLATE = `---
name: my-skill
description: 这个技能做什么、什么时候用。Agent 根据这段描述决定是否加载它。
---

# 技能名称

写给 Agent 的做法：步骤、要点、输出格式。需要时引用同目录的附属文件，如 references/notes.md。
`;

function draftOf(seed: SkillEditorSeed): Draft {
  const { skill } = seed;
  return skill
    ? { content: skill.content, files: skill.files.map(file => ({ ...file })), requiredTier: skill.requiredTier, enabled: skill.enabled, sortOrder: String(skill.sortOrder) }
    : { content: TEMPLATE, files: [], requiredTier: 'free', enabled: true, sortOrder: '0' };
}

/** The editor's files merged with picked ones: a picked file replaces the one at its path. */
function merge(files: DraftFile[], picked: DraftFile[]) {
  const byPath = new Map(files.map(file => [file.path, file]));
  for (const file of picked) byPath.set(file.path, file);
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function payloadOf(draft: Draft, scope: SkillScope, seed: SkillEditorSeed): SkillInput {
  const sortOrder = Number(draft.sortOrder.trim());
  if (!draft.sortOrder.trim() || !Number.isInteger(sortOrder) || sortOrder < -10_000 || sortOrder > 10_000) throw new Error('排序须为 -10000–10000 的整数');
  if (!draft.content.trim()) throw new Error(`请填写 ${SKILL_DOCUMENT}`);
  if (new TextEncoder().encode(draft.content).length > SKILL_CONTENT_MAX_BYTES) throw new Error(`${SKILL_DOCUMENT} 最大 ${SKILL_CONTENT_MAX_BYTES / 1024} KB`);
  if (draft.files.length > SKILL_FILES_MAX) throw new Error(`附属文件最多 ${SKILL_FILES_MAX} 个`);
  if (draft.files.reduce((sum, file) => sum + file.bytes, 0) > SKILL_FILES_TOTAL_MAX_BYTES)
    throw new Error(`附属文件合计最大 ${SKILL_FILES_TOTAL_MAX_BYTES / 1024 / 1024} MB`);
  const stored = seed.skill;
  // An edit sends the files only when they changed: a new file, a replaced one or a removed one.
  const filesChanged = !stored || draft.files.some(file => file.content !== undefined)
    || draft.files.length !== stored.files.length;
  return {
    ...(stored && stored.content === draft.content ? {} : { content: draft.content }),
    ...(filesChanged ? { files: draft.files.map(file => file.content === undefined ? { path: file.path } : { path: file.path, content: file.content }) } : {}),
    enabled: draft.enabled, sortOrder,
    ...(scope === 'platform' ? { requiredTier: draft.requiredTier } : {}),
  };
}

type ControlProps = { id: string; 'aria-describedby'?: string };

function Field({ label, hint, wide, children }: { label: string; hint?: ReactNode; wide?: boolean; children: (props: ControlProps) => ReactNode }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className={`settings-field${wide ? ' is-wide' : ''}`}>
      <label htmlFor={id} className="settings-label">{label}</label>
      {children(hint ? { id, 'aria-describedby': hintId } : { id })}
      {hint ? <span id={hintId} className="mcp-hint">{hint}</span> : null}
    </div>
  );
}

export function SkillEditor({ scope, seed, onClose, onSubmit }: {
  scope: SkillScope;
  /** Null while closed. */
  seed: SkillEditorSeed | null;
  onClose: () => void;
  /** Resolves when saved; a rejection's message is shown in the dialog. */
  onSubmit: (input: SkillInput) => Promise<void>;
}) {
  const titleId = useId();
  const documentRef = useRef<HTMLTextAreaElement>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ seed: SkillEditorSeed | null; draft: Draft | null }>({ seed: null, draft: null });
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // A new seed (opening the dialog) starts a fresh draft; closing keeps the last one for the exit animation.
  if (seed && seed !== state.seed) {
    setState({ seed, draft: draftOf(seed) });
    setError(null);
    setNotice(null);
  }
  const draft = state.draft;
  const editing = state.seed?.skill ?? null;
  const set = (patch: Partial<Draft>) => setState(current => current.draft ? { ...current, draft: { ...current.draft, ...patch } } : current);

  /** A folder replaces SKILL.md and every file; added files join the ones the skill has. */
  const pick = async (event: ChangeEvent<HTMLInputElement>, replace: boolean) => {
    const list = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!list.length || !draft) return;
    setReading(true);
    setError(null);
    try {
      const picked = await readPickedSkill(list);
      if (replace && picked.content === null) throw new Error(`所选文件夹里没有可读取的 ${SKILL_DOCUMENT}（须为 UTF-8 文本）`);
      const files = picked.files.map(({ path, content, bytes }) => ({ path, content, bytes }));
      set({ ...(picked.content === null ? {} : { content: picked.content }), files: replace ? files : merge(draft.files, files) });
      const read = [picked.content === null ? '' : SKILL_DOCUMENT, files.length ? `${files.length} 个附属文件` : ''].filter(Boolean).join(' 与 ');
      setNotice([read ? `已读取 ${read}` : '没有可读取的文件', picked.skipped.length ? `跳过 ${picked.skipped.length} 个：${picked.skipped.slice(0, 5).join('、')}${picked.skipped.length > 5 ? ' 等' : ''}` : '']
        .filter(Boolean).join('；'));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : '读取文件失败');
    } finally {
      setReading(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || !state.seed || saving) return;
    let input: SkillInput;
    try {
      input = payloadOf(draft, scope, state.seed);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : '填写有误');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(input);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || reading;
  return (
    <Modal open={seed !== null} onClose={() => { if (!busy) onClose(); }} labelledBy={titleId} busy={busy} className="mcp-editor skill-editor" initialFocusRef={documentRef}>
      {draft ? (
        <form onSubmit={event => { void submit(event); }} noValidate>
          <div className="mcp-editor-head">
            <h2 id={titleId}>{editing ? `编辑技能「${editing.name}」` : '添加技能'}</h2>
            <button type="button" className="settings-icon-button" aria-label="关闭" disabled={busy} onClick={onClose}><X size={17} aria-hidden="true" /></button>
          </div>
          <div className="mcp-editor-body">
            <div className="skill-editor-sources">
              <button type="button" className="settings-button" disabled={busy} onClick={() => folderRef.current?.click()}>
                <FolderUp size={14} aria-hidden="true" />上传技能文件夹
              </button>
              <button type="button" className="settings-button" disabled={busy} onClick={() => filesRef.current?.click()}>
                <FilePlus2 size={14} aria-hidden="true" />添加文件
              </button>
              {reading ? <SoundWaveLoader variant="inline" /> : null}
              {/* webkitdirectory is not in React's input attributes; the ref sets it. */}
              <input ref={element => { folderRef.current = element; element?.setAttribute('webkitdirectory', ''); }} type="file" multiple hidden
                aria-hidden="true" tabIndex={-1} onChange={event => { void pick(event, true); }} />
              <input ref={filesRef} type="file" multiple hidden aria-hidden="true" tabIndex={-1} onChange={event => { void pick(event, false); }} />
            </div>
            {notice ? <p className="mcp-hint" role="status">{notice}</p> : null}
            <Field label={SKILL_DOCUMENT} wide hint={<>开头的 frontmatter 写 name（小写字母、数字与连字符）和 description；加一行 <code>disable-model-invocation: true</code> 则只能由你用 /skill:名称 调用。约 {estimateTokens('', draft.content).toLocaleString('en-US')} token。</>}>
              {props => <textarea {...props} ref={documentRef} className="settings-textarea skill-document" rows={14} spellCheck={false} value={draft.content}
                onChange={event => set({ content: event.target.value })} />}
            </Field>
            <fieldset className="mcp-group">
              <legend>附属文件</legend>
              {draft.files.length ? (
                <ul className="skill-files">
                  {draft.files.map(file => (
                    <li key={file.path}>
                      <code>{file.path}</code>
                      <span>{formatSkillBytes(file.bytes)}{file.content !== undefined ? ' · 待保存' : ''}</span>
                      <button type="button" className="settings-icon-button settings-icon-button-danger" aria-label={`移除「${file.path}」`} title="移除" disabled={busy}
                        onClick={() => set({ files: draft.files.filter(item => item.path !== file.path) })}>
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="mcp-hint">没有附属文件。正文引用的参考资料、模板可以随文件夹一起上传，Agent 用 read_skill_file 按路径读取；只保存文本，不会执行其中的脚本。</p>}
            </fieldset>
            <div className="mcp-fields">
              {scope === 'platform' ? (
                <Field label="会员等级" hint="达到这一等级的用户才能使用。">
                  {props => (
                    <select {...props} className="settings-select" value={draft.requiredTier} onChange={event => set({ requiredTier: event.target.value as MembershipType })}>
                      {MEMBERSHIP_TIERS.map(tier => <option key={tier} value={tier}>{MEMBERSHIP_TIER_LABELS[tier]} 及以上</option>)}
                    </select>
                  )}
                </Field>
              ) : null}
              <Field label="排序" hint={scope === 'user' ? '小的在前；超出数量上限时，靠后的暂不使用。' : '小的在前。'}>
                {props => <input {...props} className="settings-input" inputMode="numeric" value={draft.sortOrder} onChange={event => set({ sortOrder: event.target.value })} />}
              </Field>
              <div className="settings-field">
                <span className="settings-label" aria-hidden="true">启用</span>
                <SettingsSwitch label="启用这个技能" checked={draft.enabled} onToggle={() => set({ enabled: !draft.enabled })} />
              </div>
            </div>
          </div>
          <div className="mcp-editor-foot">
            {error ? <p role="alert">{error}</p> : null}
            <button type="button" className="settings-button" disabled={busy} onClick={onClose}>取消</button>
            <button type="submit" className="settings-button settings-button-primary" disabled={busy}>
              {saving ? <SoundWaveLoader variant="inline" /> : null}{editing ? '保存' : '添加'}
            </button>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}
