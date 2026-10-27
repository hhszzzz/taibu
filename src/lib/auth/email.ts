/**
 * 登录表单里的邮箱地址。
 *
 * 输入框收完整的邮箱地址（不再拆前缀 + 后缀下拉），所以只需要两件事：
 * 提交前去掉首尾空白，以及边填边给出「还不像邮箱」的提示。
 */
const COMPLETE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/** The address as it is sent to Better Auth: surrounding whitespace dropped, nothing else changed. */
export function normalizeAuthEmail(value: string): string {
    return value.trim();
}

/** True for something shaped like name@host.tld; the final word still belongs to the auth server. */
export function isCompleteEmail(value: string): boolean {
    return COMPLETE_EMAIL.test(normalizeAuthEmail(value));
}
