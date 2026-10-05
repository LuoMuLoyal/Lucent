# GitHub Actions Workflows

按**关注点**拆分，而不是一个 `lucent-ci.yml` 装所有 job。好处：粒度权限
（默认 `contents: read`，写权限只给需要的 job）、独立触发与并发组、失败隔离
（镜像构建挂了不等于门禁挂了）、小 diff。

| 文件             | `name:`      | 职责                                         | 触发           |
| ---------------- | ------------ | -------------------------------------------- | -------------- |
| `ci.yml`         | `CI`         | lint / typecheck / 单测 / e2e + OpenAPI 契约 | push, PR, 手动 |
| `docker.yml`     | `Docker`     | 双架构构建 + Trivy（**不推送**）             | push, PR, 手动 |
| `release.yml`    | `Release`    | **发布** `lucent` multi-arch 镜像            | 手动（main）   |
| `release-db.yml` | `Release DB` | **发布** `lucent-db` multi-arch 镜像         | 手动（main）   |

文档门禁（`docs:verify` / `docs:links`）在本地 `pre-push` 与 `pnpm check` 里跑，
不占 Actions 配额，故没有 `docs.yml`。

## 为什么 app 与 DB 分两个 workflow

`lucent-db`（PostgreSQL + pgvector + 编译期产出的 zhparser 原生 `.so`）的构建输入
只有 `docker/postgres/**`，实测 40 个提交里只动过一次；而 app 几乎每次发布都要发。
合在一个 workflow 里会让**每次 app 发布都白等两个 DB 构建 leg**（arm64 runner 更慢）。
所以 DB 独立成 `release-db.yml`，按需手动触发。

两者的 **tag 语义也因此不同**：

| 镜像        | tag                                                          |
| ----------- | ------------------------------------------------------------ |
| `lucent`    | `sha-<sha8>`（不可变回滚锚点）+ `latest`，跟 app 提交走      |
| `lucent-db` | `pg<major>-<YYYYMMDD>-<sha8>`（不可变）+ `pg<major>`（浮动） |

⚠️ **DB 镜像不能也标 `sha-<sha8>`**：它的内容与 app 提交无关，同一个 tag 名字在
两个 workflow 里会指向不同 digest，回滚时极易搞混。服务器应钉 `pg<major>-<日期>-<sha8>`
这种不可变 tag。

## 发布模型（`release.yml` / `release-db.yml`）

**每架构原生构建 → 各自按 digest 推送 → merge job 合成 multi-arch manifest。**

不用 QEMU：`ubuntu-24.04-arm` 对**公开仓库**免费（本仓库是 public），原生构建既快
又避免模拟环境下的工具链行为差异——本项目实测在 QEMU 下 `prisma` 会 panic。

```
build (2×arch)
  → 各推 `@sha256:...`（无 tag）
  → upload-artifact `digests-<image>-<arch>`
merge
  → download-artifact 按 name 逐个取
  → buildx imagetools create → tag
```

tag 不含架构：一个 tag 指向 multi-arch manifest list，Docker 按目标平台自动选层。
于是服务器 `.env` 里 `LUCENT_IMAGE=<ns>/lucent:sha-1a2b3c4d` **换架构不必改**；
回滚 = 把 tag 改回旧 `sha-<旧 sha8>` 再 `up -d --force-recreate`。

### ⚠️ merge job 必须按 `name` 精确下载 digest

**不能**省掉 `name` 去下载本次 run 的全部 artifact：`docker/build-push-action`
会自动上传 buildx 缓存（名为 `<owner>~<repo>~<id>.dockerbuild`，每个 100–260 KB），
把它们一起拉进来既无必要，又会在某个缓存 artifact 下载重试失败时拖垮整个 merge
job —— 2026-10-05 run `37295603463` 就是这样失败的（`Artifact download failed
after 5 retries`）。

也**不能**用 `pattern: digests-lucent-*`：那是 `digests-lucent-db-*` 的**前缀**，
会把 DB 的层混进 app 的 manifest。逐架构写死 `name:` 可彻底避免两者。

### 需要的 secrets

| Secret                                   | 用途                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `REGISTRY_IMAGE`                         | app 镜像**完整引用**，如 `docker.io/<your-user>/lucent`；末段必须是 `lucent` |
| `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` | 登录 registry                                                                |

`REGISTRY_NAMESPACE`（`<registry>/<owner>`）与 tag 由 `validate` job 从
`REGISTRY_IMAGE` **派生**，不是独立 secret。DB 镜像名同理派生成 `<ns>/lucent-db`
（两个 workflow 共用这一个变量），所以只需上面这一个镜像变量。

`REGISTRY_IMAGE` 的校验规则（`validate` job，不满足直接 exit 1）：末段必须是 `lucent`；
必须含命名空间——`docker.io/lucent` 会让 namespace 退化成 `docker.io`，派生出的 DB 镜像
`docker.io/lucent-db` 落在 Docker Hub 官方库下、推送必被拒。

公开仓库代码不写死用户名——镜像引用由 secret 注入。

## 改 `name:` 时的注意

GitHub 用工作流**文件名**关联历史运行记录。重命名文件会与该 workflow 的历史脱钩
（`ci.yml` / `docker.yml` / `release.yml` 即由 `lucent-ci.yml` /
`lucent-production.yml` 演进而来）。`README.md` 顶部的 CI badge 指向
`ci.yml`，改名时要同步。
