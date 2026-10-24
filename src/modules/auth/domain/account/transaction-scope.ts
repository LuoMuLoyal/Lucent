/**
 * 不透明事务句柄 —— 领域与应用层**只透传**，不解释。
 *
 * ## 为什么不是 `Prisma.TransactionClient`
 *
 * `pnpm arch:check` 的 `ddd-application-no-direct-prisma` 禁止
 * `application/**` import `@prisma/client`；而 `domain/**` 更是只准 import
 * 同 `domain/` 树内的文件（`ddd-domain-purity`）。若端口签名里出现 Prisma
 * 类型，两层护栏都会直接拦下。
 *
 * ## 为什么是 `object` 而不是一个带标记字段的接口
 *
 * 最初的设计是 `interface TransactionScope { readonly __transactionScope?: never }`
 * ——**它不能编译**。TypeScript 的「弱类型检测」（weak type detection）规定：
 * 当目标类型的所有属性都是可选的，源类型必须至少有一个属性与之重叠，否则
 * 报 TS2559。`Prisma.TransactionClient` 没有 `__transactionScope`，于是
 * `hasPassword(userId, tx)` 这种既有调用点直接编译失败——而「调用点一行不改」
 * 正是这个设计的目的。
 *
 * 别名到 `object` 满足全部要求，而且**比标记接口更不透明**：
 *
 * - `Prisma.TransactionClient` 结构上满足 `object`（任何非原始值都是），
 *   所以既有调用点无需改动；
 * - `object` **没有任何可读成员**——想读字段必须先 cast，而 cast 是显眼的、
 *   需要写理由的动作。标记接口反而会诱导人去「扩展这个接口」。
 *
 * ## 不透明性是有意的
 *
 * 如果某天有人想在这里读字段，说明边界被破坏了：应该先问「为什么应用层需要
 * 知道事务实现」，而不是扩展这个类型。真正需要 Prisma 客户端的地方是
 * `infrastructure/persistence/`，那里在入口处做一次 cast 收敛。
 */
export type TransactionScope = object;
