import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth';
import type { UserPayload } from '../auth';
import { ProblemDetailsDto } from '../../common';
import { unwrapResult } from '../../common/result';
import { FilesService } from './services/files.service';
import { CreateFileUploadDto } from './dto/create-file-upload.dto';

@ApiTags('Files')
@ApiBearerAuth('access-token')
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create a presigned upload URL for a file' })
  @ApiResponse({
    status: 200,
    description: 'Presigned upload URL for the requested file.',
  })
  @ApiResponse({
    status: 400,
    type: ProblemDetailsDto,
    description: 'Unsupported content type or file size above the limit.',
  })
  @ApiResponse({
    status: 503,
    type: ProblemDetailsDto,
    description: 'Object storage backend is not reachable.',
  })
  @ApiResponse({
    status: 504,
    type: ProblemDetailsDto,
    description: 'Object storage backend timed out.',
  })
  async createUpload(
    @CurrentUser() user: UserPayload,
    @Body() dto: CreateFileUploadDto,
  ) {
    return await unwrapResult(
      this.filesService.createPresignedUpload(user.sub, dto),
    );
  }
}
