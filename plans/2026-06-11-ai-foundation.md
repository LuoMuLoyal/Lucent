## Goal

为 Lucent 建立可扩展的 AI 基础配置，支持多模型角色、多厂商接入，以及后续 RAG 所需的嵌入模型，而不是只保留单一文本/视觉模型槽位。

## Assumptions

- 当前只做基础设施，不实现 Today AI 接口或提示词编排。
- 当前先采用 LangChain 运行时组件，不引入 LangGraph。
- 当前阶段不做兼容期；旧的 `AI_TEXT_MODEL` 与共享 `AI_API_KEY` / `AI_BASE_URL` 直接替换成按角色分组的命名。
- RAG 会使用单独的文本嵌入模型，因此配置层需要预留 `embedding` 角色。

## Affected Files

- `src/config/env-keys.enum.ts`
- `src/config/environment.validation.ts`
- `src/config/environment.validation.spec.ts`
- `src/config/config-keys.enum.ts`
- `src/config/ai.config.ts`
- `src/app.module.ts`
- `.env.development.example`
- `.env.production.example`
- `docs/environment.md`
- `docs/tencent-cloud-cicd.md`
- `README.md`
- `package.json`
- `pnpm-lock.yaml`

## Milestones

1. 扩展 AI 环境变量和 Nest 配置命名空间
2. 安装 LangChain 基础依赖
3. 更新样例 env 与部署/运行文档
4. 运行相关验证

## Verification

- `pnpm lint:check`
- `pnpm build`
- `pnpm test:ci`

## Expected Observable Result

- Lucent 可通过环境变量分别配置分析、视觉、自然语言解析、聊天、聊天压缩、文本嵌入模型，并为每个角色单独指定 baseUrl、apiKey、model。
- Nest 全局配置中存在统一的 `ai` 命名空间可供后续模块消费。
- 项目文档和生产环境模板不再引用过时的 `AI_TEXT_MODEL`。
