import type { KnipConfig } from 'knip'

/**
 * knip 只该报我们自己写出来的死代码，不该报"刻意保留的上游模板面"。
 *
 * 上一阶段的裁决是**整体保留上游 shadcn-admin 的模板页面与组件**（它们不接入侧栏导航，
 * 因此没有任何入口引用）。这些文件连同只被它们使用的依赖，属于保留面而不是死代码，
 * 所以在这里显式列出；新增真实死代码时不要往这里加，直接删。
 */
const config: KnipConfig = {
  ignore: [
    // 上游 UI 原语：保留整套，只按需引用其中一部分。
    'src/components/ui/**',
    'src/tanstack-table.d.ts',
    // 模板仪表盘组件：真实仪表盘改用 `/admin/metrics/overview` 后不再被引用，
    // 但按裁决保留（`recharts` 只被它们使用）。
    'src/features/dashboard/components/**',
    // 模板布局件：当前布局只用 sidebar 组合，这两个保留备用。
    'src/components/layout/team-switcher.tsx',
    'src/components/layout/top-nav.tsx',
  ],
  ignoreDependencies: [
    // 只被上面保留面使用。
    '@radix-ui/react-tabs',
    'recharts',
  ],
}

export default config
