import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { LEGAL_LANGS } from '../constants';

/** Query parameters for the legal document detail endpoint. */
export class LegalDocumentQueryDto {
  @ApiPropertyOptional({
    description: "Content language: 'zh' or 'en'. Default: 'zh'.",
    enum: [...LEGAL_LANGS],
  })
  @IsOptional()
  @IsString()
  @IsIn([...LEGAL_LANGS])
  lang?: string;
}
