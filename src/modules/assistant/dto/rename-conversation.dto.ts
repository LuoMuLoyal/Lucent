import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RenameConversationDto {
  @ApiProperty({
    description:
      'New conversation title (1-48 chars). Empty or whitespace-only titles are rejected; clients keep empty names local-only.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  title!: string;
}
