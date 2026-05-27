import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * JWT Access Token Guard
 *
 * 使用方式：
 *  @UseGuards(JwtAuthGuard)
 *  @Controller('protected')
 *  class ProtectedController {}
 *
 * 验证通过后，request.user 将包含 { sub, email }。
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
