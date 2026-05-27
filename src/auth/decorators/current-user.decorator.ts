import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { UserPayload } from '../auth.service';

/**
 * 参数装饰器：从 request.user 中提取当前登录用户信息。
 *
 * 使用方式：
 *  @Get('me')
 *  @UseGuards(JwtAuthGuard)
 *  getMe(@CurrentUser() user: UserPayload) {
 *    return user;
 *  }
 *
 *  // 只取某个字段：
 *  @Get('me/id')
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
