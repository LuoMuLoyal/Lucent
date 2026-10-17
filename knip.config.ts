import type { KnipConfig } from 'knip';

/**
 * 主仓（`src/`）的死代码/死依赖扫描。
 *
 * 目标只有一件事：让「声明了但一行都没 import 的依赖」不再靠人工 grep 发现。
 * 2026-10-16 的工程能力计划就是靠手工数 import 找出的 5 个死依赖，接上 knip 后
 * 同类问题由工具持续兜住。
 *
 * 范围刻意收窄到主仓——`admin/` 是独立子项目，有自己的 `admin/knip.config.ts`；
 * `test/`、`scripts/`、`lucent-bruno/` 不是 NestJS 主程序的入口面。把它们一并喂给
 * knip 只会产出与「死依赖」无关的噪声（实测会把 admin 上游模板页整片报成死文件）。
 */
const config: KnipConfig = {
  // 只从主程序入口与它的 spec 出发算可达性。
  entry: ['src/main.ts', 'src/**/*.spec.ts'],
  project: ['src/**/*.ts'],
  ignore: [
    // 生成物：Prisma client 与 OpenAPI 导出中间层，不是手写代码。
    'src/generated/**',
  ],
  ignoreDependencies: [
    // 通过 CLI/配置字符串加载、没有静态 import 的依赖。
    'prisma',
    '@prisma/client',
    'tsx',
    'cross-env',
    'dotenv-cli',
    'wait-on',
    '@swc/*',
    'unplugin-swc',
    // Nest 运行时靠装饰器元数据装配，静态分析看不到注入使用。
    '@nestjs/platform-fastify',
    '@nestjs/swagger',
    // `app.enableCors()` 由平台适配器内部消费，代码里没有 `from '@fastify/cors'`。
    '@fastify/cors',
    // 两者都是 `@nestjs/jwt` 的传递依赖；本仓直接声明是为了钉版本，
    // 没有自己的 import。删掉会退回由传递依赖决定版本，故保留声明。
    'jsonwebtoken',
    '@types/jsonwebtoken',
    // 通过文件路径字符串加载（PDF 内嵌字体），不是模块 import。
    '@fontpkg/source-han-sans-sc-vf',
    // 只在 `vi.mock('otplib')` 里被解析，用于替换真实实现。
    'otplib',
    // `langchain` 整包目前无静态 import（实际只用 `@langchain/*` 子包），
    // 属保留项而非死依赖：它与各子包同版本发布，钉住声明可避免子包版本漂移。
    'langchain',
    // 供 vitest/eslint/ts 配置加载的类型与运行时。
    'vitest',
    '@vitest/*',
    'eslint-*',
    '@eslint/*',
    'prettier',
    'typescript',
    'oxlint',
  ],
};

export default config;
