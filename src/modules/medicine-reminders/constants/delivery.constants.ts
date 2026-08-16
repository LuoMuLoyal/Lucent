/**
 * 提醒投递三通道（in_app / local / push）相关的通道名、状态与本地调度
 * 能力缓存的共享常量与类型（见 ADR-0013）。
 */

/** 站内通知通道（通知中心记录，始终写入）。 */
export const DELIVERY_CHANNEL_IN_APP = 'in_app';

/** 本地通知通道（客户端展示后幂等回写）。 */
export const DELIVERY_CHANNEL_LOCAL = 'local';

/** 推送通道（仅本地不可达/失败时的后台回退）。 */
export const DELIVERY_CHANNEL_PUSH = 'push';

/** 投递成功状态。 */
export const DELIVERY_STATUS_DELIVERED = 'delivered';

/** 投递失败状态。 */
export const DELIVERY_STATUS_FAILED = 'failed';

/** 本地调度能力缓存 key 前缀：`reminder:local-capability:{userId}`。 */
export const LOCAL_CAPABILITY_CACHE_KEY_PREFIX = 'reminder:local-capability';

/** 本地调度能力缓存 TTL：14 天（毫秒）。 */
export const LOCAL_CAPABILITY_CACHE_TTL_MS = 1_209_600_000;

/**
 * 客户端上报的本地调度能力状态。
 *
 * - `active`：本地通知可达，JPush 不应发送；
 * - `unavailable`：本地通知不可达，允许 JPush 作为后台回退；
 * - `disabled`：用户明确关闭本地通知，且不希望收到 JPush 打扰。
 */
export type LocalCapabilityState = 'active' | 'unavailable' | 'disabled';

/**
 * 解析后的本地调度能力：缓存缺失视为 `unconfirmed`（首次下发前未知，
 * 允许 JPush 回退，保证提醒不丢）。
 */
export type ResolvedLocalCapability = 'unconfirmed' | LocalCapabilityState;

/** 构建用户级本地调度能力缓存 key。 */
export function localCapabilityCacheKey(userId: string): string {
  return `${LOCAL_CAPABILITY_CACHE_KEY_PREFIX}:${userId}`;
}
