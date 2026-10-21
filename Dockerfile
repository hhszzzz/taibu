FROM node:24.21.0-alpine3.23 AS base
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
ARG SUPABASE_PUBLIC_URL
ARG SELF_HOSTED=false
ENV SUPABASE_PUBLIC_URL=$SUPABASE_PUBLIC_URL
ENV SELF_HOSTED=$SELF_HOSTED
RUN --mount=type=cache,id=taibu-pnpm,target=/pnpm/store pnpm build

FROM node:24.21.0-alpine3.23 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# The worker uses Next's server helpers outside Web's bundled route chunks.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/next ./node_modules/next
COPY --from=builder /app/LICENSE ./LICENSE
COPY --from=builder /app/packages/core/LICENSE ./licenses/taibu-core.LICENSE
COPY --from=builder --chown=nextjs:nodejs /app/.agent ./.agent
RUN node .agent/worker.mjs --check
# Check each traced pnpm entry, including the attachment API and Next's version.
RUN node --input-type=module -e "import {globSync} from 'node:fs'; import {createRequire} from 'node:module'; import {resolve} from 'node:path'; const entries = [...globSync('node_modules/.pnpm/sharp@*/node_modules/sharp/package.json')]; if (!entries.length) throw new Error('Sharp is missing from the standalone image'); for (const entry of entries) { const sharp = createRequire(resolve(entry))('sharp'); const png = await sharp({create:{width:2,height:2,channels:3,background:'#fff'}}).png().toBuffer(); if (!png.length) throw new Error('Sharp image processing failed'); } console.log('Sharp runtime check passed');"
# Document text extraction reads pdf.js CMaps and fonts from disk; without them Chinese PDFs extract as blanks.
RUN test -f node_modules/pdfjs-dist/cmaps/UniGB-UCS2-H.bcmap && test -f node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf && test -f node_modules/pdfjs-dist/LICENSE
RUN mkdir -p .next/cache && chown -R nextjs:nodejs .next/cache
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
