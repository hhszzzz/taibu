/** Menu letter keys: a single unmodified character triggers the item whose <kbd> shows it. */
export function findMenuShortcut(panel: Pick<ParentNode, 'querySelectorAll'>, event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>): HTMLElement | null {
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return null;
    const letter = event.key.toUpperCase();
    return [...panel.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)')]
        .find(item => item.querySelector('kbd')?.textContent?.trim().toUpperCase() === letter) ?? null;
}
