# syntax=docker/dockerfile:1

# ── Stage 1: deps ──────────────────────────────────────────────
FROM node:24.20-alpine AS deps
RUN corepack enable
WORKDIR /app
# pnpm-workspace.yaml 携带 overrides（stack-trace 固定版本）等工作区配置；
# 缺失会导致 pnpm install --frozen-lockfile 报 ERR_PNPM_LOCKFILE_CONFIG_MISMATCH。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ── Stage 2: builder ───────────────────────────────────────────
FROM node:24.20-alpine AS builder
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
COPY tsconfig.json tsconfig.build.json .swcrc nest-cli.json ./
COPY src ./src
# 生成 Prisma Client（输出到 generated/prisma，由 schema.prisma output 字段决定）
# 使用 pnpm prisma:generate 而非直接 prisma generate：prisma 7 的 prisma-client
# provider 只生成 .ts 文件，prisma:generate 脚本会额外运行
# prisma/fix-generated-prisma-internal.ts（已随 prisma/ COPY 进镜像）
# 将 .ts 编译为 .js（运行时 dist/ 中的 import() 需要 .js 文件）
# prisma.config.ts requires DATABASE_URL to load; the build stage doesn't
# connect to a database, but prisma generate needs it for config validation.
ENV DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder?schema=public
RUN pnpm prisma:generate
# 编译 TypeScript（nest build 会根据 assets 配置复制 i18n JSON 到 dist/）
RUN --mount=type=cache,id=swc,target=/root/.swc \
    pnpm run build
# 剪出生产依赖
RUN pnpm prune --prod --ignore-scripts
# ── 运行时瘦身 ─────────────────────────────────────────────────
# 只删除运行时不会读取的文件与包；每一项都在容器内用真实请求验证过
# （prisma migrate deploy + /api/v1/health 深探针 + /api/docs +
#   /scalar/standalone.js + /admin），依据见
# docs/logs/migration-log/2026-09-18.md。
RUN set -eux; \
    # 1) source map：仅调试器 / --enable-source-maps 会读，生产运行不加载
    find node_modules dist -name '*.map' -type f -delete; \
    # 2) 包内文档：保留 LICENSE/NOTICE/COPYING 以合规
    find node_modules -name '*.md' -type f \
      ! -iname 'LICENSE*' ! -iname 'NOTICE*' ! -iname 'COPYING*' -delete; \
    # 3) Prisma query compiler：本项目只用 PostgreSQL，其余数据库的
    #    wasm-base64 副本（4~5 MB × js/mjs × fast/small）全部删除
    find node_modules/.pnpm/@prisma+client@*/node_modules/@prisma/client/runtime \
      -name 'query_compiler_*wasm-base64.*' ! -name '*postgresql*' -delete; \
    # 4) 字体包自带的 woff2 未被引用：pdf-fonts.ts 只 require.resolve OTF
    rm -f node_modules/.pnpm/@fontpkg+source-han-sans-sc-vf@*/node_modules/@fontpkg/source-han-sans-sc-vf/*.woff2; \
    # 5) swagger-ui-dist：@nestjs/swagger 仅在 SwaggerModule.setup() 里 require，
    #    本项目用 Scalar 提供 /api/docs，从未调用 setup()
    rm -rf node_modules/.pnpm/swagger-ui-dist@*; \
    # 6) Scalar 文档 UI 的图标源码组件：已编译进 api-reference/dist/standalone.js
    rm -rf node_modules/.pnpm/@scalar+icons@* \
           node_modules/.pnpm/@phosphor-icons+core@*; \
    # 7) 清理因删包而悬空的 pnpm 符号链接（busybox find 没有 -xtype）
    find node_modules -type l | while read -r link; do \
      [ -e "$link" ] || rm -f "$link"; \
    done

# ── Stage 3: production ────────────────────────────────────────
FROM node:24.20-alpine AS production
RUN apk add --no-cache tini curl
WORKDIR /app
# 创建非 root 用户
RUN addgroup -S lucent && adduser -S lucent -G lucent
# AdminJS.initialize 会在工作目录下 mkdir '.adminjs'（自定义组件 bundle），
# 因此 /app 目录本身必须归 lucent。只改这一个目录的属主（元数据层，几十字节），
# 不做 `chown -R`——那会把整份 node_modules 复制成一个新层。
RUN chown lucent:lucent /app
# 生产依赖（已 prune + 瘦身）
# 全部用 COPY --chown 落地：此前在末尾 `RUN chown -R /app` 会把整份 /app
# （含 1.4 GB node_modules）复制成一个新层，未压缩镜像因此翻倍。
COPY --chown=lucent:lucent --from=builder /app/node_modules ./node_modules
# 编译产物（含 dist/i18n/ 翻译文件）
COPY --chown=lucent:lucent --from=builder /app/dist ./dist
# Prisma 生成的客户端（schema.prisma output = ../generated/prisma，即仓库根 generated/）
# package.json imports 字段 "#generated/*": "./generated/*" 依赖此路径
COPY --chown=lucent:lucent --from=builder /app/generated/prisma ./generated/prisma
# Prisma schema + config（migrate 独立步骤用，见 Phase 3）
COPY --chown=lucent:lucent prisma ./prisma
COPY --chown=lucent:lucent prisma.config.ts ./prisma.config.ts
# src/config/env/env-file-paths.ts — prisma.config.ts 的导入依赖
COPY --chown=lucent:lucent --from=builder /app/src/config/env/env-file-paths.ts ./src/config/env/env-file-paths.ts
# package.json（Winston 等需要读取 version）
COPY --chown=lucent:lucent package.json ./
# 启动入口:先 prisma migrate deploy 再启动应用(见脚本头注释)
COPY --chown=lucent:lucent --chmod=755 entrypoint.sh ./entrypoint.sh
# 运行时只写 stdout(Coolify/容器收集)+ VictoriaLogs(见 compose.yaml),
# 不再需要容器内日志目录。
USER lucent
EXPOSE 3000
ENTRYPOINT ["tini", "--"]
CMD ["/app/entrypoint.sh"]
