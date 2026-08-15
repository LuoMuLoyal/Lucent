# SaaS 化后端模块与 Node 生态 Monorepo 合并计划

Created: 2026-08-14
Updated: 2026-08-15

> 状态:方向已确认(2026-08-15 技术选型调研论证),未执行。背景源于产品定位讨论:项目从大学竞赛产物转向正式产品,
> 桌面端由「冻结」升级为「SaaS 差异化独立路线」。相关讨论草稿见
> `Luminous/plans/adr-015-luminous-desktop-deprecation-and-monorepo-evolution.md`(临时草稿,非正式 ADR,2026-08-14 讨论记录);
> 配套客户端计划见 `Luminous/plans/2026-08-14-product-surface-route.md`。
> 本文档为方向性计划;具体执行细节在执行前按任务拆分子计划。

## 一、目标

1. 0.1.0 发布验证**不阻塞**——本计划的所有动作都不得挡住发布门禁。
2. 桌面端走「类似 SaaS 的独立发展路线」:桌面工作台 = Next.js 独立 web 客户端(Lucent 的薄客户端),
   **不复刻手机端五大 Tab**;订阅/计费是远期商业化能力,不构成路线前提(交付形态上的 SaaS 化现在就能做,付费不是前提)。
3. 将 Node 生态仓库(Lucent、Luminous-website、Lumos-docs)合并为单一 pnpm workspace monorepo,
   统一工具链与 CI;Flutter 的 Luminous **不进入**该 monorepo。
4. monorepo 合并的真实动机:桌面工作台客户端 + 营销站 + 文档站与后端同仓同 CI、可跨仓原子提交;
   **不是收编死代码**。

## 二、调研结论与决策依据(2026-08-15)

### 判据

用户打开电脑上的健康类应用只有一个目的:**看清手机上看不清的东西**。因此桌面工作台的核心能力是
复杂数据表与筛选、趋势图表、对比与导出——这些能力的技术承载决定技术选型。

### 生态对比(核心判据,一票决定)

| 能力                     | Web(Next.js)                                                                 | Flutter Desktop/Web                                                                     |
| ------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 复杂数据表/筛选/虚拟滚动 | TanStack Table / AG Grid / MUI X,企业级筛选、分组、列管理、CSV 导出,开箱即用 | `DataTable` 无内置虚拟化,千行级即卡;PlutoGrid 社区件万级吃力;强的需 Syncfusion 商业授权 |
| 图表                     | ECharts(降采样/交互开箱即用)                                                 | fl_chart 万点级需自写采样                                                               |

数据密集工作台在浏览器是被反复验证的形态(Grafana / Airtable / Linear / Notion 均为 web)。

### WebView 性能澄清(消除顾虑)

- WebView2 = Chromium,与 Chrome/Edge 同引擎;渲染层底层同为 Skia(与 Flutter 同源)。
  「Flutter 自绘 > WebView」的差距远小于直觉,数据应用的瓶颈在**数据层工程**(虚拟化/增量更新/降采样),
  而这一层 web 生态碾压。
- WebView 真正的短板(冷启动、内存基线)只出现在**安装版加壳(Tauri)**阶段;
  第一版做纯 web 应用时连 WebView 都不存在——用户用自己的 Chrome/Edge 打开。

### 升级路径不对称(决定性)

- **Next.js → Next.js+Tauri 是「加壳」**:同一套 UI 套进原生壳,UI 零重写,Tauri 只补浏览器给不了的
  (本地目录导出、托盘、通知、自动更新),按触发条件引入。
- **Flutter 桌面 → web 是重写**:工作台长在 Flutter 里的每一天都在累积重写成本。

### Tauri 加壳触发条件(未满足前不加壳)

1. 用户明确需要「导出到本地任意目录 / 离线打开历史数据」;
2. 出现托盘、系统通知、自动更新的刚需场景。

### Flutter 的保留与冻结

