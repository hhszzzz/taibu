/**
 * 对话页键盘快捷键：Esc 停止生成、⌘/ 打开快捷键说明，以及说明面板列出的全站快捷键。
 *
 * 表里的每一项都对应已接线的处理器（⌘K 搜索、⇧⌘O 新建、⌘U 上传、菜单字母键等），
 * 新增快捷键时同步这里，避免说明与实际行为脱节。
 */

type KeyInput = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'defaultPrevented' | 'isComposing'>;

/** Surfaces that own Escape themselves: Esc closes them instead of stopping the answer. */
const ESCAPE_OWNERS = 'dialog[open], [aria-modal="true"], [role="menu"], [role="listbox"], .chat-mention-popover';

/** Esc stops a running answer unless a dialog, menu, picker or inline editor consumes it first. */
export function shouldStopOnEscape(event: KeyInput, running: boolean, root: Pick<ParentNode, 'querySelector'>) {
    if (!running || event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return false;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
    return !root.querySelector(ESCAPE_OWNERS);
}

/** ⌘/ (Ctrl / elsewhere) toggles the shortcut sheet. */
export function isShortcutSheetKey(event: KeyInput) {
    return !event.isComposing && event.key === '/' && (event.metaKey || event.ctrlKey) && !event.altKey;
}

export type ChatShortcut = { label: string; keys: (mod: string) => string[] };

export const CHAT_SHORTCUTS: readonly ChatShortcut[] = [
    { label: '搜索对话', keys: mod => [mod, 'K'] },
    { label: '新建对话', keys: mod => ['⇧', mod, 'O'] },
    { label: '上传文件', keys: mod => [mod, 'U'] },
    { label: '发送消息', keys: () => ['Enter'] },
    { label: '换行', keys: () => ['Shift', 'Enter'] },
    { label: '停止生成', keys: () => ['Esc'] },
    { label: '菜单内执行对应项', keys: () => ['字母键'] },
    { label: '键盘快捷键', keys: mod => [mod, '/'] },
];

export const modifierLabel = (platform: string) => (/Mac|iPhone|iPad/.test(platform) ? '⌘' : 'Ctrl');
