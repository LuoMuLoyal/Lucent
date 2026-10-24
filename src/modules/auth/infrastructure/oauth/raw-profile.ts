import { toInputJsonValue } from '../../../../common/index.js';

/**
 * 原始响应 → 端口要求的 `Record<string, unknown>`。
 *
 * ## 为什么需要这一跳
 *
 * `common` 的 `toInputJsonValue` 返回 `Prisma.InputJsonValue`——那是**写入
 * Prisma 的**类型（可能是 string/number/array，不只是对象）。端口契约要的是
 * 「一个可 JSON 序列化的对象子集」，不带任何 ORM 类型。
 *
 * 直接把 `InputJsonValue` 赋给 `Record<string, unknown>` 会失败（联合类型里有
 * 非对象成员），所以这里收口成一次转换。
 *
 * ## 为什么不是简单的 `as`
 *
 * 调用点传的都是对象字面量（`{ sub, email, name }`），运行时一定是对象。
 * 但断言之前先过 `toInputJsonValue` 做一次清洗（去掉 `undefined`、确保可
 * 序列化），保留原有的数据卫生保证——那个保证原先就存在，只是类型收窄到了
 * `Record<string, unknown>`。
 *
 * ## 谁决定落库
 *
 * 结果随 `OAuthProviderProfile.rawProfile` 交给
 * `infrastructure/persistence`，由那里决定写不写、写成什么形状。
 * 本函数不碰数据库。
 */
export function toRawProfile(value: object): Record<string, unknown> {
  return toInputJsonValue(value) as Record<string, unknown>;
}
