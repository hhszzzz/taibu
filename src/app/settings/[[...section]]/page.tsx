import { notFound, redirect } from 'next/navigation';
import { isSettingsCenterTab } from '@/lib/settings-center';

export default async function SettingsPage({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = await params;
  if (!section?.length) redirect('/settings/general');
  const [tab, subpath, ...extra] = section;
  if (tab === 'admin-features' && !subpath) redirect('/settings/admin-features/toggles');
  if (tab === 'admin-ai-services' && !subpath) redirect('/settings/admin-ai-services/models');
  if (tab === 'admin-agent-extensions' && !subpath) redirect('/settings/admin-agent-extensions/mcp');
  if (!isSettingsCenterTab(tab) || extra.length || (subpath && !(
    (tab === 'admin-features' && ['toggles', 'keys'].includes(subpath)) ||
    (tab === 'admin-ai-services' && ['models', 'gateways', 'agent-tasks'].includes(subpath)) ||
    (tab === 'admin-agent-extensions' && ['mcp', 'policy'].includes(subpath))
  ))) notFound();
  return null;
}
