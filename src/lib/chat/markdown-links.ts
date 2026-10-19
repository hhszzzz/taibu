/**
 * Markdown 链接：外链在新标签打开并切断 opener；站内相对链接与锚点留在当前页。
 */
export function isExternalHref(href: string | undefined) {
    return !!href && /^(?:https?:)?\/\//i.test(href.trim());
}

export function markdownLinkProps(href: string | undefined) {
    return isExternalHref(href) ? { target: '_blank', rel: 'noopener noreferrer' } as const : {};
}
