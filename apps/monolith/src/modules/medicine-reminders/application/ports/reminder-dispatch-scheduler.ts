/**
 * 提醒派发调度端口（ADR-0025）。
 *
 * 应用层只知道「每分钟把到期的提醒投递出去」，不知道这个节奏由一个 BullMQ
 * 可重复任务、进程内定时器，还是将来独立的调度服务驱动。调度形态是队列
 * 适配器的事。
 *
 * ## 为什么这层抽象对微服务化有意义
 *
 * 重复任务的注册是有状态的：`upsertJobScheduler` 在 Redis 里维护任务定义，
 * 多实例部署时天然只有一个逻辑节奏。换成消息队列或独立调度进程时，这个
 * 语义必须由新实现重新保证——把它挡在端口后面，业务侧一行都不用改。
 */

/** 注入令牌。接口在运行时不存在，只有令牌能让 Nest 解析到实现。 */
export const REMINDER_DISPATCH_SCHEDULER = Symbol('ReminderDispatchScheduler');

/** 提醒派发调度端口。 */
export interface ReminderDispatchSchedulerPort {
  /**
   * 注册（或更新）周期性的派发任务。
   *
   * 实现**必须幂等**：重复调用只更新已存在的任务定义，不得产生第二条
   * 并行节奏。注册失败不应让应用启动失败——下一个周期或下次重启会重试。
   */
  registerSchedule(): Promise<void>;
}
