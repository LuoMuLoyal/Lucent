# GitHub Actions Workflows

按**关注点**拆分，而不是一个 `lucent-ci.yml` 装所有 job。好处：粒度权限
（默认 `contents: read`，写权限只给需要的 job）、独立触发与并发组、失败隔离
（镜像构建挂了不等于门禁挂了）、小 diff。

| 文件          | `name:`   | 职责                                               | 触发           |
| ------------- | --------- | -------------------------------------------------- | -------------- |
| `ci.yml`      | `CI`      | lint / typecheck / 单测 / e2e + OpenAPI 契约       | push, PR, 手动 |
| `docker.yml`  | `Docker`  | 双架构构建 + Trivy（**不推送**）                   | push, PR, 手动 |
| `release.yml` | `Release` | **发布** multi-arch 镜像（`lucent` + `lucent-db`） | 手动（main）   |

文档门禁（`docs:verify` / `docs:links`）在本地 `pre-push` 与 `pnpm check` 里跑，
不占 Actions 配额，故没有 `docs.yml`。

## 发布模型（`release.yml`）

**每架构原生构建 → 各自按 digest 推送 → merge job 合成 multi-arch manifest。**

不用 QEMU：`ubuntu-24.04-arm` 对**公开仓库**免费（本仓库是 public），原生构建既快
又避免模拟环境下的工具链行为差异——本项目实测在 QEMU 下 `prisma` 会 panic。

```
build (lucent×amd64, lucent×arm64, lucent-db×amd64, lucent-db×arm64)
  → 各推 `@sha256:...`（无 tag）
  → upload-artifact digests-<image>-<arch>
merge (lucent, lucent-db)
  → buildx imagetools create → <ns>/<image>:sha-<sha8> + :latest
```

两个镜像都需要逐架构构建：

- `lucent` — 仓库根 `Dockerfile`（多阶段 Node 构建）。
- `lucent-db` — `docker/postgres/Dockerfile`，编译期产出 zhparser 的**原生 `.so`**，
  天然架构相关。

### tag 约定

**`sha-<git sha 前 8 位>`，不含架构。** 因为一个 tag 指向的是 multi-arch manifest
list，Docker 按目标平台自动选层。于是：

- 服务器 `.env` 里 `LUCENT_IMAGE=<ns>/lucent:sha-1a2b3c4d` —— **换架构不必改**；
- 回滚 = 把 tag 改回旧 `sha-<旧 sha8>` 再 `up -d`；
- `latest` 指向最近一次发布的构建。

### 需要的 secrets

| Secret                                   | 用途                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `REGISTRY_IMAGE`                         | app 镜像**完整引用**，如 `docker.io/<your-user>/lucent`；末段必须是 `lucent` |
| `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` | 登录 registry                                                                |

`REGISTRY_NAMESPACE`（`<registry>/<owner>`）与 tag（`sha-<sha8>`）由 `validate` job 从
`REGISTRY_IMAGE` **派生**，不是独立 secret。DB 镜像名同理派生成 `<ns>/lucent-db`，
所以只需上面这一个镜像变量。

`REGISTRY_IMAGE` 的校验规则（`validate` job，不满足直接 exit 1）：末段必须是 `lucent`；
必须含命名空间——`docker.io/lucent` 会让 namespace 退化成 `docker.io`，派生出的 DB 镜像
`docker.io/lucent-db` 落在 Docker Hub 官方库下、推送必被拒。

公开仓库代码不写死用户名——镜像引用由 secret 注入。

## 改 `name:` 时的注意

GitHub 用工作流**文件名**关联历史运行记录。重命名文件会与该 workflow 的历史脱钩
（`ci.yml` / `docker.yml` / `release.yml` 即由 `lucent-ci.yml` /
`lucent-production.yml` 演进而来）。`README.md` 顶部的 CI badge 指向
`ci.yml`，改名时要同步。
