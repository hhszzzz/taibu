import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_SHORTCUTS, isShortcutSheetKey, isWorkspaceToggleKey, modifierLabel, shouldStopOnEscape } from '../lib/chat/chat-shortcuts';
import { documentFileProblem, pickPlainAttachment, dragHasFiles } from '../lib/chat/composer-files';
import { MAX_DOCUMENT_BYTES } from '../lib/ai/document-formats';
import { isExternalHref, markdownLinkProps } from '../lib/chat/markdown-links';

const key = (patch: Partial<Parameters<typeof shouldStopOnEscape>[0]> = {}) => ({
    key: 'Escape', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, isComposing: false, ...patch,
});
const page = (open: string | null = null) => ({ querySelector: (selector: string) => open && selector.includes(open) ? ({} as Element) : null });

test('Esc stops only a running answer and leaves Escape to dialogs, menus, pickers and editors', () => {
    assert.equal(shouldStopOnEscape(key(), true, page()), true);
    assert.equal(shouldStopOnEscape(key(), false, page()), false, 'nothing to stop');
    assert.equal(shouldStopOnEscape(key({ defaultPrevented: true }), true, page()), false, 'inline edit / rename consumed it');
    assert.equal(shouldStopOnEscape(key({ isComposing: true }), true, page()), false, 'IME composition');
    assert.equal(shouldStopOnEscape(key({ shiftKey: true }), true, page()), false);
    assert.equal(shouldStopOnEscape(key({ key: 'Enter' }), true, page()), false);
    for (const owner of ['dialog[open]', '[role="menu"]', '[role="listbox"]', '.chat-mention-popover']) {
        assert.equal(shouldStopOnEscape(key(), true, page(owner)), false, owner);
    }
});

test('⌘/ (or Ctrl /) opens the shortcut sheet, and the sheet lists the wired shortcuts', () => {
    assert.equal(isShortcutSheetKey(key({ key: '/', metaKey: true })), true);
    assert.equal(isShortcutSheetKey(key({ key: '/', ctrlKey: true })), true);
    assert.equal(isShortcutSheetKey(key({ key: '/' })), false, 'plain / starts a composer command');
    assert.equal(isShortcutSheetKey(key({ key: '/', metaKey: true, isComposing: true })), false);
    assert.equal(modifierLabel('MacIntel'), '⌘');
    assert.equal(modifierLabel('Win32'), 'Ctrl');
    const sheet = Object.fromEntries(CHAT_SHORTCUTS.map(item => [item.label, item.keys('⌘').join(' ')]));
    assert.equal(sheet['搜索对话'], '⌘ K');
    assert.equal(sheet['新建对话'], '⇧ ⌘ O');
    assert.equal(sheet['停止生成'], 'Esc');
    assert.equal(sheet['键盘快捷键'], '⌘ /');
    assert.equal(sheet['打开或关闭工作区'], '⌘ \\');
});

test('⌘\\ toggles the workspace only as a bare modifier chord', () => {
    assert.equal(isWorkspaceToggleKey(key({ key: '\\', metaKey: true })), true);
    assert.equal(isWorkspaceToggleKey(key({ key: '\\', ctrlKey: true })), true);
    assert.equal(isWorkspaceToggleKey(key({ key: '\\' })), false, 'a typed backslash stays in the composer');
    assert.equal(isWorkspaceToggleKey(key({ key: '\\', metaKey: true, shiftKey: true })), false);
    assert.equal(isWorkspaceToggleKey(key({ key: '\\', metaKey: true, isComposing: true })), false, 'an IME composition keeps the key');
});

