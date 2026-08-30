import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import oxlint from 'eslint-plugin-oxlint';
import { errorHandlingPlugin } from './eslint-plugins/error-handling';

const rootDir = __dirname;

export default tseslint.config(
  {
    ignores: [
      'eslint.config.ts',
      'eslint-plugins/**/*.ts',
      'commitlint.config.ts',
      'deploy/**/*.ts',
      'scripts/**/*.ts',
      // k6 性能测试脚本运行在 k6 运行时中，不适用 Node.js / TS 类型检查
      'test/performance/**/*.ts',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  eslintConfigPrettier,
  // ── oxlint 增量迁移 ──
  // oxlint 已经覆盖的规则在此关闭，ESLint 仅保留 error-handling 自定义规则
  // 和 oxlint 尚不支持的 type-aware 规则。
  // 当 oxlint 完全接管后可删除此配置及所有 @typescript-eslint 规则。
  ...oxlint.configs['flat/recommended'],
  {
    plugins: {
      'error-handling': errorHandlingPlugin,
    },
    languageOptions: {
      globals: {
        ...globals.node,
      },
      sourceType: 'commonjs',
      parserOptions: {
        project: './tsconfig.typecheck.json',
        tsconfigRootDir: rootDir,
      },
    },
  },
  {
    rules: {
      // ── 类型安全 ──
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/restrict-template-expressions': 'error',
      '@typescript-eslint/restrict-plus-operands': 'error',

      // ── 未使用变量 / 导入 ──
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-unused-vars': 'off', // 交给 @typescript-eslint 版本处理

      // ── 代码质量 ──
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-confusing-void-expression': 'error',

      // ── 错误处理（ADR-0012）──
      // 规则启用为 error，现有违规文件在下方 override 中暂时 off，清理后逐个删除。
      'error-handling/no-bare-throw-error': 'error',
      'error-handling/no-silent-catch': 'error',

      // ── 跨模块深路径引用禁止 ──
      // All barrel-restricted-imports patterns removed — barrel-cleanup refactoring
      // replaced sub-directory barrels with module root barrels and deep-path imports.
      // See AGENTS.md "Barrel Exports" for the current convention.
      'no-restricted-imports': [
        'error',
        {
          patterns: [],
        },
      ],

      // Prettier 格式规则由 eslint-config-prettier 统一关闭，格式检查交给独立的 prettier --check
    },
  },
  {
    // NestJS @Module() 装饰器类天然是 "空壳" 类 — 关闭此规则避免手工添加 eslint-disable 注释
    files: ['**/*.module.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
  {
    // AdminJS packages 是 ESM-only, 必须用动态 import 加载。
    // SWC 会将标准 import() 编译为 require(), 导致 ESM interop 失败。
    // 用 new Function 绕过 SWC 的 transform, 保留运行时的 import()。
    files: ['src/admin/setup.ts'],
    rules: {
      '@typescript-eslint/no-implied-eval': 'off',
    },
  },
  {
    // NestJS @OnEvent 装饰器使用 string event name，无法将 payload 类型映射到方法参数。
    // ESLint 将参数推断为 any，触发 no-unsafe-* 规则。
    // 这是框架固有限制，listener 方法参数已使用明确的 payload 类型注解。
    files: ['**/*-invalidation.listener.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  {
    // ── 错误处理规则渐进式清理 ──
    // 以下文件仍有 ADR-0012 违规（裸 throw new Error / 空 catch），
    // 暂时关闭规则。每修复一个文件就从此列表中删除对应条目。
    // TODO: 清理完毕后删除整个 override 块。
    files: [
      'src/admin/services/resource-config.service.ts',
      'src/app.service.ts',
      'src/common/api/problem-catalog.ts',
      'src/common/helpers/format/json.utils.ts',
      'src/common/helpers/infra/redis-url.ts',
      'src/common/helpers/infra/retry.utils.ts',
      'src/common/queue/queue.factory.ts',
      'src/config/env/environment.validation.ts',
      'src/config/yaml/yaml-loader.ts',
      'src/mail/mail-transport.service.ts',
      'src/modules/assistant/agent/runtime.service.ts',
      'src/modules/assistant/agent/runtime/model-stream.ts',
      'src/modules/assistant/agent/runtime/respond.ts',
      'src/modules/auth/adapters/better-auth.adapter.ts',
      'src/modules/daily-records/services/ownership.service.ts',
      'src/modules/legal-documents/services/documents.service.ts',
      'src/modules/product-events/services/events.service.ts',
      'src/modules/today-analysis/services/analysis.service.ts',
      'src/modules/today-suggestion/services/cache/suggestion-cache-invalidation.listener.ts',
      'src/modules/reports/dashboard/dashboard.service.ts',
      'src/setup-app.ts',
    ],
    rules: {
      'error-handling/no-bare-throw-error': 'off',
      'error-handling/no-silent-catch': 'off',
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      // Jest 匹配器（expect.any、expect.objectContaining 等）天然产生 any 类型值，
      // 在严格类型检查下会触发 no-unsafe-assignment / no-unsafe-argument。
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      // 测试文件中 mock 对象经常需要灵活类型，使用 any 是标准做法。
      '@typescript-eslint/no-explicit-any': 'off',
      // 测试访问 mock 属性时可能无法严格类型检查。
      '@typescript-eslint/no-unsafe-member-access': 'off',
      // 模板字符串在 e2e 测试的 URL 构造中很常见。
      '@typescript-eslint/restrict-template-expressions': 'off',
      // 测试断言中的非空断言在已验证的场景下是安全的。
      '@typescript-eslint/no-non-null-assertion': 'off',
      // 测试中某些类型断言可能是多余的，但保留它们有助于文档化意图。
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      // 测试文件允许 `throw new Error` 和空 catch（断言 helper 中的惯用模式）。
      'error-handling/no-bare-throw-error': 'off',
      'error-handling/no-silent-catch': 'off',
    },
  },
);
