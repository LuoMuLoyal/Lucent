import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsString, Matches } from 'class-validator';

/**
 * 本地通知投递回执请求体。
 *
 * 客户端在本地通知实际展示后上报（幂等）：服务端按用户 profile 时区将
 * scheduledDate + scheduledTime 换算为 UTC 并截断到分钟，作为投递行的
 * `scheduledFor`，写入 channel='local' 的审计行。
 */
export class ReminderDeliveryReceiptDto {
  @ApiProperty({ description: 'Linked medicine reminder id.' })
  @IsString()
  @IsNotEmpty()
  reminderId!: string;

  @ApiProperty({
    description: 'Local scheduled date in YYYY-MM-DD format.',
    example: '2026-07-20',
  })
  @IsDateString()
  scheduledDate!: string;

  @ApiProperty({
    description: 'Local scheduled time in HH:mm format (24h).',
    example: '08:30',
  })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'scheduledTime must match HH:mm (24h)',
  })
  scheduledTime!: string;
}
