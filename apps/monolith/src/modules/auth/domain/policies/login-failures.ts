/**
 * 登录失败桶 —— 限流与「何时开始要求人机验证」的**纯状态机（策略）**。
 *
 * ## 为什么不硬锁账号
 *
 * 早期版本在失败 {@link LOGIN_FAILURE_MAX} 次后锁号 60 分钟，且**对任何人**都
 * 返回「账号已锁」。这给攻击者提供了免费武器：只要知道受害者邮箱，连发十几次
 * 错误密码就能把对方锁在门外，成本几乎为零，而受害者自己完全无辜。
 *
 * 现在改为**渐进延迟**：失败次数越多，下一次尝试的响应越慢，但**不返回任何
 * 「账号已锁」信号**，正确密码在延迟结束后仍可登录。这样：
 *
 * - 暴力猜测依然被拖慢（每次尝试都要等待，成本随失败次数指数上升）；
 * - 陌生人无法用失败次数把真实用户挡在门外；
 * - 人机验证仍是廉价闸门，在第 {@link CAPTCHA_THRESHOLD} 次失败后要求。
 *
 * ## 人机验证与限流读**同一个桶**
 *
 * `CAPTCHA_THRESHOLD`(3) 低于渐进延迟的起始阈值：验证是廉价闸门，
 * 延迟是持续成本，正常用户很少连错三次密码。两者读同一个桶是刻意的——
 * 各算一套会出现「限流说该慢、验证说没到阈值」这种互相矛盾的组合。
 *
 * ## 领域纯度
 *
 * 不 import 任何东西。时间以毫秒数传入（不调 `Date.now()`），因此窗口边界
 * 可以精确单测而不需要假时钟。
 */

/** 一分钟的毫秒数。窗口与延迟时长都由它派生。 */
const MS_PER_MINUTE = 60 * 1000;

/** 失败计数窗口。窗口内累计，过期即清零。 */
export const LOGIN_FAILURE_WINDOW_MS = 15 * MS_PER_MINUTE;

/**
 * 失败计数下限：达到此数后开始施加渐进延迟（并继续累加）。
 *
 * 取代了原来的「锁号阈值」语义——这里不再是「到此即锁」，而是「到此开始变慢」。
 */
export const LOGIN_FAILURE_MAX = 10;

/** @deprecated 硬锁已移除；保留常量仅为兼容引用，恒为 0。 */
export const LOGIN_FAILURE_LOCKOUT_MS = 0;

/**
 * 失败多少次后开始要求人机验证。
 *
 * 刻意低于渐进延迟的起始阈值：验证是廉价闸门、延迟是持续成本，
 * 而正常用户很少连错三次密码。
 */
export const CAPTCHA_THRESHOLD = 3;

/** 渐进延迟的起点（秒）：恰好在阈值处生效，此后每多一次失败翻倍。 */
const BACKOFF_BASE_SECONDS = 1;

/** 渐进延迟上限（秒）：避免长尾把正常用户拖到无法忍受。 */
const BACKOFF_MAX_SECONDS = 30;

/** 失败桶的持久化形状（进缓存，扁平可序列化）。 */
export interface FailureBucket {
  count: number;
  resetAt: number;
  /**
   * 仍被写入以兼容旧数据形状，但**不再用于拒绝登录**。
   * 保留字段可以让滚动升级期间旧版本写入的桶不触发解析失败。
   */
  lockedUntil?: number;
}

/**
 * 桶对一次新尝试的判定结论。
 *
 * `delayMs > 0` 表示「先等这么久再继续验证」，而不是「拒绝」。
 * 调用方**必须**把这段等待当成正常流程的一部分，且**不得**把 `delayMs`
 * 与「账号是否存在 / 是否被锁」关联起来对外暴露。
 */
export type ThrottleVerdict = {
  kind: 'allowed';
  /** 进入凭据校验前的等待毫秒数；0 表示无延迟。 */
  delayMs: number;
  /** 是否已越过人机验证阈值（与 {@link isCaptchaRequired} 一致）。 */
  captchaRequired: boolean;
};

