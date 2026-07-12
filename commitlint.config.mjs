/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-empty': [2, 'never'],
    // 允许中文 subject（关闭大小写校验）
    'subject-case': [0],
    'header-max-length': [2, 'always', 120],
    'subject-max-length': [2, 'always', 100],
    'body-max-line-length': [2, 'always', 200],
  },
};
