import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { builtinModules } from 'node:module';
import ts from 'typescript';

const root = process.cwd();
const failures = [];
const missingInputs = new Set();

function reportMissingInput(relativePath) {
  if (!missingInputs.has(relativePath)) {
    missingInputs.add(relativePath);
    failures.push(`${relativePath}: required architecture input is missing`);
  }
}

function read(relativePath) {
  try {
    return readFileSync(resolve(root, relativePath), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    reportMissingInput(relativePath);
    return null;
  }
}

function walk(relativeDir, files = []) {
  if (!existsSync(resolve(root, relativeDir))) {
    reportMissingInput(relativeDir);
    return files;
  }

  for (const entry of readdirSync(resolve(root, relativeDir), { withFileTypes: true })) {
    if (entry.name.startsWith('.')) {
      continue;
    }

    const nextPath = join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      walk(nextPath, files);
      continue;
    }

    files.push(nextPath);
  }

  return files;
}

function mustExist(relativePath, reason) {
  if (!existsSync(resolve(root, relativePath))) {
    failures.push(`${relativePath}: ${reason}`);
  }
}

function mustNotExist(relativePath, reason) {
  if (existsSync(resolve(root, relativePath))) {
    failures.push(`${relativePath}: ${reason}`);
  }
}

function mustMatch(relativePath, pattern, reason) {
  const source = read(relativePath);
  if (source !== null && !pattern.test(source)) {
    failures.push(`${relativePath}: ${reason}`);
  }
}

function mustNotMatch(relativePath, pattern, reason) {
  const source = read(relativePath);
  if (source !== null && pattern.test(source)) {
    failures.push(`${relativePath}: ${reason}`);
  }
}

function mustNotMatchInTree(relativeDir, pattern, reason, predicate = () => true) {
  for (const file of walk(relativeDir)) {
    if (!predicate(file)) {
      continue;
    }

    const source = read(file);
    if (source !== null && pattern.test(source)) {
      failures.push(`${file}: ${reason}`);
    }
  }
}

