/**
 * 验证码「填满即提交」的判定。
 *
 * 输入组件在值填满时自动调用一次提交回调；回调在每次渲染时都是新函数，
 * 所以要不要再触发不能只看「值填满了」，还要看这个完整的值是否已经提交过。
 * 验证失败后用户改动任意一位（值变化）才会得到新的完整值，重新触发。
 */
export function nextCompletedCode(completed: string | null, value: string, length: number): string | null {
    if (value.length < length) return null;
    return completed === value ? null : value;
}