test('plain chat takes one document from dropped or pasted files and explains what it left out', () => {
    const doc = { name: '命书.pdf', type: 'application/pdf' };
    const note = { name: '笔记.md', type: 'text/markdown' };
    const photo = { name: '掌纹.png', type: 'image/png' };
    assert.deepEqual(pickPlainAttachment([doc]), { file: doc, notice: null });
    assert.deepEqual(pickPlainAttachment([photo]), { file: null, notice: '图片需切换到 Agent 模式' });
    assert.deepEqual(pickPlainAttachment([photo, doc]), { file: doc, notice: '图片需切换到 Agent 模式，已只添加文档' });
    assert.deepEqual(pickPlainAttachment([doc, note]), { file: doc, notice: '普通对话每次只能附加一个文件，已添加「命书.pdf」' });
    const legacy = { name: '旧稿.doc', type: 'application/msword' };
    assert.deepEqual(pickPlainAttachment([legacy, note]), { file: note, notice: '普通对话每次只能附加一个文件，已添加「笔记.md」' }, 'a readable document is preferred');
    assert.deepEqual(pickPlainAttachment([legacy]), { file: null, notice: '暂不支持 Word 97-2003（.doc）文件，请另存为 .docx 后上传' });
    assert.match(pickPlainAttachment([{ name: 'a.exe', type: 'application/octet-stream' }]).notice ?? '', /^不支持该文件类型，可上传 PDF、Word、Excel/u);
    assert.equal(documentFileProblem({ name: '命书.pdf', size: 1 }), null);
    assert.equal(documentFileProblem({ name: '命书.pdf', size: MAX_DOCUMENT_BYTES + 1 }), '文件不能超过 10MB');
    assert.match(documentFileProblem({ name: 'a.exe', size: 1 }) ?? '', /^不支持该文件类型/u);
    assert.equal(dragHasFiles(['text/plain', 'Files']), true);
    assert.equal(dragHasFiles(['text/uri-list']), false, 'links dragged inside the page show no drop overlay');
});

test('answer links open external sites in a new tab without opener and keep in-app links in place', () => {
    assert.equal(isExternalHref('https://example.com'), true);
    assert.equal(isExternalHref('//cdn.example.com/x'), true);
    assert.equal(isExternalHref('/records?id=1'), false);
    assert.equal(isExternalHref('#cite-1'), false);
    assert.equal(isExternalHref(undefined), false);
    assert.deepEqual(markdownLinkProps('https://example.com'), { target: '_blank', rel: 'noopener noreferrer' });
    assert.deepEqual(markdownLinkProps('/chat'), {});
});

test('menu letter keys pick the item whose <kbd> shows that letter', async () => {
    const { findMenuShortcut } = await import('../lib/motion/menu-shortcut');
    const item = (letter: string | null, label: string) => ({ label, querySelector: () => (letter === null ? null : { textContent: ` ${letter} ` }) });
    const items = [item(null, '对话记录视图'), item('R', '重命名'), item('D', '删除对话')];
    const panel = { querySelectorAll: () => items } as unknown as Pick<ParentNode, 'querySelectorAll'>;
    const press = (keyName: string, patch: Partial<KeyboardEvent> = {}) => findMenuShortcut(panel, { key: keyName, ctrlKey: false, metaKey: false, altKey: false, ...patch });
    assert.equal((press('r') as unknown as { label: string })?.label, '重命名');
    assert.equal((press('D') as unknown as { label: string })?.label, '删除对话');
    assert.equal(press('x'), null);
    assert.equal(press('r', { metaKey: true }), null, '⌘R stays the browser reload');
    assert.equal(press('Enter'), null);
});

test('a task completion toast opens its conversation', async () => {
    const { taskNoticeHref } = await import('../components/providers/AgentNotificationBridge');
    assert.equal(taskNoticeHref({ link: '/chat?id=c1&message=m', event_data: { conversationId: 'c1' } }), '/chat?id=c1&message=m');
    assert.equal(taskNoticeHref({ link: '/scheduled', event_data: undefined }), '/scheduled', 'a schedule that lost its conversation links to its own page');
    assert.equal(taskNoticeHref({ link: 'https://evil.example/chat?id=c1', event_data: { conversationId: 'c 2' } }), '/chat?id=c%202', 'only in-app links are followed');
    assert.equal(taskNoticeHref({ link: '//evil.example/chat', event_data: { conversationId: 'c3' } }), '/chat?id=c3', 'a protocol-relative link is not an in-app link');
    assert.equal(taskNoticeHref({ link: null, event_data: undefined }), null);
});
