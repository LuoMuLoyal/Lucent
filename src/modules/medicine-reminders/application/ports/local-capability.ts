import { z } from 'zod';

/**
 * 客户端本地调度能力上报请求体。
 *
 * - `active`：本地通知可达，JPush 不应发送；
 * - `unavailable`：本地通知不可达，允许 JPush 作为后台回退；
 * - `disabled`：用户明确关闭本地通知，且不希望收到 JPush 打扰。
 */
export const localCapabilityStateSchema = z
  .object({
    state: z
      .enum(['active', 'unavailable', 'disabled'])
      .describe('Local scheduling capability state.'),
  })
  .strict();

/** Strongly typed body of `PUT /reminder-deliveries/local-capability`. */
export type LocalCapabilityStateDto = z.infer<
  typeof localCapabilityStateSchema
>;
