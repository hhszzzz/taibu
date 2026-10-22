FROM node:24.22.1-alpine3.23 AS base

# 固定 pnpm 版本，避免 lockfileVersion 9 与未来主版本不兼容
RUN npm install -g pnpm@10.28.1

WORKDIR /app

# 根 package.json 换成空壳：否则 pnpm 会把 Web 应用的全部依赖装进镜像（约 1.4G）。
# 锁文件仍来自仓库，只有 mcp-server 及其依赖会被安装。
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
RUN printf '{"name":"taibu-mcp-build","private":true,"version":"0.0.0"}' > package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/mcp-server/package.json ./packages/mcp-server/package.json

# 运行时依赖层：只装生产依赖。
# 根清单已被替换，与锁文件里的根 importer 不一致，因此不能使用 --frozen-lockfile；
# 被选中的项目仍复用锁文件中锁定的版本。
FROM base AS prod-deps
RUN pnpm install --filter taibu-mcp-server... --prod --no-frozen-lockfile

# 构建层：安装 devDependencies 后编译 core 与 mcp-server
FROM base AS builder
RUN pnpm install --filter taibu-mcp-server... --no-frozen-lockfile
COPY packages/core ./packages/core
COPY packages/mcp-server ./packages/mcp-server
RUN pnpm -C packages/core build
RUN pnpm -C packages/mcp-server build

FROM node:24.22.1-alpine3.23 AS runner

WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S mcpgroup && adduser -S mcpuser -G mcpgroup

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages ./packages
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/mcp-server/dist ./packages/mcp-server/dist

WORKDIR /app/packages/mcp-server

EXPOSE 3001

USER mcpuser

CMD ["node", "dist/index.js"]
