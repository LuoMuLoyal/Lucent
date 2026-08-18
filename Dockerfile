# syntax=docker/dockerfile:1

# ── Stage 1: deps ──────────────────────────────────────────────
FROM node:24-alpine AS deps
RUN corepack enable
WORKDIR /app
# pnpm-workspace.yaml 携带 overrides（stack-trace 固定版本）等工作区配置；
# 缺失会导致 pnpm install --frozen-lockfile 报 ERR_PNPM_LOCKFILE_CONFIG_MISMATCH。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ── Stage 2: builder ───────────────────────────────────────────
FROM node:24-alpine AS builder
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
COPY tsconfig.json tsconfig.build.json .swcrc nest-cli.json ./
COPY scripts ./scripts
COPY src ./src
# 生成 Prisma Client（输出到 generated/prisma，由 schema.prisma output 字段决定）
# 使用 pnpm prisma:generate 而非直接 prisma generate：prisma 7 的 prisma-client
# provider 只生成 .ts 文件，prisma:generate 脚本会额外运行 fix-generated-prisma-internal.ts
# 将 .ts 编译为 .js（运行时 dist/ 中的 require() 需要 .js 文件）
RUN pnpm prisma:generate
# 编译 TypeScript（nest build 会根据 assets 配置复制 i18n JSON 到 dist/）
RUN --mount=type=cache,id=swc,target=/root/.swc \
    pnpm run build
# 剪出生产依赖
RUN pnpm prune --prod --ignore-scripts

# ── Stage 3: production ────────────────────────────────────────
FROM node:24-alpine AS production
RUN apk add --no-cache tini curl
WORKDIR /app
# 创建非 root 用户
RUN addgroup -S lucent && adduser -S lucent -G lucent
# 生产依赖（已 prune）
COPY --from=builder /app/node_modules ./node_modules
# 编译产物（含 dist/i18n/ 翻译文件）
COPY --from=builder /app/dist ./dist
# Prisma 生成的客户端（schema.prisma output = ../generated/prisma，即仓库根 generated/）
# package.json imports 字段 "#generated/*": "./generated/*" 依赖此路径
COPY --from=builder /app/generated/prisma ./generated/prisma
# Prisma schema + config（migrate 独立步骤用，见 Phase 3）
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
# src/config/env/env-file-paths.ts — prisma.config.ts 的导入依赖
COPY --from=builder /app/src/config/env/env-file-paths.ts ./src/config/env/env-file-paths.ts
# package.json（Winston 等需要读取 version）
COPY package.json ./
# 创建日志目录并设置权限
RUN mkdir -p /app/logs && chown -R lucent:lucent /app
USER lucent
EXPOSE 3000
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/main.js"]
