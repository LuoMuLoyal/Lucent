import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

export class AppInfoResponseDto {
  @ApiProperty({ description: 'Result code.', example: 0 })
  code!: number;

  @ApiProperty({ description: 'Message.', example: '' })
  message!: string;

  @ApiProperty({ type: () => AppInfoDataDto })
  data!: AppInfoDataDto;
}
