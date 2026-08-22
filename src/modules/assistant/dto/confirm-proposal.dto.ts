import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ConfirmAssistantProposalDto {
  @ApiProperty({
    description: 'Proposal ids awaiting confirmation.',
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  proposalIds!: string[];

  @ApiProperty({ enum: ['approved', 'rejected'] })
  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AssistantConfirmResultDto {
  @ApiProperty({
    description: 'Conversation (LangGraph thread) id the proposals belong to.',
  })
  conversationId!: string;

  @ApiProperty({ enum: ['approved', 'rejected'] })
  decision!: 'approved' | 'rejected';

  @ApiProperty({ enum: ['approved', 'rejected'] })
  status!: 'approved' | 'rejected';

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Final assistant content after the decision is applied.',
  })
  finalContent!: string | null;
}

export class AssistantConfirmResultResponseDto extends AssistantConfirmResultDto {}
