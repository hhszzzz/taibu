const LINUXDO_AUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth_denied: 'Linux.do 登录已取消，请重试',
  missing_params: 'Linux.do 登录失败：缺少授权参数，请重试',
  missing_state: 'Linux.do 登录失败：登录状态已过期，请重新发起登录',
  invalid_state: 'Linux.do 登录失败：登录状态已失效，请重新发起登录',
  state_mismatch: 'Linux.do 登录失败：登录状态已过期，请重新发起登录',
  token_exchange_failed: 'Linux.do 登录失败：授权令牌获取失败，请稍后重试',
  userinfo_failed: 'Linux.do 登录失败：用户信息获取失败，请稍后重试',
  email_not_verified: 'Linux.do 登录失败：请先在 Linux.do 验证邮箱后再试',
  user_not_found: 'Linux.do 登录失败：账号记录异常，请稍后重试',
  provider_lookup_failed: 'Linux.do 登录失败：账号绑定查询失败，请稍后重试',
  provider_sync_failed: 'Linux.do 登录失败：账号绑定同步失败，请稍后重试',
  login_failed: 'Linux.do 登录失败：站内账号登录失败，请稍后重试',
  email_exists: '该 Linux.do 邮箱已绑定其他账号，请使用原登录方式',
  signup_failed: 'Linux.do 登录失败：创建账号失败，请稍后重试',
};

export function getLinuxDoAuthErrorMessage(errorCode: string | null | undefined): string | null {
  if (!errorCode) {
    return null;
  }

  return LINUXDO_AUTH_ERROR_MESSAGES[errorCode] ?? null;
}
