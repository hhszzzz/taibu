FROM node:24.21.0-alpine3.23

# 固定 pnpm 版本，避免 lockfileVersion 9 与未来主版本不兼容
RUN npm install -g pnpm@10.28.1

WORKDIR /app

# 复制 workspace 配置
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# 复制所有 packages
COPY packages/core ./packages/core
COPY packages/mcp-server ./packages/mcp-server

# 安装依赖（包括 devDependencies 用于构建）
RUN pnpm install --frozen-lockfile

# 构建 core
WORKDIR /app/packages/core
RUN pnpm build

# 构建 mcp-server
WORKDIR /app/packages/mcp-server
RUN pnpm build

RUN addgroup -S mcpgroup && adduser -S mcpuser -G mcpgroup

EXPOSE 3001

USER mcpuser

CMD ["node", "dist/index.js"]
