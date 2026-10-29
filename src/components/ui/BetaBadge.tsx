/**
 * Beta 标记：任何尚在调整的功能入口都可以用的小胶囊。
 * 只做视觉与提示，不影响无障碍名称（读屏名称仍以入口本身为准）。
 */
export function BetaBadge({ className = '' }: { className?: string }) {
  return <span className={`beta-badge${className ? ` ${className}` : ''}`} title="Beta 功能，仍在调整">beta</span>;
}
