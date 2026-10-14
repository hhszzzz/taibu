/**
 * 设置中心各面板的未登录状态
 */
import { LoginRequiredState } from '@/components/auth/LoginRequiredState';

interface SettingsLoginRequiredProps {
  title?: string;
  description?: string;
}

export function SettingsLoginRequired({
  title = '请先登录',
  description = '登录后即可使用个性化设置、命盘管理和知识库等个人能力。',
}: SettingsLoginRequiredProps) {
  return <LoginRequiredState layout="framed" title={title} description={description} />;
}
