import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';

import type { UserPayload } from '../services/auth.service';

/**
 * 参数装饰器：从 request.user 中提取当前登录用户信息。
 *
 * 使用方式：
 *  @Get('account')
 *  @UseGuards(JwtAuthGuard)
 *  getAccount(@CurrentUser() user: UserPayload) {
 *    return user;
 *  }
 *
 *  // 只取某个字段：
 *  @Get('account/id')
 *  @UseGuards(JwtAuthGuard)
 *  getMyId(@CurrentUser('sub') userId: string) {
 *    return userId;
 *  }
 */
export const CurrentUser = createParamDecorator(
  (data: keyof UserPayload | undefined, ctx: ExecutionContext) => {
    const request: { user?: UserPayload } = ctx.switchToHttp().getRequest();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
