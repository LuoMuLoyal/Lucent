/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 类型枚举
    'type-enum': [
      2,
      'always',
      [
        'feat', // 新功能
        'fix', // Bug 修复
        'docs', // 文档
        'style', // 代码格式（不影响功能）
        'refactor', // 重构（既不修复 Bug 也不添加功能）
        'perf', // 性能优化
        'test', // 测试
        'build', // 构建系统或外部依赖
        'ci', // CI 配置
        'chore', // 其他杂项
        'revert', // 回滚
      ],
    ],
    // subject 最大长度
    'subject-max-length': [2, 'always', 100],
    // body 每行最大长度
    'body-max-line-length': [2, 'always', 200],
    // 允许中文 subject
    'subject-case': [0],
    // header 最大长度（type(scope): subject）
    'header-max-length': [2, 'always', 120],
  },
};
