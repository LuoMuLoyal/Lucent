import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { SUPPORT_RESOURCE_SCOPES } from './response.dto';

export class SupportResourcesQueryDto {
  @ApiPropertyOptional({
    description: "Filter by scope: 'help', 'about'. Default: all.",
    enum: SUPPORT_RESOURCE_SCOPES,
  })
  @IsOptional()
  @IsString()
  @IsIn([...SUPPORT_RESOURCE_SCOPES])
  scope?: string;
}
