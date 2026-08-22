import { ApiPropertyOptional } from '@nestjs/swagger';

export class AppInfoDataDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  minClientVersion!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  latestVersion!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  downloadUrl!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  supportEmail!: string | null;
}

export class AppInfoResponseDto extends AppInfoDataDto {}
