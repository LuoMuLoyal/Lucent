import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import type { LocalCapabilityState } from '../constants/delivery.constants';

/**
 * 客户端本地调度能力上报请求体。
 *
 * - `active`：本地通知可达，JPush 不应发送；
 * - `unavailable`：本地通知不可达，允许 JPush 作为后台回退；
 * - `disabled`：用户明确关闭本地通知，且不希望收到 JPush 打扰。
 */
export class LocalCapabilityStateDto {
  @ApiProperty({
    description: 'Local scheduling capability state.',
    enum: ['active', 'unavailable', 'disabled'],
    example: 'active',
  })
  @IsIn(['active', 'unavailable', 'disabled'])
  state!: LocalCapabilityState;
}
