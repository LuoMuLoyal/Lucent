import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { UserPayload } from '../auth/auth.service';
import { successEnvelope } from '../../common/api-envelope';
import { FilesService } from './services/files.service';
import { CreateFileUploadDto } from './dto/create-file-upload.dto';

@ApiTags('Files')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
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
