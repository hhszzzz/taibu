import { notFound, redirect } from 'next/navigation';
import { SETTINGS_CENTER_TABS, isSettingsCenterTab } from '@/lib/settings-center';
import { ADMIN_SUBTABS, isAdminSubtabOwner, isAdminSubTab, resolveAdminSubTab } from '@/lib/admin/settings-subtabs';

/**
 * 设置页只有这些分类与子页。列出来之后，路径不在这份清单里的请求在渲染前就被当成 404，
 * 状态码才是真的 404；否则根布局的 Suspense 会先把外壳推给浏览器，状态码已经定格在 200。
 */
export function generateStaticParams(): Array<{ section: string[] }> {
  const params: Array<{ section: string[] }> = [{ section: [] }];
  for (const tab of SETTINGS_CENTER_TABS) {
    params.push({ section: [tab] });
    if (isAdminSubtabOwner(tab)) for (const item of ADMIN_SUBTABS[tab]) params.push({ section: [tab, item.id] });
  }
  return params;
}

export const dynamicParams = false;

export default async function SettingsPage({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = await params;
  if (!section?.length) redirect('/settings/general');
  const [tab, subpath, ...extra] = section;
  if (!isSettingsCenterTab(tab) || extra.length) notFound();
  if (isAdminSubtabOwner(tab)) {
    if (!subpath) redirect(`/settings/${tab}/${resolveAdminSubTab(tab, null)}`);
    if (!isAdminSubTab(tab, subpath)) notFound();
  } else if (subpath) {
    notFound();
  }
  return null;
}
