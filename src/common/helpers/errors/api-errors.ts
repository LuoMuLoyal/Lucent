import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

/** Throws a {@link 'RESOURCE_NOT_FOUND'} HTTP exception. */
export function notFound(message: string): never {
  throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message });
}

/** Throws a {@link 'VALIDATION_FAILED'} HTTP exception. */
export function badRequest(message: string): never {
  throw new BadRequestException({ code: 'VALIDATION_FAILED', message });
}

/** Throws a {@link 'AUTH_REQUIRED'} HTTP exception. */
export function unauthorized(message: string): never {
  throw new UnauthorizedException({ code: 'AUTH_REQUIRED', message });
}

/** Throws a {@link 'FORBIDDEN'} HTTP exception. */
export function forbidden(message: string): never {
  throw new ForbiddenException({ code: 'FORBIDDEN', message });
}

/** Throws a {@link 'RESOURCE_CONFLICT'} HTTP exception. */
export function conflict(message: string): never {
  throw new ConflictException({ code: 'RESOURCE_CONFLICT', message });
}
