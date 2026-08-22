import { ApiProperty } from '@nestjs/swagger';

/** Metadata item for the legal document list endpoint. */
export class LegalDocumentListItemDto {
  @ApiProperty({
    description: 'Document type identifier used in URL paths.',
    example: 'privacy',
  })
  docType!: string;

  @ApiProperty({ example: '隐私政策' })
  title!: string;

  @ApiProperty({
    description: 'ISO-8601 timestamp of last update.',
  })
  updatedAt!: string;
}

/** Full legal document with Markdown content. */
export class LegalDocumentDetailDto {
  @ApiProperty({
    description: 'Document type identifier used in URL paths.',
    example: 'terms',
  })
  docType!: string;

  @ApiProperty({ example: '用户协议' })
  title!: string;

  @ApiProperty({
    description: 'Markdown content of the document.',
    type: String,
  })
  content!: string;

  @ApiProperty({
    description: 'ISO-8601 timestamp of last update.',
  })
  updatedAt!: string;
}

/** Response data for the list endpoint. */
export class LegalDocumentListDataDto {
  @ApiProperty({ type: [LegalDocumentListItemDto] })
  items!: LegalDocumentListItemDto[];

  @ApiProperty({
    description: 'ISO-8601 timestamp of the most recent document update.',
  })
  updatedAt!: string;
}

/** Envelope for the list endpoint. */
export class LegalDocumentListResponseDto extends LegalDocumentListDataDto {}

/** Envelope for the detail endpoint. */
export class LegalDocumentDetailResponseDto extends LegalDocumentDetailDto {}
