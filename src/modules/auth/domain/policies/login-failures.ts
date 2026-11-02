/**
 * 登录失败桶 —— 限流与「何时开始要求人机验证」的**纯状态机（策略）**。
 *
 * ## 为什么这是领域知识
 *
 * 一个失败桶的转移规则全部是策略判断，不是存储细节：
 *
 * - 什么时候计数清零（窗口过期）；
 * - 第几次失败开始锁号（{@link LOGIN_FAILURE_MAX}）；
 * - 锁多久（{@link LOGIN_FAILURE_LOCKOUT_MS}）；
 * - 第几次失败开始要求人机验证（{@link CAPTCHA_THRESHOLD}）。
 *
 * 这些以前散在 service 的读写流程里，只能靠 mock 缓存间接覆盖。搬到这里之后
 * 每个边界都能纯单测。
 *
 * ## 人机验证与限流读**同一个桶**
 *
 * `CAPTCHA_THRESHOLD`(3) 远低于 `LOGIN_FAILURE_MAX`(10)：验证是廉价闸门、
 * 锁号是最后手段，而正常用户很少连错三次密码。两者读同一个桶是刻意的——
 * 各算一套会出现「限流说锁了、验证说没到阈值」这种互相矛盾的组合。
 *
 * ## 领域纯度
 *
 * 不 import 任何东西。时间以毫秒数传入（不调 `Date.now()`），因此窗口边界
 * 可以精确单测而不需要假时钟。
 */

/** 一分钟的毫秒数。窗口与锁号时长都由它派生。 */
const MS_PER_MINUTE = 60 * 1000;

/** 失败计数窗口。窗口内累计，过期即清零。 */
export const LOGIN_FAILURE_WINDOW_MS = 15 * MS_PER_MINUTE;

/** 窗口内失败多少次后锁号。 */
export const LOGIN_FAILURE_MAX = 10;

/** 锁号时长。 */
export const LOGIN_FAILURE_LOCKOUT_MS = 60 * MS_PER_MINUTE;

/**
 * 失败多少次后开始要求人机验证。
 *
 * 刻意远低于 {@link LOGIN_FAILURE_MAX}：验证是廉价闸门、锁号是最后手段，
 * 而正常用户很少连错三次密码。
 */
export const CAPTCHA_THRESHOLD = 3;

/** 失败桶的持久化形状（进缓存，扁平可序列化）。 */
export interface FailureBucket {
  count: number;
  resetAt: number;
  /** 锁号截止时刻；存在即表示**曾经**锁过（不一定仍在锁号期）。 */
  lockedUntil?: number;
}

/** 桶对一次新尝试的判定结论。 */
export type ThrottleVerdict =
  | { kind: 'allowed' }
  | { kind: 'locked'; retryAfterSeconds: number; minutes: number };

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
 * 该桶在 `at` 时刻是否处于**锁号期**。
 *
 * 与 {@link isBucketLive} 分开：锁号可以晚于窗口结束（`bucketTtlMs` 取两者
 * 较大值），所以「桶还活着」不等于「窗口还开着」。
 */
export function isLockedOut(
  bucket: FailureBucket | undefined,
  at: number,
): bucket is FailureBucket & { lockedUntil: number } {
  return (
    bucket !== undefined &&
    bucket.lockedUntil !== undefined &&
    bucket.lockedUntil > at
  );
}

/**
 * 评估当前桶对一次新尝试的结论。
 *
 * **锁号优先**：处于锁号期的桶直接返回 `locked`，不关心计数与阈值。
 * 顺序反了会让「已锁号但计数看起来没到阈值」的桶放行。
 *
 * 注意这里**不**返回「要不要人机验证」——那是
 * {@link isCaptchaRequired}，因为它读的是同一个桶但判据不同（阈值 vs 锁号），
 * 合成一个联合类型会逼调用方在不需要的字段上做窄化。
 */
export function evaluateBucket(
  bucket: FailureBucket | undefined,
  at: number,
): ThrottleVerdict {
  if (isLockedOut(bucket, at)) {
    const lockedMs = bucket.lockedUntil - at;
    return {
      kind: 'locked',
      retryAfterSeconds: Math.ceil(lockedMs / 1000),
      minutes: Math.ceil(lockedMs / 60_000),
    };
  }
  return { kind: 'allowed' };
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
 * 1. **没有桶 / 窗口过期 / 已在锁号期** → 开一个新桶（计数 1）。
 *    已在锁号期时重开是刻意的：锁号期内继续尝试不该延长锁号，
 *    但也不该把计数累加到解锁后的新窗口里。
 * 2. **未到上限** → 计数 +1。
 * 3. **达到上限** → 计数 +1 并设置 `lockedUntil`。
 *
 * ## 为什么用新对象而不是就地改
 *
 * 返回新对象让调用方无法「忘记写回」——旧引用没变，只有写回缓存才生效。
 */
export function recordFailure(
  bucket: FailureBucket | undefined,
  at: number,
): FailureBucket {
  if (!isBucketLive(bucket, at) || isLockedOut(bucket, at)) {
    return { count: 1, resetAt: at + LOGIN_FAILURE_WINDOW_MS };
  }

  const nextCount = bucket.count + 1;
  return {
    count: nextCount,
    resetAt: bucket.resetAt,
    ...(nextCount >= LOGIN_FAILURE_MAX && {
      lockedUntil: at + LOGIN_FAILURE_LOCKOUT_MS,
    }),
  };
}

/**
 * 桶应当写入缓存时的 TTL（毫秒）。
 *
 * 取「窗口剩余」与「锁号剩余」的较大值——否则锁号会在窗口到期时随之消失，
 * 而锁号（1 小时）本来比窗口（15 分钟）长。
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
