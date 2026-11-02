/**
 * 图片存储端口（事件/查询侧只需要读侧那一条）。
 *
 * 为什么只抽**签名读地址**一条：写侧的 presigned PUT 是纯粹的传输层能力
 * （`ObjectStorageRuntime` 本身的形状就是入站适配器的形状），放进应用层没有收益；
 * 而分析管线需要「把对象键换成外部可读 URL」，这是应用层能理解的语义。
 *
 * 注意：本模块的 presigned 上传服务与存储运行时之间没有端口——它是 `adapters/http`
 * 直接调用基础设施（与其它模块的既有写法一致）。
 */
export abstract class AttachmentUrls {
  /** 生成外部可读的短时签名读地址。失败时抛错，由调用方映射成失败码。 */
  abstract signedGetUrl(objectKey: string): Promise<string>;
}
