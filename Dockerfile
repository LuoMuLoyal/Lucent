# ── Build stage ──────────────────────────────────────────────────
FROM node:24-alpine AS builder

RUN corepack enable

WORKDIR /app

# 安装依赖（利用缓存层，--ignore-scripts 跳过 prepare/husky 等生命周期脚本）
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

# 拷贝源码 & 配置文件
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
COPY tsconfig.json tsconfig.build.json .swcrc nest-cli.json ./
COPY src ./src

# 生成 Prisma Client
RUN pnpm exec prisma generate

# 编译 TypeScript（nest build 会根据 assets 配置复制 i18n JSON 到 dist/）
RUN pnpm run build

# ── Production stage ─────────────────────────────────────────────
FROM node:24-alpine AS production

RUN corepack enable

WORKDIR /app

# 先基于完整依赖剪出生产依赖，避免最终镜像带上整套 devDependencies
COPY package.json pnpm-lock.yaml ./
COPY --from=builder /app/node_modules ./node_modules
RUN pnpm prune --prod

# 从 builder 拷贝编译产物（含 dist/i18n/ 翻译文件）
COPY --from=builder /app/dist ./dist

# 拷贝 Prisma 生成的客户端（自定义 output 路径 src/generated/prisma）
COPY --from=builder /app/src/generated/prisma ./src/generated/prisma

# 拷贝 Prisma schema（用于 migrate）
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts

# 拷贝入口脚本
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
