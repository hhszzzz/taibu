import { notFound, redirect } from 'next/navigation';
import { isSettingsCenterTab } from '@/lib/settings-center';
import { isAdminSubtabOwner, isAdminSubTab, resolveAdminSubTab } from '@/lib/admin/settings-subtabs';

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
