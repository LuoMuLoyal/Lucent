# lucent-db — Lucent 的 PostgreSQL 镜像（pgvector + zhparser）
#
# 这就是三环境 compose 里 `postgres` 服务所用的镜像：Lucent 主库本身。
# 图后端自 ADR-0022 起是 Neo4j，与本镜像无关；AGE 已于 2026-10-01 整体移除。
#
# 构建：
#   docker build -t lucent-db:18 docker/postgres
#
# 基底已含 pgvector（Lucent 自身向量检索用），这里再编译 zhparser。
#
# zhparser 提供中文分词（基于 SCWS），用于中文药品检索：现有检索走
# `search_text ILIKE '%q%'`（pg_trgm），不做词边界切分，因此「阿司匹林 肠溶」
# 这类多词/乱序查询无法命中。zhparser 的 CI 只覆盖到 PG16，本镜像在 PG18 上
# 编译通过与否由构建本身把关（失败即 build 中断，不会产出半成品镜像）。

# ── zhparser 构建阶段 ──────────────────────────────────────────
FROM pgvector/pgvector:pg18 AS builder

# xz-utils unpacks the SCWS tarball (bz2) for zhparser.
RUN apt-get update \
    && apt-mark hold locales \
    && apt-get install -y --no-install-recommends \
        build-essential \
        postgresql-server-dev-18 \
        zlib1g-dev \
        curl \
        ca-certificates \
        xz-utils \
    && rm -rf /var/lib/apt/lists/*

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

# zhparser 的 .so / control / 安装 SQL。control 声明 default_version = 2.4，
# 因此 2.4 的安装脚本必须一起带上，否则 CREATE EXTENSION 会找不到脚本。
COPY --from=builder /usr/lib/postgresql/18/lib/zhparser.so /usr/lib/postgresql/18/lib/zhparser.so
COPY --from=builder /usr/share/postgresql/18/extension/zhparser.control /usr/share/postgresql/18/extension/zhparser.control
COPY --from=builder /usr/share/postgresql/18/extension/zhparser--2.4.sql /usr/share/postgresql/18/extension/zhparser--2.4.sql

# SCWS 词典与规则 —— 没有它们 zhparser 无法分词（会报找不到词典）。
COPY --from=builder /usr/share/postgresql/18/tsearch_data/dict.utf8.xdb /usr/share/postgresql/18/tsearch_data/dict.utf8.xdb
COPY --from=builder /usr/share/postgresql/18/tsearch_data/rules.utf8.ini /usr/share/postgresql/18/tsearch_data/rules.utf8.ini

# SCWS 运行期共享库 —— zhparser.so 动态链接它，缺了会在 CREATE EXTENSION 时报
# undefined symbol。ldconfig 刷新缓存让动态链接器能找到它。
COPY --from=builder /usr/local/lib/libscws.so /usr/local/lib/libscws.so
COPY --from=builder /usr/local/lib/libscws.so.1 /usr/local/lib/libscws.so.1
RUN ldconfig
