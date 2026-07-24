import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth';
import type { UserPayload } from '../auth';
import { successEnvelope } from '../../common';
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
  createUpload(
    @CurrentUser() user: UserPayload,
    @Body() dto: CreateFileUploadDto,
  ) {
    return successEnvelope(
      this.filesService.createPresignedUpload(user.sub, dto),
    );
  }
}
