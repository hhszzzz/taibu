FROM node:24.22.1-alpine3.23 AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/package.json
COPY packages/mcp/package.json ./packages/mcp/package.json
COPY packages/mcp-server/package.json ./packages/mcp-server/package.json
RUN --mount=type=cache,id=taibu-pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM dependencies AS builder
COPY . .
# Only public deployment settings belong in the build. Credentials are runtime-only.
ARG GIT_SHA=local
ENV GIT_SHA=$GIT_SHA
RUN --mount=type=cache,id=taibu-pnpm,target=/pnpm/store pnpm build

FROM node:24.22.1-alpine3.23 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# The migrate service uses psql for `-- migrate:no-transaction` files
# (CREATE INDEX CONCURRENTLY cannot run inside a transaction block).
RUN apk add --no-cache postgresql17-client
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs \
  && mkdir -p /data/files && chown -R nextjs:nodejs /data
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# The worker uses Next's server helpers outside Web's bundled route chunks.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/next ./node_modules/next
# scripts/db/import-supabase.mjs runs as a one-off and needs a bcrypt verifier
# for both $2a$ (GoTrue) and $2b$ hashes; Next bundles the app copy.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.pnpm/bcryptjs@*/node_modules/bcryptjs ./node_modules/bcryptjs
COPY --from=builder /app/LICENSE ./LICENSE
COPY --from=builder /app/packages/core/LICENSE ./licenses/taibu-core.LICENSE
COPY --from=builder --chown=nextjs:nodejs /app/.agent ./.agent
# Migration tooling ships with the image so `migrate`/`db-setup` run the exact
# same SQL that was built with this release.
COPY --from=builder --chown=nextjs:nodejs /app/database ./database
COPY --from=builder --chown=nextjs:nodejs /app/scripts/db ./scripts/db
# transit-build replays the still-pending Supabase migrations at cutover.
# Remove this copy together with supabase/ in P10.
COPY --from=builder --chown=nextjs:nodejs /app/supabase/migrations ./supabase/migrations
RUN node .agent/worker.mjs --check && node -e "require.resolve('pg')" 
# Check each traced pnpm entry, including the attachment API and Next's version.
RUN node --input-type=module -e "import {globSync} from 'node:fs'; import {createRequire} from 'node:module'; import {resolve} from 'node:path'; const entries = [...globSync('node_modules/.pnpm/sharp@*/node_modules/sharp/package.json')]; if (!entries.length) throw new Error('Sharp is missing from the standalone image'); for (const entry of entries) { const sharp = createRequire(resolve(entry))('sharp'); const png = await sharp({create:{width:2,height:2,channels:3,background:'#fff'}}).png().toBuffer(); if (!png.length) throw new Error('Sharp image processing failed'); } console.log('Sharp runtime check passed');"
# PDF and Office uploads are parsed in worker threads from .agent, and pdf.js reads its CMaps and fonts from
# disk; without them Chinese PDFs extract as blanks. The check reads a Chinese PDF through the bundled worker.
RUN node .agent/document-text-worker.mjs --check && test -f node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf && test -f node_modules/pdfjs-dist/LICENSE
RUN mkdir -p .next/cache && chown -R nextjs:nodejs .next/cache
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
