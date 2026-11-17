import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Mark a route as public (skip JWT authentication).
 *
 * Usage:
 *   @Public()
 *   @Get('shared/:token')
 *   async getShared(...) { ... }
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
