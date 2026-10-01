# semantica-service —— 英文侧 OAG sidecar 的运行镜像
#
# 构建（在**有外网**的机器上；离线服务器无法构建本镜像）：
#   docker build -t lucent-semantica:latest .
#   docker buildx build --platform linux/arm64 -t lucent-semantica:arm64 . --load
#
# 构建为什么必须有外网：依赖里 `semantica` 是 git 依赖，构建时要 clone
# GitHub。离线服务器上构建必然失败 —— 所以本镜像**在有网机器构建后
# `docker save` 搬运**，不要在服务器上重建。
#
# ── 关于 git 依赖的协议改写 ──────────────────────────────────────────
# `pyproject.toml` 的 [tool.uv.sources] 写的是
#   git = "ssh://git@github.com/LuoMuLoyal/semantica.git"
# 而 uv.lock 把它锁到具体 commit：
#   ssh://git@github.com/LuoMuLoyal/semantica.git?branch=main#42519e6570...
#
# 容器构建环境没有 SSH key，`ssh://` 会直接失败。该仓库是**公开**的，
# 所以下面在构建阶段把 pyproject.toml 里的 ssh 前缀改写成 https
# （uv 会用改写后的 URL 去 fetch，`uv.lock` 里的 commit 锁定依然生效，
# 因为 UV 只比对包名与 version）。这样不必在镜像里塞密钥，也不必改动
# 仓库存档的 pyproject.toml。
#
# 若将来该 fork 转为私有，则必须改用构建期 secret（BuildKit `--secret`）
# 注入部署密钥，不能回退到把 key COPY 进镜像。

# ── Stage 1: 依赖 ────────────────────────────────────────────────────
FROM python:3.13-slim AS deps

# git 是 git 依赖的必需项；curl 给 uv 安装脚本用。
# --no-install-recommends + 清 apt 列表：最终镜像不带这些构建期工具。
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*

# uv 官方静态二进制（比 pip 安装快且不污染 site-packages）
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /app

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

# 先只 COPY 依赖清单：改业务代码时这一层仍可命中缓存，
# 不必重新 clone GitHub 与解析依赖。
COPY pyproject.toml uv.lock ./

# ssh:// → https://。**两处都要改**：`pyproject.toml` 的 [tool.uv.sources]
# 与 `uv.lock` 里 `semantica` 包的 `source = { git = ... }`。
# `--frozen` 会以 lock 记录为准去 fetch，只改 pyproject 仍会走 ssh
# （实测报 "cannot run ssh: No such file or directory"）。
# 两个文件都只在本层副本上改写，仓库里的文件不受影响；lock 的 commit
# 锁定（#42519e65…）保持有效，因此解析结果仍是同一份代码。
RUN sed -i 's|ssh://git@github.com/|https://github.com/|g' pyproject.toml uv.lock \
    && uv sync --frozen --no-dev --no-install-project

# ── Stage 2: 运行时 ──────────────────────────────────────────────────
FROM python:3.13-slim AS runtime

# 运行期只需 ca-certificates（HTTPS 出站）与 curl（healthcheck 用 python，
# 这里不依赖 curl，但保留便于容器内排障时按需删）。
# 不装 git：依赖已经装完，运行期不需要 VCS。
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*

# uv 静态二进制：运行期 stage 也带上，用于最后一步的 editable 安装。
# 它不依赖 venv，装完包后留在镜像里也不会被误用（CMD 直接调 uvicorn）。
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/

# 非 root 运行
RUN groupadd --system --gid 1001 semantica \
    && useradd --system --uid 1001 --gid semantica --create-home semantica

WORKDIR /app

# 虚拟环境整份搬过来：路径一致（/app/.venv），venv 内的 shebang 仍然有效。
COPY --from=deps --chown=semantica:semantica /app/.venv /app/.venv

# 业务代码 + 把本包以 editable 装进 venv。
# 依赖已在 deps 阶段装齐，这里 `--no-deps` 只做本地可编辑安装，不再联网。
#
# 用 `uv pip` 而不是 `python -m pip`：uv 建的 venv **不含 pip**
# （实测 `/app/.venv/bin/python: No module named pip`）。
# uv 装在 /usr/local/bin，运行时阶段可用（它是静态二进制，不依赖 venv）。
COPY --chown=semantica:semantica src ./src
COPY --chown=semantica:semantica pyproject.toml uv.lock README.md ./
RUN sed -i 's|ssh://git@github.com/|https://github.com/|g' pyproject.toml \
    && VIRTUAL_ENV=/app/.venv uv pip install --no-deps --no-build-isolation -e . \
    && find /app -name '__pycache__' -type d -prune -exec rm -rf {} +

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH="/app/src" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# 配置一律来自环境变量（compose 的 env_file 注入），
# 不 COPY .env —— 配置事实源在编排侧，镜像里不带凭据。
# 应用自身也会尝试读工作目录下的 .env，这里挂载点在 /app/.env，
# 由 compose 用 env_file 注入环境变量即可，无需文件。

USER semantica

EXPOSE 8099

# /health 会真借一条 Bolt 连接读图规模：图不可达时返回 503，
# 探针如实失败，而不是只看进程活着。
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=10 \
    CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8099/health').read()" || exit 1

CMD ["uvicorn", "semantica_service.main:app", "--host", "0.0.0.0", "--port", "8099"]
