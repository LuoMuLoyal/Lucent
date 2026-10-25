/**
 * 健康事件归属校验端口（跨上下文读，ADR-0009）。
 *
 * 一条日报记录可以挂到某个健康事件下，但健康事件不归本上下文所有。写路径只做
 * **归属与活跃性校验**，不读事件内容——事件数据留在 health-events 上下文。
 */
export abstract class HealthEventOwnership {
  /**
   * 确认事件存在、属于该用户且处于活跃状态。
   *
   * 失败语义：不存在 → `RESOURCE_NOT_FOUND`；属于别人 → `FORBIDDEN`；
   * 非活跃 → `VALIDATION_FAILED`。实现直接抛 `DomainFailureException`（上游
   * façade 的既有契约），应用层在边界处折回 Result。
   */
  abstract ensureActive(userId: string, eventId: string): Promise<void>;
}
