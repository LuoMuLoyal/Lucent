---
status: active
owner: backend
---

# environment

环境快照参考数据（花粉/紫外线/空气质量/温湿度），供 Today/Mine 等上下文
表面消费。当前 Luminous 端尚未接入，前端接线推迟到明确的产品需求就绪。

## Endpoints（事实源 = openapi.json）

- `GET /api/v1/environment/snapshot?lat=&lon=` — **公开只读，无需鉴权**。
  `lat`（-90..90）/`lon`（-180..180）均可选且只是近似值；缺任一坐标返回
  `default` 区域数据。Lucent 不存储、不追踪用户位置。
- 响应是 `EnvironmentSnapshotDto` 资源本身（不包成功信封）：`pollen/uv/
airQuality/temperature/humidity/updatedAt/dataSource/regionHint`。
  `dataSource: 'static'` 时客户端必须标注为近似/参考数据。

## 静态参考实现（`config/reference.ts`）

数据是随服务捆绑的静态常量表，无数据库迁移、无外部 API key：

- 区域判定：中国温带带（lat 18–54 且 lon 73–135）→ 按 |lat| 分
  `tropical` / `high_latitude` / 南/北中纬带；坐标不全回落 `default`。
- 每个区域一份固定 profile（花粉等级/主要类型、UV 指数与等级、AQI 与
  等级/首要污染物、温度/体感、湿度）；`updatedAt` 为常量时间戳。
- 契约中的「按月/按季平均」在当前实现里简化为每区域单一静态快照，
  无季节/月份维度。

## 边界与非目标

- Lucent 只提供数据，Luminous 负责展示，不得自行计算或另找数据源。
- 不做实时天气 API 集成（无第三方凭据）、不做位置追踪、不做医疗建议、
  不做环境变化推送告警、不提供历史环境数据 API。
- 契约中预留的可选 `GET /environment/advice` 端点尚未实现。
- 后续可在外部数据源接入时保持同一契约（`dataSource` 切换 `'live'`）。

## Dependencies

- 引用：仅 Prisma 无关的纯计算（config 常量 + DTO），无外部依赖。
- 被引用：`app.module` 注册；无其他模块消费。

## Tests

`environment.controller.spec.ts`、`services/snapshot.service.spec.ts`、
`config/reference.spec.ts`。