mustExist('src/lib/hooks/session-context.tsx', 'session state should have a component-independent context entrypoint');
mustNotMatchInTree(
  'src/lib/hooks',
  /from\s*['"]@\/components\/providers\/ClientProviders['"]/u,
  'base hooks should depend on session-context instead of the provider composition component',
  (file) => /\.(ts|tsx)$/u.test(file),
);
mustNotMatch(
  'src/lib/chat/ConversationListContext.tsx',
  /from\s*['"]@\/components\/providers\/ClientProviders['"]/u,
  'conversation state should depend on the shared session context, not provider composition',
);
mustNotMatch(
  'src/components/providers/ClientProviders.tsx',
  /\bcreateContext\b/u,
  'provider composition should reuse the extracted context instead of declaring another store',
);

mustExist('src/lib/auth.ts', 'browser auth should converge on the unified auth entrypoint');
mustNotExist('src/lib/auth-client.ts', 'legacy browser auth client entrypoint should stay removed');
mustNotExist('src/app/api/supabase/proxy/route.ts', 'legacy supabase proxy route should stay removed');
mustNotExist('src/lib/data-sources/init.ts', 'data source side-effect init should stay removed');
mustNotExist('src/lib/divination/qimen-shared.ts', 'legacy qimen shared adapter should stay removed');
mustNotExist('src/lib/divination/liuyao-traditional.ts', 'legacy liuyao traditional adapter should stay removed');
mustNotExist('src/app/api/notifications/launch/route.ts', 'legacy notifications launch route should stay removed after announcement split');
mustNotExist('src/app/api/mbti/history/route.ts', 'legacy mbti history route should stay removed after history-summaries migration');
mustNotExist('src/app/api/chat/title/route.ts', 'legacy chat title route should stay removed after draft-title convergence');
mustNotExist('src/lib/title-utils.ts', 'legacy title helper should stay removed after draft-title convergence');
mustNotExist('src/lib/user-charts.ts', 'duplicate chart browser helper should stay removed after charts-client convergence');
mustNotExist('src/lib/admin/request.ts', 'thin admin request wrapper should stay removed after browser-api convergence');
mustNotExist('src/app/admin/payment/page.tsx', 'legacy admin payment entry should stay removed after settings-center convergence');
mustNotExist('src/app/user/orders/page.tsx', 'legacy user orders entry should stay removed after membership-center convergence');
mustNotExist('src/app/user/settings/ai/page.tsx', 'legacy ai-settings alias page should stay removed after route convergence');
mustNotExist('src/app/checkin/page.tsx', 'legacy checkin shell should stay removed after settings-center convergence');
mustNotExist('src/app/help/page.tsx', 'legacy help shell should stay removed after settings-center convergence');
mustNotExist('src/app/user/page.tsx', 'legacy user shell should stay removed after settings-center convergence');
mustNotExist('src/app/admin/announcements/page.tsx', 'legacy admin announcements shell should stay removed after settings-center convergence');
mustNotExist('src/app/admin/features/page.tsx', 'legacy admin features shell should stay removed after settings-center convergence');
mustNotExist('src/app/admin/ai-services/page.tsx', 'legacy admin AI services shell should stay removed after settings-center convergence');
mustNotExist('src/app/admin/mcp/page.tsx', 'legacy admin MCP shell should stay removed after settings-center convergence');
mustNotExist('src/components/settings/SettingsRouteLauncher.tsx', 'legacy settings route launcher should stay removed after settings-center convergence');
mustNotExist('src/components/admin/McpKeyManagementPanel.tsx', 'authenticated MCP key management should stay removed for the public MCP service');
mustNotExist('src/app/api/admin/mcp-keys/route.ts', 'authenticated MCP admin key route should stay removed for the public MCP service');
mustNotExist('src/app/api/user/mcp-key/route.ts', 'authenticated MCP user key route should stay removed for the public MCP service');
mustNotExist('src/lib/mcp-keys.ts', 'authenticated MCP key storage helper should stay removed for the public MCP service');

for (const file of [
  'src/app/api/activation-keys/route.ts',
  'src/app/api/mbti/route.ts',
  'src/app/api/hepan/route.ts',
  'src/app/api/qimen/route.ts',
  'src/app/api/liuyao/route.ts',
  'src/app/api/tarot/route.ts',
  'src/app/api/daliuren/route.ts',
  'src/app/api/palm/route.ts',
  'src/app/api/face/route.ts',
  'src/app/api/meihua/route.ts',
  'src/app/api/xiaoliuren/route.ts',
]) {
  mustNotMatch(
    file,
    /requireBearerUser\(/u,
    'browser-driven routes should not require bearer-only auth',
  );
}

for (const file of [
  'src/app/api/mbti/route.ts',
  'src/app/api/hepan/route.ts',
  'src/app/api/qimen/route.ts',
  'src/app/api/liuyao/route.ts',
  'src/app/api/tarot/route.ts',
  'src/app/api/daliuren/route.ts',
  'src/app/api/palm/route.ts',
  'src/app/api/face/route.ts',
  'src/app/api/meihua/route.ts',
  'src/app/api/xiaoliuren/route.ts',
]) {
  mustMatch(
    file,
    /authMethod:\s*'userContext'/u,
    'browser-driven divination routes should opt into cookie-compatible userContext auth',
  );
}

const meihuaXiaoliurenMigration = 'supabase/migrations/20260723_100000_create_meihua_xiaoliuren_web.sql';
mustExist(meihuaXiaoliurenMigration, 'web divination tables require a deployable migration');
mustMatch(
  meihuaXiaoliurenMigration,
  /CREATE TABLE public\.meihua_divinations[\s\S]*CREATE TABLE public\.xiaoliuren_divinations/u,
  'the web divination migration should create both owner-scoped history tables',
);
mustMatch(
  meihuaXiaoliurenMigration,
  /SECURITY DEFINER[\s\S]*SET search_path = pg_catalog, public/u,
  'security-definer history RPCs should pin their search path',
);
mustMatch(
  meihuaXiaoliurenMigration,
  /REVOKE ALL ON FUNCTION public\.create_analysis_conversation_with_history_as_service\([\s\S]*FROM public, anon, authenticated, service_role;[\s\S]*GRANT EXECUTE ON FUNCTION public\.create_analysis_conversation_with_history_as_service\([\s\S]*TO authenticated;/u,
  'the history binding RPC should deny default execution and expose only the authenticated admin-session entrypoint',
);

for (const page of ['src/app/meihua/page.tsx', 'src/app/xiaoliuren/page.tsx']) {
  mustMatch(
    page,
    /<HistoryDrawer type="(?:meihua|xiaoliuren)"/u,
    `${page} should reuse the shared history drawer`,
  );
  mustNotMatch(
    page,
    /router\.push\('\/(?:meihua|xiaoliuren)\/history'\)/u,
    `${page} should not add a second history entry beside the shared drawer`,
  );
  mustMatch(
    page,
    /import \{ toDateTimeLocalValue \} from '@\/lib\/date-utils';/u,
    `${page} should reuse the shared local datetime formatter`,
  );
}

const mcpStorageCleanupMigration = 'supabase/migrations/20260723_110000_drop_mcp_auth_storage.sql';
mustExist(mcpStorageCleanupMigration, 'public MCP rollout requires a tracked legacy storage cleanup migration');
mustMatch(
  mcpStorageCleanupMigration,
  /cron\.unschedule[\s\S]*DROP FUNCTION IF EXISTS public\.cleanup_mcp_oauth_data\(\);/u,
  'legacy MCP cleanup should remove its scheduled job and cleanup function',
);
mustMatch(
  mcpStorageCleanupMigration,
  /DROP TABLE IF EXISTS public\.mcp_oauth_codes;[\s\S]*DROP TABLE IF EXISTS public\.mcp_api_keys;/u,
  'legacy MCP cleanup should remove OAuth and API-key tables explicitly',
);
mustNotMatch(
  mcpStorageCleanupMigration,
  /DROP\s+(?:TABLE|FUNCTION|TRIGGER)[^;]*\bCASCADE\b/iu,
  'legacy MCP cleanup must stop on unexpected dependencies instead of cascading',
);

mustNotMatch(
  'src/app/api/mbti/route.ts',
  /action === 'history'|action:\s*'[^']*history[^']*'/u,
  'mbti route should not keep the legacy history action',
);

for (const file of [
  'src/app/user/annual-report/page.tsx',
  'src/app/bazi/result/page.tsx',
  'src/app/ziwei/result/page.tsx',
  'src/app/records/page.tsx',
  'src/components/settings/panels/GeneralSettingsPanel.tsx',
  'src/components/settings/panels/KnowledgeBasePanel.tsx',
  'src/components/settings/panels/McpServicePanel.tsx',
  'src/components/settings/panels/ProfilePanel.tsx',
  'src/components/knowledge-base/AddToKnowledgeBaseModal.tsx',
  'src/components/chat/composer/useComposerState.ts',
  'src/components/daily/DailyAIChat.tsx',
  'src/lib/chat/use-chat-messaging.ts',
  'src/lib/auth.ts',
  'src/components/admin/FeatureTogglePanel.tsx',
  'src/components/admin/KeyManagementPanel.tsx',
  'src/components/admin/AIModelPanel.tsx',
  'src/components/admin/AnnouncementManagementPanel.tsx',
  'src/components/admin/AIGatewayPanel.tsx',
]) {
  mustNotMatch(
    file,
    /Bearer\s*\$\{/u,
    'browser code should rely on same-origin cookies instead of interpolated bearer headers',
  );
}

mustMatch(
  'src/app/api/auth/route.ts',
  /from ['"]@\/lib\/api-utils['"]/u,
  'auth route should rely on api-utils clients instead of creating its own Supabase client',
);
mustMatch(
  'src/app/api/auth/route.ts',
  /createAnonClient/u,
  'auth route should use createAnonClient from api-utils',
);
mustNotMatch(
  'src/app/api/auth/route.ts',
  /createClient\(/u,
  'auth route should not call createClient directly',
);

mustMatch(
  'src/lib/api-utils.ts',
  /const authResult = dependencies\.userContext \?\? await requireUserContext\(request\);/u,
  'requireAdminUser should be based on requireUserContext',
);
mustNotMatch(
  'src/lib/api-utils.ts',
  /getServiceRoleClient/u,
  'stale service-role naming should stay removed',
);
mustNotMatch(
  'src/lib/api-utils.ts',
  /const serviceClient = getSystemAdminClient\(\);/u,
  'requireAdminUser should not create a service-role client directly',
);

mustMatch(
  'src/lib/server/ai-config.ts',
  /import 'server-only';/u,
  'server ai-config should stay marked as server-only',
);
mustMatch(
  'src/lib/server/ai-config.ts',
  /getSystemAdminClient/u,
  'server ai-config should use the shared privileged server client',
);
mustNotMatch(
  'src/lib/server/ai-config.ts',
  /SUPABASE_SERVICE_ROLE_KEY/u,
  'server ai-config should not reference service-role env vars directly',
);

mustNotMatch(
  'src/lib/ai/ai-config.ts',
  /SUPABASE_SERVICE_ROLE_KEY/u,
  'shared ai-config should not reference service-role env vars directly',
);
mustNotMatch(
  'src/lib/ai/ai-config.ts',
  /await import\('@supabase\/supabase-js'\)/u,
  'shared ai-config should not dynamically import supabase-js for privileged access',
);

mustMatch(
  'src/app/api/models/route.ts',
  /from ['"]@\/lib\/server\/ai-config['"]/u,
  'models route should use the server ai-config module',
);

mustMatch(
  'src/app/api/chat/route.ts',
  /from ['"]@\/lib\/server\/chat\/request['"]/u,
  'chat route should delegate request preparation to the shared server helper',
);
mustMatch(
  'src/app/api/chat/route.ts',
  /prepareChatRequest\(/u,
  'chat route should call prepareChatRequest',
);
mustMatch(
  'src/app/api/chat/route.ts',
  /callAIUIMessageResult\(/u,
  'chat route should call callAIUIMessageResult for streaming',
);
mustMatch(
  'src/lib/server/chat/request.ts',
  /import 'server-only';/u,
  'chat request helper should stay server-only',
);
mustMatch(
  'src/lib/server/chat/prompt-context.ts',
  /import 'server-only';/u,
  'chat prompt context helper should stay server-only',
);
mustMatch(
  'src/app/chat/page.tsx',
  /useChatBootstrap/u,
  'chat page should load bootstrap state through the shared hook',
);
mustNotMatch(
  'src/app/chat/page.tsx',
  /getMembershipInfo\(/u,
  'chat page should not fetch membership directly',
);
mustNotMatch(
  'src/app/chat/page.tsx',
  /getCurrentUserProfileBundle\(/u,
  'chat page should not fetch the profile bundle directly',
);
mustNotMatch(
  'src/app/chat/page.tsx',
  /fetch\((['"])\/api\/knowledge-base\1/u,
  'chat page should not fetch knowledge bases directly',
);

mustMatch(
  'src/lib/divination/tarot.ts',
  /from ['"]taibu-core\/tarot['"]/u,
  'tarot wrapper should import tarot APIs from the tarot domain subpath',
);
mustNotMatch(
  'src/lib/divination/tarot.ts',
  /from ['"]taibu-core['"]/u,
  'tarot wrapper should not import the root core entry',
);
mustMatch(
  'src/lib/divination/daliuren.ts',
  /from ['"]taibu-core\/daliuren['"]/u,
  'daliuren wrapper should import daliuren APIs from the daliuren domain subpath',
);
mustNotMatch(
  'src/lib/divination/daliuren.ts',
  /from ['"]taibu-core\/daliuren-core['"]/u,
  'daliuren wrapper should not depend on the removed daliuren-core subpath',
);
mustMatch(
  'src/app/api/daliuren/route.ts',
  /from ['"]@\/lib\/divination\/daliuren['"]/u,
  'daliuren route should use the daliuren wrapper',
);
mustMatch(
  'src/lib/divination/qimen.ts',
  /from ['"]taibu-core\/qimen['"]/u,
  'qimen wrapper should import the qimen domain subpath',
);
mustNotMatch(
  'src/lib/divination/qimen.ts',
  /from ['"]taibu-core['"]/u,
  'qimen wrapper should not import the root core entry',
);
mustMatch(
  'src/app/api/daliuren/route.ts',
  /const\s+\{[^}]*timezone[^}]*\}\s*=\s*body/u,
  'daliuren calculate action should extract timezone from the request body',
);
mustMatch(
  'src/app/api/daliuren/route.ts',
  /calculateDaliurenBundle\(\{[\s\S]*timezone[\s\S]*\}\)/u,
  'daliuren route should forward timezone into the daliuren wrapper calculate call',
);
mustMatch(
  'src/lib/divination/liuyao.ts',
  /from ['"]taibu-core\/liuyao['"]/u,
  'liuyao web adapter should import shared liuyao helpers from the liuyao domain subpath',
);
mustMatch(
  'src/app/api/liuyao/route.ts',
  /from ['"]@\/lib\/divination\/liuyao['"]/u,
  'liuyao route should use the liuyao wrapper',
);
mustMatch(
  'src/app/liuyao/result/page.tsx',
  /from ['"]@\/lib\/divination\/liuyao['"]/u,
  'liuyao result page should use the liuyao wrapper',
);
mustMatch(
  'src/lib/data-sources/liuyao.ts',
  /from ['"]@\/lib\/divination\/liuyao['"]/u,
  'liuyao data source should use the liuyao wrapper',
);
mustMatch(
  'src/lib/divination/liuyao.ts',
  /taibu-core\/data\/hexagrams/u,
  'liuyao web adapter should import shared hexagram data from core',
);
mustMatch(
  'src/lib/divination/liuyao.ts',
  /taibu-core\/data\/shensha/u,
  'liuyao web adapter should import shared shensha data from core',
);
mustNotMatch(
  'src/lib/divination/liuyao.ts',
  /packages\/core\/dist\//u,
  'liuyao web adapter should not import package dist files directly',
);
mustMatch(
  'src/lib/divination/bazi.ts',
  /from ['"]taibu-core\/bazi['"]/u,
  'bazi wrapper should import bazi APIs from the bazi domain subpath',
);
mustMatch(
  'src/lib/divination/bazi.ts',
  /from ['"]taibu-core\/bazi-dayun['"]/u,
  'bazi wrapper should import dayun APIs from the bazi-dayun domain subpath',
);
mustNotMatch(
  'src/lib/divination/bazi.ts',
  /from ['"]taibu-core['"]/u,
  'bazi wrapper should not import the root core entry',
);
mustMatch(
  'src/lib/divination/ziwei.ts',
  /from ['"]taibu-core\/ziwei['"]/u,
  'ziwei wrapper should import chart APIs from the ziwei domain subpath',
);
mustMatch(
  'src/lib/divination/ziwei.ts',
  /from ['"]taibu-core\/ziwei-horoscope['"]/u,
  'ziwei wrapper should import horoscope APIs from the ziwei-horoscope subpath',
);
mustNotMatch(
  'src/lib/divination/ziwei.ts',
  /from ['"]taibu-core['"]/u,
  'ziwei wrapper should not import the root core entry',
);
mustMatch(
  'src/app/qimen/result/page.tsx',
  /from ['"]@\/lib\/divination\/qimen['"]/u,
  'qimen result page should import qimen helpers from the qimen wrapper',
);
mustMatch(
  'src/app/daliuren/result/page.tsx',
  /from ['"]@\/lib\/divination\/daliuren['"]/u,
  'daliuren result page should import daliuren formatters from the daliuren wrapper',
);

mustMatch(
  'src/app/qimen/result/page.tsx',
  /import\s*\{[\s\S]*buildQimenCanonicalJSON[\s\S]*generateQimenChartText[\s\S]*\}\s*from ['"]@\/lib\/divination\/qimen['"]/u,
  'qimen result page should use the qimen wrapper canonical/text helpers',
);
mustNotMatch(
  'src/app/qimen/result/page.tsx',
  /from ['"]@\/lib\/divination\/qimen-shared['"]/u,
  'qimen result page should not depend on qimen-shared',
);
mustNotMatch(
  'src/app/qimen/result/page.tsx',
  /import\s*\{\s*generateQimenResultText[^}]*\}\s*from ['"]@\/lib\/divination\/qimen['"]/u,
  'qimen result page should not import runtime copy helpers from the server-only qimen module',
);
mustMatch(
  'src/app/api/qimen/route.ts',
  /import\s*\{[\s\S]*calculateQimenBundle[\s\S]*generateQimenChartText[\s\S]*\}\s*from ['"]@\/lib\/divination\/qimen['"]/u,
  'qimen route should use the qimen wrapper',
);
mustNotMatch(
  'src/app/api/qimen/route.ts',
  /from ['"]@\/lib\/divination\/qimen-shared['"]/u,
  'qimen route should not depend on qimen-shared',
);
mustMatch(
  'src/lib/data-sources/qimen.ts',
  /import\s*\{[\s\S]*toQimenText[\s\S]*\}\s*from ['"]taibu-core\/qimen['"]/u,
  'qimen data source should use direct core qimen text renderer',
);
mustNotMatch(
  'src/lib/data-sources/qimen.ts',
  /from ['"]@\/lib\/divination\/qimen-shared['"]/u,
  'qimen data source should not depend on qimen-shared',
);

mustNotMatch(
  'src/lib/chat/conversation.ts',
  /from ['"]@\/lib\/auth['"]/u,
  'conversation client should use HTTP APIs instead of browser auth DB access',
);
mustMatch(
  'src/lib/chat/conversation.ts',
  /\/api\/conversations/u,
  'conversation client should target the dedicated conversations API',
);

mustNotMatchInTree(
  'src/app',
  /supabase\s*\.\s*(from|rpc)\s*\(/m,
  'page layer should not query Supabase directly from app routes or pages',
  (file) => !file.includes('/api/') && /\.(ts|tsx)$/u.test(file),
);
mustNotMatchInTree(
  'src/components',
  /supabase\s*\.\s*(from|rpc)\s*\(/m,
  'component layer should not query Supabase directly',
  (file) => /\.(ts|tsx)$/u.test(file),
);

mustNotMatch(
  'src/components/settings/panels/ProfilePanel.tsx',
  /\.from\('users'\)|supabase\.storage/u,
  'profile panel should use APIs instead of direct users/storage access',
);
mustNotMatch(
  'src/app/community/[postId]/page.tsx',
  /\.from\('user_settings'\)/u,
  'community page should not write user_settings directly from the browser',
);
mustNotMatch(
  'src/app/user/notifications/page.tsx',
  /FeatureGate/u,
  'user notifications page should remain directly accessible even when entry links are hidden',
);
mustNotMatch(
  'src/lib/user/membership.ts',
  /supabase\s*\.\s*from\s*\(/m,
  'browser membership helpers should not write tables directly',
);
mustNotMatch(
  'src/lib/navigation/registry.ts',
  /NAV_TO_FEATURE_ID/u,
  'navigation registry should not re-export the removed NAV_TO_FEATURE_ID shim',
);
mustMatch(
  'src/lib/user/settings.ts',
  /DEFAULT_NAV_ORDER\s*=\s*\[[^\]]*'qimen'[^\]]*'daliuren'[^\]]*'daily'[^\]]*'monthly'/u,
  'default nav order should keep qimen, daliuren, daily, and monthly in the main navigation list',
);
mustNotMatch(
  'src/lib/user/settings.ts',
  /DEFAULT_TOOL_ORDER\s*=\s*\[[^\]]*'daily'/u,
  'default tool order should not list daily as a tool entry',
);
mustNotMatch(
  'src/lib/user/settings.ts',
  /DEFAULT_TOOL_ORDER\s*=\s*\[[^\]]*'monthly'/u,
  'default tool order should not list monthly as a tool entry',
);
mustNotMatch(
  'src/lib/auth.ts',
  /createBrowserClient|createClient|NEXT_PUBLIC_SUPABASE_ANON_KEY/u,
  'browser auth adapter should stay decoupled from browser Supabase clients',
);
mustNotMatch(
  'src/app/layout.tsx',
  /__MINGAI_PUBLIC_SUPABASE__|getSupabaseUrl|getSupabaseAnonKey/u,
  'root layout should not inject Supabase config into window state',
);
mustNotMatch(
  'Dockerfile',
  /ARG SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY="\$SUPABASE_SERVICE_ROLE_KEY"/u,
  'Dockerfile should not accept or forward the Supabase service role key at build time',
);
mustNotMatch(
  'docker-compose.yml',
  /SUPABASE_SERVICE_ROLE_KEY:/u,
  'docker-compose.yml should not pass the Supabase service role key into the web build args',
);
mustNotMatch(
  'docker-compose.web.yml',
  /SUPABASE_SERVICE_ROLE_KEY:/u,
  'docker-compose.web.yml should not pass the Supabase service role key into the web build args',
);
mustMatch(
  'src/app/page.tsx',
  /redirect\('\/bazi'\)/u,
  'home page should redirect visitors to /bazi as the default public entry',
);
mustNotMatch(
  'src/app/page.tsx',
  /ACCESS_COOKIE|REFRESH_COOKIE|resolveSessionFromTokens|createAnonClient|createRequestSupabaseClient|cookies\(\)/u,
  'home page should not resolve auth cookies or server sessions directly',
);
mustMatch(
  'src/lib/supabase-server.ts',
  /NODE_ENV[\s\S]*production/u,
  'supabase-server should branch on production environment for admin session policy',
);
mustMatch(
  'src/lib/supabase-server.ts',
  /Missing SUPABASE_SYSTEM_ADMIN_EMAIL or SUPABASE_SYSTEM_ADMIN_PASSWORD/u,
  'supabase-server should keep a clear missing-credentials error',
);
for (const file of [
  'src/app/api/liuyao/route.ts',
  'src/app/liuyao/result/page.tsx',
  'src/lib/data-sources/liuyao.ts',
]) {
  mustNotMatch(
    file,
    /rank=|rankScore|排序分/u,
    'liuyao surfaces should not expose rank score wording',
  );
}

mustMatch(
  'supabase/migrations/20260318_drop_community_posts_anonymous_name.sql',
  /ALTER TABLE public\.community_posts[\s\S]*DROP COLUMN IF EXISTS anonymous_name/u,
  'community anonymity cleanup migration should drop the obsolete anonymous_name column',
);
mustMatch(
  'supabase/tabel_export_from_supabase.sql',
  /CREATE TABLE public\.announcements[\s\S]*content text NOT NULL[\s\S]*published_at timestamp with time zone NOT NULL DEFAULT now\(\)/u,
  'schema snapshot should keep the simplified announcements table',
);
mustNotMatch(
  'supabase/tabel_export_from_supabase.sql',
  /CREATE TABLE public\.announcement_user_states/u,
  'schema snapshot should not reintroduce announcement_user_states',
);
mustExist(
  'supabase/migrations/20260328_simplify_announcements_for_unified_center.sql',
  'announcements simplification migration should stay tracked in repo',
);
mustMatch(
  'supabase/migrations/20260328_simplify_announcements_for_unified_center.sql',
  /DROP TABLE IF EXISTS public\.announcement_user_states/u,
  'announcements simplification migration should drop announcement_user_states',
);
mustMatch(
  'supabase/migrations/20260328_simplify_announcements_for_unified_center.sql',
  /CREATE TABLE public\.announcements[\s\S]*content text NOT NULL[\s\S]*published_at timestamp with time zone NOT NULL DEFAULT now\(\)/u,
  'announcements simplification migration should define the simplified announcements table',
);
mustExist(
  'supabase/migrations/20260328_fix_announcements_admin_rls.sql',
  'announcements admin RLS migration should stay tracked in repo',
);
for (const policy of [
  /CREATE POLICY announcements_admin_select/u,
  /CREATE POLICY announcements_admin_insert/u,
  /CREATE POLICY announcements_admin_update/u,
  /CREATE POLICY announcements_admin_delete/u,
]) {
  mustMatch(
    'supabase/migrations/20260328_fix_announcements_admin_rls.sql',
    policy,
    'announcements admin RLS migration should define every admin policy',
  );
}
mustMatch(
  'supabase/migrations/20260410_103000_fix_linuxdo_claim_concurrency.sql',
  /CREATE OR REPLACE FUNCTION public\.claim_linuxdo_membership_as_service/u,
  'linuxdo claim concurrency migration should redefine the monthly claim RPC',
);
mustMatch(
  'supabase/migrations/20260410_103000_fix_linuxdo_claim_concurrency.sql',
  /pg_advisory_xact_lock/u,
  'linuxdo claim concurrency migration should serialize grants with an advisory lock',
);
mustMatch(
  'supabase/migrations/20260410_103000_fix_linuxdo_claim_concurrency.sql',
  /linuxdo_monthly_claim:/u,
  'linuxdo claim concurrency migration should keep the scoped advisory-lock key',
);
mustMatch(
  'supabase/migrations/20260410_141500_checkin_overcap_drop_user_achievements.sql',
  /DROP TABLE IF EXISTS public\.user_achievements/u,
  'checkin over-cap migration should drop the obsolete user_achievements table',
);
mustMatch(
  'supabase/migrations/20260410_141500_checkin_overcap_drop_user_achievements.sql',
  /CREATE OR REPLACE FUNCTION public\.perform_daily_checkin_as_service/u,
  'checkin over-cap migration should redefine the service-side checkin RPC',
);
mustNotMatch(
  'supabase/migrations/20260410_141500_checkin_overcap_drop_user_achievements.sql',
  /LEAST\(v_reward_credits,\s*v_credit_limit - v_current_credits\)/u,
  'checkin over-cap migration should stop capping a valid reward below the credit limit',
);
mustMatch(
  'supabase/migrations/20260410_141500_checkin_overcap_drop_user_achievements.sql',
  /v_new_credits := v_current_credits \+ v_reward_credits;/u,
  'checkin over-cap migration should add the full reward when the user is still below the cap',
);
mustMatch(
  'supabase/migrations/20260411_103500_align_admin_session_service_rpcs.sql',
  /GRANT EXECUTE ON FUNCTION public\.perform_daily_checkin_as_service\(uuid\) TO authenticated, service_role;/u,
  'admin-session rpc alignment migration should grant authenticated access to perform_daily_checkin_as_service',
);
mustMatch(
  'supabase/migrations/20260411_103500_align_admin_session_service_rpcs.sql',
  /GRANT EXECUTE ON FUNCTION public\.claim_linuxdo_membership_as_service\(uuid, text, integer, text\) TO authenticated, service_role;/u,
  'admin-session rpc alignment migration should grant authenticated access to claim_linuxdo_membership_as_service',
);
mustMatch(
  'supabase/migrations/20260411_103500_align_admin_session_service_rpcs.sql',
  /GRANT EXECUTE ON FUNCTION public\.activate_key_as_service\(uuid, text\) TO authenticated, service_role;/u,
  'admin-session rpc alignment migration should grant authenticated access to activate_key_as_service',
);
mustMatch(
  'supabase/migrations/20260411_103500_align_admin_session_service_rpcs.sql',
  /IF NOT public\.is_admin_user\(\) THEN/u,
  'admin-session rpc alignment migration should keep the shared admin-session guard',
);
mustMatch(
  'supabase/migrations/20260411_104200_restore_batch_update_vectors_as_service.sql',
  /CREATE OR REPLACE FUNCTION public\.batch_update_vectors_as_service/u,
  'batch vector restore migration should redefine batch_update_vectors_as_service',
);
mustMatch(
  'supabase/migrations/20260411_104200_restore_batch_update_vectors_as_service.sql',
  /GRANT EXECUTE ON FUNCTION public\.batch_update_vectors_as_service\(jsonb, uuid, integer, boolean\) TO authenticated, service_role;/u,
  'batch vector restore migration should grant authenticated access to batch_update_vectors_as_service',
);
mustMatch(
  'supabase/migrations/20260411_104200_restore_batch_update_vectors_as_service.sql',
  /IF NOT public\.is_admin_user\(\) THEN/u,
  'batch vector restore migration should keep the shared admin-session guard',
);
mustMatch(
  'supabase/migrations/20260411_111500_restrict_admin_session_rpc_acl.sql',
  /admin_list_mcp_keys/u,
  'admin-session rpc acl migration should cover admin_list_mcp_keys',
);
mustMatch(
  'supabase/migrations/20260411_111500_restrict_admin_session_rpc_acl.sql',
  /mcp_reset_key/u,
  'admin-session rpc acl migration should cover mcp_reset_key',
);
mustMatch(
  'supabase/migrations/20260411_111500_restrict_admin_session_rpc_acl.sql',
  /process_scheduled_reminder_delivery_as_service/u,
  'admin-session rpc acl migration should cover scheduled reminder delivery RPCs',
);
mustMatch(
  'supabase/migrations/20260315_fix_user_oauth_providers_admin_rls.sql',
  /DROP POLICY IF EXISTS "Service role full access on oauth providers"/u,
  'oauth provider RLS migration should remove the service_role-only policy',
);
mustMatch(
  'supabase/migrations/20260315_fix_user_oauth_providers_admin_rls.sql',
  /CREATE POLICY "Admins full access" ON public\.user_oauth_providers/u,
  'oauth provider RLS migration should add an admin access policy',
);
mustMatch(
  'supabase/migrations/20260315_fix_user_oauth_providers_admin_rls.sql',
  /public\.is_admin_user\(\)/u,
  'oauth provider RLS migration should use the shared admin predicate',
);
mustMatch(
  'supabase/migrations/20260212_mcp_guard_internal_updates.sql',
  /current_setting\('mingai\.mcp_internal_update', true\)/u,
  'mcp guard migration should support the scoped internal-update bypass flag',
);
mustMatch(
  'supabase/migrations/20260212_mcp_guard_internal_updates.sql',
  /set_config\('mingai\.mcp_internal_update', '1', true\)/u,
  'mcp guard migration should set the scoped bypass flag inside trusted RPCs',
);
mustMatch(
  'supabase/migrations/20260212_mcp_guard_internal_updates.sql',
  /CREATE OR REPLACE FUNCTION public\.mcp_reset_key/u,
  'mcp guard migration should patch mcp_reset_key',
);
mustMatch(
  'supabase/migrations/20260212_mcp_guard_internal_updates.sql',
  /CREATE OR REPLACE FUNCTION public\.admin_revoke_mcp_key/u,
  'mcp guard migration should patch admin_revoke_mcp_key',
);
mustMatch(
  'supabase/migrations/20260212_mcp_guard_internal_updates.sql',
  /CREATE OR REPLACE FUNCTION public\.admin_unban_mcp_key/u,
  'mcp guard migration should define admin_unban_mcp_key',
);
mustMatch(
  'supabase/migrations/20260212_mcp_guard_internal_updates.sql',
  /SET key_code = p_new_key_code,[\s\S]*is_active = true/u,
  'mcp reset RPC should reactivate a key when rotating its code',
);
mustMatch(
  'supabase/migrations/20260212_mcp_unban_reactivate_keys.sql',
  /UPDATE public\.mcp_api_keys[\s\S]*WHERE is_banned = false[\s\S]*is_active = false/u,
  'mcp unban reactivation migration should backfill legacy inactive keys',
);
mustMatch(
  'supabase/migrations/20260212_mcp_unban_reactivate_keys.sql',
  /CREATE OR REPLACE FUNCTION public\.admin_unban_mcp_key/u,
  'mcp unban reactivation migration should redefine admin_unban_mcp_key',
);
mustMatch(
  'supabase/migrations/20260212_mcp_unban_reactivate_keys.sql',
  /SET is_banned = false,[\s\S]*is_active = true/u,
  'admin_unban_mcp_key should restore active state',
);

mustNotMatch(
  'src/lib/data-sources/index.ts',
  /registerDataSource\(/u,
  'data source registry should remain manifest-driven',
);
mustNotMatchInTree(
  'src',
  /packages\/core\/src\//u,
  'web app code should not import internal packages/core/src paths directly',
  (file) => /\.(?:ts|tsx|mts)$/u.test(file),
);

// Discover new extracted modules; only these reviewed legacy adapters are not roots.
// An exception never permits a protected module to depend on the adapter.
const adapterEntries = new Set([
  'src/lib/server/ai-config.ts',
  'src/lib/server/amap-geocode.ts',
  'src/lib/server/bazi-case-profile.ts',
  'src/lib/server/conversation-messages.ts',
  'src/lib/server/chat/bootstrap.ts',
  'src/lib/server/chat/prompt-context.ts',
  'src/lib/server/chat/request.ts',
  'src/lib/knowledge-base/browser-client.ts',
  'src/lib/knowledge-base/client.ts',
  'src/lib/knowledge-base/embedding-config.ts',
  'src/lib/knowledge-base/hits.ts',
  'src/lib/knowledge-base/ingest.ts',
  'src/lib/knowledge-base/persistence.server.ts',
  'src/lib/knowledge-base/reranker.ts',
  'src/lib/knowledge-base/search.ts',
  'src/lib/knowledge-base/vector-index.ts',
]);
const contractEntries = ['src/lib/data-sources/types.ts', 'src/lib/knowledge-base/types.ts'];
const sourceExtension = /\.[cm]?[jt]sx?$/u;
const pureEntries = new Set([
  'src/lib/server/analysis.ts',
  'src/lib/server/chat/contracts.ts',
  'src/lib/server/chat/use-case.ts',
  'src/lib/knowledge-base/source-replacement.ts',
  ...['src/lib/server', 'src/lib/knowledge-base'].flatMap(dir => walk(dir))
    .filter(file => sourceExtension.test(file) && !adapterEntries.has(file)),
]);
const compilerOptions = {
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  module: ts.ModuleKind.ESNext,
  allowJs: true,
  resolveJsonModule: true,
  baseUrl: root,
  paths: { '@/*': ['./src/*'] },
};
const configPath = resolve(root, 'tsconfig.json');
if (existsSync(configPath)) {
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) failures.push('tsconfig.json: invalid architecture module-resolution input');
  else Object.assign(compilerOptions, ts.parseJsonConfigFileContent(config.config, ts.sys, root).options);
}
const resolutionCache = ts.createModuleResolutionCache(root, value => value, compilerOptions);
const parsedModules = new Map();
function parseModule(file) {
  if (!parsedModules.has(file)) {
    const text = read(file);
    parsedModules.set(file, text === null ? null : ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
  }
  return parsedModules.get(file);
}
function literalText(node) {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}
const nodeBuiltins = new Set(builtinModules.map(name => name.replace(/^node:/u, '')));
function forbiddenModule(name) {
  return nodeBuiltins.has(name.replace(/^node:/u, ''))
    || /^(?:next|react|react-dom|ai)(?:\/|$)|^@(?:supabase|ai-sdk)\/|^node:|^(?:server-only|client-only)$/u.test(name);
}
function forbiddenFile(file) {
  return adapterEntries.has(file) || /(?:^|\/)(?:components|app)\/|(?:^|\/)(?:api-utils|supabase[^/]*)(?:\.[cm]?[jt]sx?)?$|\.server\.[cm]?[jt]sx?$/u.test(file);
}
function checkDependencyBoundary(entry, reason) {
  const visited = new Set();
  function fail(chain, detail) {
    failures.push(`${entry}: ${reason}; dependency path: ${chain.join(' -> ')} (${detail})`);
  }
  function visit(file, names, chain) {
    const key = `${file}:${names ? [...names].sort().join(',') : '*'}`;
    if (visited.has(key)) return;
    visited.add(key);
    const source = parseModule(file);
    if (!source) return;
    if (source.parseDiagnostics.length) {
      fail(chain, 'invalid dependency source syntax');
      return;
    }
    // Type-only edges follow selected DTO declarations and local references,
    // not unrelated executable functions in mixed legacy modules. SDK types
    // still travel through imports/re-exports and receive no exemption.
    let nodes = source.statements;
    if (names) {
      const wanted = new Set(names);
      const selected = new Set();
      let changed = true;
      while (changed) {
        changed = false;
        for (const statement of source.statements) {
          const declarations = ts.isVariableStatement(statement)
            ? statement.declarationList.declarations : [statement];
          if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
            for (const item of statement.exportClause.elements) {
              const localName = (item.propertyName || item.name).text;
              if (wanted.has(item.name.text) && !wanted.has(localName)) {
                wanted.add(localName);
                changed = true;
              }
            }
          }
          const matches = declarations.some(node => node.name && wanted.has(node.name.getText(source)))
            || (wanted.has('default') && (ts.isExportAssignment(statement)
              || statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)));
          if (!matches || selected.has(statement)) continue;
          selected.add(statement);
          changed = true;
          function collect(node) {
            if (ts.isIdentifier(node)) wanted.add(node.text);
            ts.forEachChild(node, collect);
          }
          collect(statement);
        }
      }
      nodes = [...selected, ...source.statements.filter(node =>
        ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isImportEqualsDeclaration(node))];
      names = wanted;
    }
    function edge(specifier, importedNames) {
      if (forbiddenModule(specifier)) {
        fail([...chain, specifier], 'forbidden framework/SDK dependency');
        return;
      }
      const resolved = ts.resolveModuleName(specifier, resolve(root, file), compilerOptions, ts.sys, resolutionCache).resolvedModule;
      const local = specifier.startsWith('.') || specifier.startsWith('@/') || isAbsolute(specifier)
        || Object.keys(compilerOptions.paths || {}).some(pattern => specifier.startsWith(pattern.split('*')[0]));
      if (!resolved) {
        if (local) fail([...chain, specifier], 'unresolved local dependency');
        return;
      }
      if (resolved.isExternalLibraryImport) return;
      const target = relative(root, resolved.resolvedFileName).replaceAll('\\', '/');
      if (forbiddenFile(target)) {
        fail([...chain, target], 'infrastructure adapter dependency');
        return;
      }
      if (sourceExtension.test(target)) visit(target, importedNames, [...chain, target]);
    }
    function inspect(node) {
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause;
        const bindings = clause?.namedBindings;
        let imported = null;
        if (names || clause?.isTypeOnly || (bindings && ts.isNamedImports(bindings) && !clause.name && bindings.elements.every(e => e.isTypeOnly))) {
          imported = new Set();
          if (clause?.name && (!names || names.has(clause.name.text))) imported.add('default');
          if (bindings && ts.isNamedImports(bindings)) {
            for (const item of bindings.elements) {
              if (!names || names.has(item.name.text)) imported.add((item.propertyName || item.name).text);
            }
          } else if (bindings && (!names || names.has(bindings.name.text))) imported = null;
          if (imported?.size === 0) return;
        }
        edge(node.moduleSpecifier.text, imported);
        return;
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        let imported = null;
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          const items = node.exportClause.elements.filter(item => !names || names.has(item.name.text));
          if (!items.length) return;
          if (names || node.isTypeOnly || items.every(item => item.isTypeOnly)) imported = new Set(items.map(item => (item.propertyName || item.name).text));
        } else if (node.exportClause && ts.isNamespaceExport(node.exportClause)) {
          if (names && !names.has(node.exportClause.name.text)) return;
        } else if (names) imported = names;
        edge(node.moduleSpecifier.text, imported);
        return;
      }
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        const specifier = literalText(node.moduleReference.expression);
        if (specifier && (!names || names.has(node.name.text))) edge(specifier, null);
        return;
      }
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
        const specifier = literalText(node.argument.literal);
        if (specifier) edge(specifier, node.qualifier ? new Set([node.qualifier.getText(source).split('.')[0]]) : null);
      }
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        const specifier = literalText(node.arguments[0]);
        if (specifier) edge(specifier, null);
      }
      if (ts.isIdentifier(node) && /^(?:SupabaseClient|NextRequest|NextResponse|Postgrest\w*|fetch)$/u.test(node.text)) {
        fail(chain, `forbidden infrastructure identifier ${node.text}`);
      }
      if ((ts.isPropertyAccessExpression(node) && node.name.text === 'env' && node.expression.getText(source) === 'process')
        || (ts.isElementAccessExpression(node) && literalText(node.argumentExpression) === 'env' && node.expression.getText(source) === 'process')) {
        fail(chain, 'global environment dependency');
      }
      ts.forEachChild(node, inspect);
    }
    for (const node of nodes) inspect(node);
  }
  visit(entry, null, [entry]);
}
for (const file of pureEntries) {
  if (!contractEntries.includes(file)) checkDependencyBoundary(file,
    'extracted use cases must keep HTTP, SDK, network and infrastructure dependencies in adapters');
}
for (const file of contractEntries) checkDependencyBoundary(file,
  'browser-safe data contracts must not import server or SDK contracts');
mustNotMatch(
  'src/lib/api/divination-pipeline.ts',
  /\bgetSystemAdminClient\b/u,
  'caller database context must fail closed; privileged persistence stays in its named adapter',
);
mustNotMatch(
  'src/lib/knowledge-base/search.ts',
  /\bgetSystemAdminClient\b/u,
  'knowledge search must retain the caller identity for owner-scoped SQL',
);
mustNotMatch(
  'src/lib/chat/ConversationListContext.tsx',
  /\[conversations,\s*setConversations\]\s*=\s*useState/u,
  'Query must own the conversation list without a second writable Context copy',
);

if (failures.length > 0) {
  console.error('Architecture guard failures:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Architecture guards passed.');
