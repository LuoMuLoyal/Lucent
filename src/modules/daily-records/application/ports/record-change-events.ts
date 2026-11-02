/**
 * "记录变了" 事件端口。
 *
 * `daily-record.changed` 是**缓存失效信号**，不是业务事实：发射失败只记日志，
 * 不影响写入（best-effort）。所以端口只暴露一个「发一条」的方法，失败语义由
 * 实现决定，应用层不处理返回值。
 *
 * 为什么要抽端口：应用层不该知道事件总线是进程内 `DomainEventPublisher` 还是
 * 后续的 outbox（ADR-0025 正在把这一层迁过去）。
 */
export interface RecordChangedEvent {
  userId: string;
  /** `YYYY-MM-DD`。 */
  date: string;
  kind?: string;
  recordId?: string;
}

export abstract class RecordChangeEvents {
  /** 发布一条变更事实；实现内部吞掉并记录失败（best-effort）。 */
  abstract publish(event: RecordChangedEvent): Promise<void>;
}
