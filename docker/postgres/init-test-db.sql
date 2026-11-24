-- 在 dev 主库里再建一个 `test` database，供 e2e 用。
--
-- ## 为什么合并到同一个实例
--
-- 原先 test 是独立容器（`lucent-postgres-test`），代价是同一台机器上跑两份
-- 同版本 Postgres：两份卷、两份 pgvector/zhparser 扩展、两套健康检查，再加一个
-- 常驻端口。而 e2e 需要的隔离**只到 database 粒度**——它清的是自己的表，从不碰
-- dev 库；两个库共用一个实例不会互相看到对方的数据。
--
-- ## 隔离靠什么保证
--
-- 两个 database 之间没有跨库查询路径，e2e 的 `migrate reset` 也只作用于
-- `test`。剩下的风险是实例级故障同时打挂两边——这在本地开发里不是问题
-- （两个容器本来就跑在同一块盘、同一个 Docker 上，故障域本就相同）。
--
-- ## 这个脚本只在**空卷首次启动**时执行
--
-- `docker-entrypoint-initdb.d` 里的脚本仅当 `PGDATA` 为空时运行。已存在的
-- dev 卷不会重跑它，需要在旧卷上手工 `CREATE DATABASE test`（见 README）。

CREATE DATABASE test OWNER postgres;

-- pgvector 与 zhparser 是 per-database 扩展，新库必须自己建一遍，
-- 否则 e2e 里依赖向量检索的用例会在 `type "vector" does not exist` 上失败。
\connect test

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- zhparser 依赖 SCWS 词典，镜像里已带；没有词典时 `CREATE EXTENSION` 会报
-- undefined symbol，用它来确认镜像构建没问题。
CREATE EXTENSION IF NOT EXISTS zhparser;

-- `CREATE TEXT SEARCH CONFIGURATION` 没有 `IF NOT EXISTS`，用 DO 包一层。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'chinese') THEN
    CREATE TEXT SEARCH CONFIGURATION chinese (PARSER = zhparser);
    ALTER TEXT SEARCH CONFIGURATION chinese ADD MAPPING FOR n,v,a,i,e,l WITH simple;
  END IF;
END $$;