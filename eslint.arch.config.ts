// eslint.arch.config.ts — 架构观察期规则(独立 flat config,Phase 3)
//
// 目的:以 warn 级别观察候选架构规则的真实违规规模,不侵入 lint:check
// (lint:check 带 --max-warnings=0,新规则若放主配置会立刻打爆)。
//
// 运行方式(必须带 --no-config-lookup:ESLint 9.26+ 中 -c 会与默认
// eslint.config.ts 叠加加载,导致 exit 1 且观察数据被主配置规则污染):
//   pnpm exec eslint -c eslint.arch.config.ts --no-config-lookup "src/**/*.ts" "test/**/*.ts"
//
// 观察期结束、决定采纳(迁入 eslint.config.ts)或放弃后删除本文件。
// 注意:本配置不启用 type-aware linting(无需 parserOptions.project),
// 只做语法级观察,因此不依赖 tsconfig.typecheck.json。

import tseslint from 'typescript-eslint';
import { errorHandlingPlugin } from './eslint-plugins/error-handling';

export default tseslint.config(
  // 生成物、构建产物、覆盖率、依赖一律不观察
  {
    ignores: [
      '**/generated/**',
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
    ],
  },
  // 公共解析器:仅语法级,不做类型感知。
  // 注册 @typescript-eslint 与 error-handling 插件(仅注册、规则默认关闭):
  // 源码中面向主配置规则的 eslint-disable 注释在独立运行时仍需可解析,
  // 否则 ESLint 会对引用未注册规则的内联指令报 "Definition for rule ... was
  // not found" error。规则保持 off,故这些指令不会产生任何违规。
  // 同时关闭 unused-disable-directives 报告,避免观察期噪音。
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'error-handling': errorHandlingPlugin,
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
  // W1 空 catch 观察块(带注释不报;allowEmptyCatch: false 即空 catch 也计入)
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    rules: {
      'no-empty': ['warn', { allowEmptyCatch: false }],
    },
  },
  // W2 service 层裸 throw new Error → 引导走 ADR-0012 错误契约
  {
    files: ['src/**/*.service.ts'],
    rules: {
      'no-restricted-syntax': [
        'warn',
        {
          selector:
            "ThrowStatement[argument.type='NewExpression'][argument.callee.name='Error']",
          message:
            'ADR-0012 错误契约:service 层禁止裸 throw new Error。领域失败请用 DomainFailureException(createDomainFailure({ ... })),客户端错误请用 ProblemDetails 风格的 HttpException 子类。',
        },
      ],
    },
  },
  // W3 魔法数字观察:仅 src 非测试文件(测试文件 = test/** 与 *.spec.ts,同 W4 口径)
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.spec.ts'],
    rules: {
      'no-magic-numbers': [
        'warn',
        {
          ignore: [-1, 0, 1, 2],
          enforceConst: true,
          // 注:ESLint 9 核心 no-magic-numbers 无 ignoreDefaultExports 选项
          // (那是 TSLint 的选项);核心规则默认即检查 default export,
          // 语义等同于 ignoreDefaultExports: false,故无需显式配置。
          ignoreEnums: true,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
        },
      ],
    },
  },
  // W4 测试文件显式 any:.oxlintrc 对测试关闭了此规则,此处独立观察告警
  {
    files: ['test/**/*.ts', 'src/**/*.spec.ts'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