- Flutter 只做手机 App(Android/iOS)与移动 web(鸿蒙过渡),Desktop 与 Web(PC)目标冻结,
  代码不删(`git tag desktop-final-frozen` / `web-pc-final-frozen`),不再维护。
- 唯一能让 Flutter 桌面翻盘的反例:「桌面端 = 手机数据离线镜像」成为产品核心——当前定位是「看清云端数据」,不成立。

## 三、SaaS 模块规划(重排后的第一版范围)

- [ ] `auth` 扩展:**web 微信扫码登录 OAuth**(第一优先,工作台前置依赖)
- [ ] 工作台聚合 API(如 `GET /me/dashboard`):用户聚合数据(记录数、依从率、活跃事件等),支撑工作台首页
- [ ] `subscription` 模块:套餐定义、订阅状态查询、额度/权益边界——**延后到商业化落地时**,不做不阻塞
- [ ] `billing` 模块:支付渠道接入——**延后**;渠道与合规未明确前只做契约与抽象,不接真实支付
- [ ] 角色与多租户:**不做**(照护者/家庭场景由现有可撤销分享覆盖)
- [ ] `admin`/管理面:复用现有 `audit-log`、`product-events` 与 `testing-support` 模块,不重复建设
- [ ] 数据出口:复用 `data-export`、`data-retention` 模块作为 SaaS 客户导出/合规基础
- [ ] 合规边界:健康数据 SaaS 涉及《个人信息保护法》、数据安全与可能的出境审查,上线前需合规评估(见待定问题)

## 四、Node Monorepo 合并方案

- [ ] 以 **Lucent 本体**作为 monorepo 根(`apps/api` + `apps/saas` + `apps/website` + `apps/docs`),
      原「新建伞仓 Lumos-platform」方案废弃(2026-08-14 讨论结论,见 Luminous 侧临时草稿)
- [ ] `Luminous-website`(Next.js 营销站,README 已确认 Next.js;根 AGENTS.md 的「Nuxt」描述需更正)与 `Lumos-docs` 收编为子包
- [ ] 统一为单一 `pnpm-workspace.yaml` + 共享 eslint/commitlint/tsconfig
- [ ] CI 工作流合并;Lucent 的 pre-commit doc 门禁(docs:check)与新 workspace 兼容
- [ ] 根 `AGENTS.md`(workspace)仓库边界一节更新
- [ ] 跨仓原子提交能力:后端合同 + 文档 + 宣传站 + 工作台一次改完
- [ ] git 历史保留方式(迁入 vs subtree)执行前再定,不阻塞方向

## 五、执行顺序

1. [ ] 0.1.0 移动端发布验证(当前门禁,零重构,只修阻断项)
2. [ ] 文档同步与冻结点标记(Phase 0:git tag 冻结 Flutter Desktop / Web PC)
3. [ ] Lucent monorepo 骨架:收编 website/docs + 新建 `apps/saas`(Phase 0,预计 1 天量级)
4. [ ] web 微信扫码登录 OAuth(auth 模块扩展,工作台前置依赖)
5. [ ] 工作台 MVP(Phase 1:单页 Dashboard 验证——指标卡 + 时间线 + 图表)
6. [ ] 工作台完善(Phase 2:就诊摘要管理、健康事件复盘、CSV/PDF 导出)
7. [ ] 按触发条件评估 PWA / Tauri 加壳(Phase 3)
8. [ ] subscription / billing(商业化落地时,非本路线前置)

## 六、待定问题

- 支付渠道:境内渠道(微信/支付宝商户)资质与合规要求,未明确前 billing 模块只做契约与抽象
- 订阅商业模式:免费额度 + 订阅制还是其他;手机端与 SaaS 端权益如何划分(商业落地时再定)
- 桌面工作台 MVP 最小功能集与页面结构(Phase 1 启动前定,配套客户端计划)
- 健康数据合规评估的启动时机与预算(上线前必须)
- git 历史迁入方式(见第四节)
