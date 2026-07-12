// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'eslint.config.mjs',
      'commitlint.config.mjs',
      'deploy/**/*.ts',
      'scripts/**/*.ts',
      'scripts/**/*.js',
      // k6 性能测试脚本运行在 k6 运行时中，不适用 Node.js / TS 类型检查
      'test/performance/**/*.ts',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
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
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-confusing-void-expression': 'error',

      // Prettier 由 eslint-plugin-prettier/recommended 自动从 .prettierrc 读取配置，不再显式覆盖
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
    },
  },
);
