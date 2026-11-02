/**
 * `account` 应用层命令/结果形状 —— 不复用 HTTP 层的 zod 输出类型。
 *
 * `application/` 不得依赖 `adapters/`（`arch:check` 会拦）。投递层把校验过的
 * 请求体映射成这些形状。
 */

/** 账户档案（`GET /account` 的响应，也是改绑/改档后回读的形状）。 */
export interface AccountProfile {
  id: string;
  email: string | null;
  nickname: string | null;
  avatar: string | null;
  emailVerifiedAt: string | null;
  hasPassword: boolean;
  lastLoginAt: string | null;
  linkedIdentities: LinkedIdentityView[];
  createdAt: string;
  updatedAt: string;
}

/** 一条已链接的第三方身份（对外形状，时间已序列化）。 */
export interface LinkedIdentityView {
  id: string;
  provider: string;
  email: string | null;
  emailVerifiedAt: string | null;
  linkedAt: string;
}

/** 改昵称/头像。空串表示「清空」（映射成 `null`）。 */
export interface UpdateAccountCommand {
  nickname?: string | undefined;
  avatar?: string | undefined;
}

/** 解绑身份（要求密码重验）。 */
export interface UnlinkIdentityCommand {
  password: string;
}
