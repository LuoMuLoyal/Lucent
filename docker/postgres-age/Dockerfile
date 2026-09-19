# lucent-db — Lucent 的 PostgreSQL 镜像（pgvector + Apache AGE）
#
# 这就是三环境 compose 里 `postgres` 服务所用的镜像：Lucent 主库本身，
# 额外带 AGE 扩展供英文侧 OAG 图查询。图数据在独立 database
# `lucent_graph` 中，与 Prisma 域隔离。
#
# 构建：
#   docker build -t lucent-db:18 docker/postgres-age
#
# AGE 钉在 PG18/v1.7.0-rc0，不要升到 1.8.0：apache/age#2500（open）使
# `id(n) IN <list>` 返回按值传递的 graphid，而 agtype_in_operator 仍按
# varlena 指针解引用，直接 segfault 并触发 PG 崩溃恢复。
#
# 基底已含 pgvector（Lucent 自身向量检索用），因此这里只编译 AGE。

FROM pgvector/pgvector:pg18 AS age-builder

# flex/bison parse the Cypher grammar; readline and zlib are link-time
# dependencies of the AGE parser. curl is used instead of git so the builder
# needs no VCS (the tarball also leaves no .git directory behind).
RUN apt-get update \
    && apt-mark hold locales \
    && apt-get install -y --no-install-recommends \
        build-essential \
        postgresql-server-dev-18 \
        libreadline-dev \
        zlib1g-dev \
        flex \
        bison \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Tracks the PG18 1.7.0 pre-release tag. See the header for why 1.8.0 is
# excluded; bump this only after apache/age#2500 is resolved.
ARG AGE_REF=PG18/v1.7.0-rc0

RUN mkdir -p /tmp/age \
    && curl -fsSL "https://github.com/apache/age/archive/refs/tags/${AGE_REF}.tar.gz" \
        | tar -xz --strip-components=1 -C /tmp/age \
    && cd /tmp/age \
    && make \
    && make install \
    && rm -rf /tmp/age


FROM pgvector/pgvector:pg18

# AGE 的 .so 与扩展控制文件；COPY 而非整层复制，避免把编译工具链带进最终镜像。
COPY --from=age-builder /usr/lib/postgresql/18/lib/age.so /usr/lib/postgresql/18/lib/age.so
COPY --from=age-builder /usr/share/postgresql/18/extension/age.control /usr/share/postgresql/18/extension/age.control
COPY --from=age-builder /usr/share/postgresql/18/extension/age--1.7.0.sql /usr/share/postgresql/18/extension/age--1.7.0.sql

# AGE requires a per-session LOAD, which preloading makes available without
# the adapter having to issue it (it does anyway; this is belt and braces).
CMD ["postgres", "-c", "shared_preload_libraries=age"]
