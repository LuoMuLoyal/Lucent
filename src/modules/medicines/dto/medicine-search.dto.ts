import { ApiProperty } from '@nestjs/swagger';

import {
  DEFAULT_MEDICINE_SOURCE,
  MEDICINE_KNOWLEDGE_SOURCES,
  type MedicineKnowledgeSource,
} from './medicine-source.dto';

export class MedicineSearchItemDto {
  @ApiProperty({ description: 'Stable medicine id.', example: 'DB01050' })
  id!: string;

  @ApiProperty({
    description: 'Knowledge source.',
    enum: MEDICINE_KNOWLEDGE_SOURCES,
    example: DEFAULT_MEDICINE_SOURCE,
  })
  source!: MedicineKnowledgeSource;

  @ApiProperty({ description: 'Display name.', example: 'Ibuprofen' })
  name!: string;

  @ApiProperty({
    description: 'Short supporting subtitle.',
    example: 'CAS 15687-27-1',
    nullable: true,
    type: String,
  })
  subtitle!: string | null;

  @ApiProperty({
    description: 'Short preview summary.',
    example: 'A non-steroidal anti-inflammatory drug...',
    nullable: true,
    type: String,
  })
  summary!: string | null;

  @ApiProperty({
    description: 'Compact tags for search cards.',
    type: [String],
    example: ['approved', 'small molecule'],
  })
  tags!: string[];

  @ApiProperty({
    description: 'Optional image URL.',
    example: null,
    nullable: true,
    type: String,
  })
  imageUrl!: string | null;

  @ApiProperty({
    description: 'Which fields matched the current query.',
    type: [String],
    example: ['name'],
  })
  matchedBy!: string[];
}

export class MedicinePaginationDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  pageSize!: number;

  @ApiProperty({ example: 87 })
  total!: number;

  @ApiProperty({ example: 5 })
  totalPages!: number;
}

export class MedicineSearchMetaDto {
  @ApiProperty({ type: () => MedicinePaginationDto })
  pagination!: MedicinePaginationDto;
}

export interface MedicinePagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface MedicineSearchResult {
  items: MedicineSearchItemDto[];
  pagination: MedicinePagination;
}
