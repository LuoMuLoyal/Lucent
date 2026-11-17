import { Controller, Get, SerializeOptions } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../../auth/index.js';
import type { UserPayload } from '../../../auth/index.js';
import { MedicationOverviewService } from '../../application/use_cases/medication-overview.js';
import { medicationOverviewResponseSchema } from './dto/medication-overview.js';

/**
 * 用药全景（「我实际在吃什么组合」）。
 *
 * ## 为什么不并进 `risk-check`
 *
 * `risk-check` 是**判定**（有没有冲突、什么等级）；这里是**描述**
 * （同一成分几份、药理上在哪交汇）。把描述塞进判定端点会让响应里同时出现
 * 「风险等级」与「结构化事实」，客户端分不清哪个是结论。
 *
 * ## 为什么需要登录
 *
 * 与其余 `/medicines/*` 不同：那些是公共药品知识，这里是**用户自己的用药集合**。
 * 必须 `@CurrentUser()` 且只能看自己的——`userId` 从 token 取，不接受参数传入。
 */
@ApiTags('Medicines')
@ApiBearerAuth('access-token')
@Controller('medicines')
export class MedicationOverviewController {
  constructor(private readonly overviewService: MedicationOverviewService) {}

  @Get('medication-overview')
  @ApiOperation({
    operationId: 'getMedicationOverview',
    summary: "Describe the caller's current medication combination",
  })
  @ApiResponse({
    status: 200,
    description:
      'Duplicate ingredients and source grouping for the current medicines. Empty aggregates when the user has no medicines — that is an answer, not an error.',
  })
  @ApiResponse({
    status: 401,
    description: 'Access token invalid or expired',
  })
  @SerializeOptions({ schema: medicationOverviewResponseSchema })
  async getOverview(@CurrentUser() user: UserPayload) {
    return this.overviewService.build(user.sub);
  }
}
