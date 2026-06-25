import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ResultCode } from '../api-envelope';

export function notFound(message: string): never {
  throw new NotFoundException({ code: ResultCode.NOT_FOUND, message });
}

export function badRequest(message: string): never {
  throw new BadRequestException({ code: ResultCode.BAD_REQUEST, message });
}

export function unauthorized(message: string): never {
  throw new UnauthorizedException({ code: ResultCode.UNAUTHORIZED, message });
}

export function forbidden(message: string): never {
  throw new ForbiddenException({ code: ResultCode.FORBIDDEN, message });
}

export function conflict(message: string): never {
  throw new ConflictException({ code: ResultCode.CONFLICT, message });
}
