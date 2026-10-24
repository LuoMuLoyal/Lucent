/**
 * 一次请求的可记录元数据 —— 应用层的入参形状。
 *
 * 刻意不叫 `AuthRequestContext` 之外的框架名字：`adapters/http` 从 Fastify 请求
 * 里抽这两个字段，`infrastructure` 把它们写进会话行的 `ip_address` /
 * `user_agent` 列。应用层只把它当作「会话归属的一次来源」透传。
 *
 * 两个字段都是可选的：内部任务（例如测试夹具）建立会话时没有 IP。
 */
export interface RequestOrigin {
  ipAddress?: string;
  userAgent?: string;
}
