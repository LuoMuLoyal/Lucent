import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ResultCode } from '../api-envelope';

/** Throws a {@link ResultCode.NOT_FOUND} HTTP exception. */
export function notFound(message: string): never {
  throw new NotFoundException({ code: ResultCode.NOT_FOUND, message });
}

/** Throws a {@link ResultCode.BAD_REQUEST} HTTP exception. */
export function badRequest(message: string): never {
  throw new BadRequestException({ code: ResultCode.BAD_REQUEST, message });
}

/** Throws a {@link ResultCode.UNAUTHORIZED} HTTP exception. */
export function unauthorized(message: string): never {
  throw new UnauthorizedException({ code: ResultCode.UNAUTHORIZED, message });
}

/** Throws a {@link ResultCode.FORBIDDEN} HTTP exception. */
export function forbidden(message: string): never {
  throw new ForbiddenException({ code: ResultCode.FORBIDDEN, message });
}

/** Throws a {@link ResultCode.CONFLICT} HTTP exception. */
export function conflict(message: string): never {
  throw new ConflictException({ code: ResultCode.CONFLICT, message });
}
