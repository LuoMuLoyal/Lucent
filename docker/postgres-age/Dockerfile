# lucent-db — Lucent 的 PostgreSQL 镜像（pgvector + Apache AGE + zhparser）
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
# 基底已含 pgvector（Lucent 自身向量检索用），这里再编译 AGE 与 zhparser。
#
# zhparser 提供中文分词（基于 SCWS），用于中文药品检索：现有检索走
# `search_text ILIKE '%q%'`（pg_trgm），不做词边界切分，因此「阿司匹林 肠溶」
# 这类多词/乱序查询无法命中。zhparser 的 CI 只覆盖到 PG16，本镜像在 PG18 上
# 编译通过与否由构建本身把关（失败即 build 中断，不会产出半成品镜像）。

# ── AGE + zhparser 构建阶段 ─────────────────────────────────────
FROM pgvector/pgvector:pg18 AS age-builder

# flex/bison parse the Cypher grammar; readline and zlib are link-time
# dependencies of the AGE parser. curl is used instead of git so the builder
# needs no VCS (the tarball also leaves no .git directory behind).
# xz-utils unpacks the SCWS tarball (bz2) for zhparser.
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
        xz-utils \
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

# SCWS — zhparser's tokenizer backend. Built from source because Debian/Ubuntu
# ship no libscws package. Installs to /usr/local/lib/libscws.so.
RUN curl -fsSL "http://www.xunsearch.com/scws/down/scws-1.2.3.tar.bz2" \
        -o /tmp/scws.tar.bz2 \
    && mkdir -p /tmp/scws \
    && tar -xjf /tmp/scws.tar.bz2 -C /tmp/scws --strip-components=1 \
    && cd /tmp/scws \
    && ./configure \
    && make -j"$(nproc)" \
    && make install \
    && rm -rf /tmp/scws /tmp/scws.tar.bz2

# zhparser tracks master: the project tags releases (v2.1) but the PG18-era
# fixes live on master. Pin a commit sha here if reproducible builds are needed.
ARG ZHPARSER_REF=master

RUN mkdir -p /tmp/zhparser \
    && curl -fsSL "https://github.com/amutu/zhparser/archive/refs/heads/${ZHPARSER_REF}.tar.gz" \
        | tar -xz --strip-components=1 -C /tmp/zhparser \
    && cd /tmp/zhparser \
    && make \
    && make install \
    && rm -rf /tmp/zhparser


FROM pgvector/pgvector:pg18

# AGE 的 .so 与扩展控制文件；COPY 而非整层复制，避免把编译工具链带进最终镜像。
COPY --from=age-builder /usr/lib/postgresql/18/lib/age.so /usr/lib/postgresql/18/lib/age.so
COPY --from=age-builder /usr/share/postgresql/18/extension/age.control /usr/share/postgresql/18/extension/age.control
COPY --from=age-builder /usr/share/postgresql/18/extension/age--1.7.0.sql /usr/share/postgresql/18/extension/age--1.7.0.sql

# zhparser 的 .so / control / 安装 SQL。control 声明 default_version = 2.4，
# 因此 2.4 的安装脚本必须一起带上，否则 CREATE EXTENSION 会找不到脚本。
COPY --from=age-builder /usr/lib/postgresql/18/lib/zhparser.so /usr/lib/postgresql/18/lib/zhparser.so
COPY --from=age-builder /usr/share/postgresql/18/extension/zhparser.control /usr/share/postgresql/18/extension/zhparser.control
COPY --from=age-builder /usr/share/postgresql/18/extension/zhparser--2.4.sql /usr/share/postgresql/18/extension/zhparser--2.4.sql

# SCWS 词典与规则 —— 没有它们 zhparser 无法分词（会报找不到词典）。
COPY --from=age-builder /usr/share/postgresql/18/tsearch_data/dict.utf8.xdb /usr/share/postgresql/18/tsearch_data/dict.utf8.xdb
COPY --from=age-builder /usr/share/postgresql/18/tsearch_data/rules.utf8.ini /usr/share/postgresql/18/tsearch_data/rules.utf8.ini

# SCWS 运行期共享库 —— zhparser.so 动态链接它，缺了会在 CREATE EXTENSION 时报
# undefined symbol。ldconfig 刷新缓存让动态链接器能找到它。
COPY --from=age-builder /usr/local/lib/libscws.so /usr/local/lib/libscws.so
COPY --from=age-builder /usr/local/lib/libscws.so.1 /usr/local/lib/libscws.so.1
RUN ldconfig

# AGE requires a per-session LOAD, which preloading makes available without
# the adapter having to issue it (it does anyway; this is belt and braces).
CMD ["postgres", "-c", "shared_preload_libraries=age"]