/**
 * 该桶在 `at` 时刻是否仍然有效（窗口未过期且形状可信）。
 *
 * 无效的桶等同于不存在：调用方应当丢弃它，而不是把它当成「0 次失败但窗口
 * 还在」——后者会让窗口被无限续期。
 */
export function isBucketLive(
  bucket: FailureBucket | undefined,
  at: number,
): bucket is FailureBucket {
  if (bucket === undefined) return false;
  if (typeof bucket.count !== 'number') return false;
  if (typeof bucket.resetAt !== 'number') return false;
  return bucket.resetAt > at;
}

/**
 * 计算第 N 次失败后应施加的延迟（毫秒）。
 *
 * 低于阈值不延迟；越过阈值后每多一次失败翻倍，上限 {@link BACKOFF_MAX_SECONDS}。
 * 用 2 的幂而不是线性增长，是为了让持续猜测的代价快速变得不可承受，
 * 同时正常用户（偶尔连错两三次）完全不受影响。
 */
export function backoffDelayMs(count: number): number {
  const over = count - CAPTCHA_THRESHOLD;
  if (over <= 0) {
    return 0;
  }
  const seconds = Math.min(
    BACKOFF_BASE_SECONDS * 2 ** (over - 1),
    BACKOFF_MAX_SECONDS,
  );
  return seconds * 1000;
}

/**
 * 评估当前桶对一次新尝试的结论。
 *
 * **永不返回「拒绝」**：所有情况都返回 `allowed`，只通过 `delayMs` 表达代价。
 * 这是防「锁死他人账号」的核心——对陌生人而言，失败次数只会让自己变慢，
 * 不会把真实用户挡在门外。
 */
export function evaluateBucket(
  bucket: FailureBucket | undefined,
  at: number,
): ThrottleVerdict {
  const live = isBucketLive(bucket, at);
  return {
    kind: 'allowed',
    delayMs: live ? backoffDelayMs(bucket.count) : 0,
    captchaRequired: live && bucket.count >= CAPTCHA_THRESHOLD,
  };
}

/**
 * 该桶是否已达到「要求人机验证」的阈值。
 *
 * 与限流读**同一个桶**（见文件头注释）。窗口过期即不再要求——用户隔了很久
 * 再来，不该为十几分钟前的失败付出验证成本。
 */
export function isCaptchaRequired(
  bucket: FailureBucket | undefined,
  at: number,
): boolean {
  if (!isBucketLive(bucket, at)) return false;
  return bucket.count >= CAPTCHA_THRESHOLD;
}

/**
 * 记一次失败，返回应当写回的桶。
 *
 * ## 三种起点
 *
 * 1. **没有桶 / 窗口过期** → 开一个新桶（计数 1）。
 * 2. **窗口内** → 计数 +1，窗口保持。
 *
 * 不再设置 `lockedUntil`：硬锁已移除。字段保留只是为了让滚动升级期间
 * 旧版本写入的桶仍能被解析。
 *
 * ## 为什么用新对象而不是就地改
 *
 * 返回新对象让调用方无法「忘记写回」——旧引用没变，只有写回缓存才生效。
 */
export function recordFailure(
  bucket: FailureBucket | undefined,
  at: number,
): FailureBucket {
  if (!isBucketLive(bucket, at)) {
    return { count: 1, resetAt: at + LOGIN_FAILURE_WINDOW_MS };
  }

  return {
    count: bucket.count + 1,
    resetAt: bucket.resetAt,
  };
}

/**
 * 桶应当写入缓存时的 TTL（毫秒）。
 *
 * 取「窗口剩余」与「旧锁号剩余」的较大值：硬锁已移除，但滚动升级期间
 * 旧桶可能还带 `lockedUntil`，让它自然过期而不是提前清掉。
 *
 * 下限 1ms：`cache.set` 传 0 或负数时各后端行为不一致（有的当立即过期，
 * 有的当永不过期）。给一个极小正值，语义是「马上过期」。
 */
export function bucketTtlMs(bucket: FailureBucket, at: number): number {
  const untilReset = bucket.resetAt - at;
  const untilUnlock =
    bucket.lockedUntil === undefined ? untilReset : bucket.lockedUntil - at;
  return Math.max(1, untilReset, untilUnlock);
}
