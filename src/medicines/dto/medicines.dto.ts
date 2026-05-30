import {
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const MEDICINE_KNOWLEDGE_SOURCES = ['drugbank', 'cn'] as const;
export type MedicineKnowledgeSource =
  (typeof MEDICINE_KNOWLEDGE_SOURCES)[number];

export const DEFAULT_MEDICINE_SOURCE: MedicineKnowledgeSource = 'drugbank';

function trimOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

export class MedicineSearchQueryDto {
  @ApiPropertyOptional({
    description: 'Knowledge source selector.',
    enum: MEDICINE_KNOWLEDGE_SOURCES,
    default: DEFAULT_MEDICINE_SOURCE,
  })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({
    description: 'Search keyword.',
    example: 'ibuprofen',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }: { value: unknown }) => trimOptionalString(value))
  q?: string;

  @ApiPropertyOptional({
    description: 'Page number, 1-based.',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({
    description: 'Page size.',
    example: 20,
    default: 20,
    maximum: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 20;
}

export class MedicineDetailQueryDto {
  @ApiPropertyOptional({
    description: 'Knowledge source selector.',
    enum: MEDICINE_KNOWLEDGE_SOURCES,
    default: DEFAULT_MEDICINE_SOURCE,
  })
  @IsOptional()
  @IsString()
  source?: string;
}

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
  })
  subtitle!: string | null;

  @ApiProperty({
    description: 'Short preview summary.',
    example: 'A non-steroidal anti-inflammatory drug...',
    nullable: true,
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

export class DrugbankMedicineDetailDto {
  @ApiProperty({ example: 'drugbank' })
  kind!: 'drugbank';

  @ApiPropertyOptional({ nullable: true, example: 'small molecule' })
  drugType!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'solid' })
  state!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'A non-steroidal anti-inflammatory drug.',
  })
  description!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Used for pain, fever, and inflammation.',
  })
  indication!: string | null;

  @ApiPropertyOptional({ nullable: true })
  mechanismOfAction!: string | null;

  @ApiPropertyOptional({ nullable: true })
  pharmacodynamics!: string | null;

  @ApiPropertyOptional({ nullable: true })
  toxicity!: string | null;

  @ApiPropertyOptional({ nullable: true })
  metabolism!: string | null;

  @ApiPropertyOptional({ nullable: true })
  absorption!: string | null;

  @ApiPropertyOptional({ nullable: true })
  halfLife!: string | null;

  @ApiPropertyOptional({ nullable: true })
  proteinBinding!: string | null;

  @ApiPropertyOptional({ nullable: true })
  routeOfElimination!: string | null;

  @ApiPropertyOptional({ nullable: true })
  volumeOfDistribution!: string | null;

  @ApiPropertyOptional({ nullable: true })
  clearance!: string | null;

  @ApiProperty({ type: [String], example: ['approved', 'small molecule'] })
  groups!: string[];

  @ApiProperty({ type: [String], example: ['Anti-inflammatory Agents'] })
  categories!: string[];

  @ApiProperty({ type: [String], example: ['M01AE01'] })
  atcCodes!: string[];

  @ApiProperty({ type: [String], example: ['Ibuprofen'] })
  synonyms!: string[];

  @ApiProperty({
    type: [String],
    example: ['Avoid taking with alcohol.'],
  })
  foodInteractions!: string[];

  @ApiPropertyOptional({
    description: 'Raw source interaction payload.',
    type: Object,
    nullable: true,
    additionalProperties: true,
  })
  drugInteractions!: unknown;

  @ApiPropertyOptional({
    description: 'Raw source external identifier payload.',
    type: Object,
    nullable: true,
    additionalProperties: true,
  })
  externalIdentifiers!: unknown;

  @ApiPropertyOptional({
    description: 'Raw source external link payload.',
    type: Object,
    nullable: true,
    additionalProperties: true,
  })
  externalLinks!: unknown;
}

export class CnMedicineDetailDto {
  @ApiProperty({ example: 'cnProduct' })
  kind!: 'cnProduct';

  @ApiPropertyOptional({ nullable: true, example: '国药准字H10900089' })
  approvalNumber!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '某某制药' })
  manufacturer!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '0.3g*10粒' })
  packageSpec!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '布洛芬' })
  brandName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  ingredients!: string | null;

  @ApiPropertyOptional({ nullable: true })
  properties!: string | null;

  @ApiPropertyOptional({ nullable: true })
  indications!: string | null;

  @ApiPropertyOptional({ nullable: true })
  dosage!: string | null;

  @ApiPropertyOptional({ nullable: true })
  adverseReactions!: string | null;

  @ApiPropertyOptional({ nullable: true })
  contraindications!: string | null;

  @ApiPropertyOptional({ nullable: true })
  precautions!: string | null;

  @ApiPropertyOptional({ nullable: true })
  pediatricUse!: string | null;

  @ApiPropertyOptional({ nullable: true })
  geriatricUse!: string | null;

  @ApiPropertyOptional({ nullable: true })
  pregnancyLactation!: string | null;

  @ApiPropertyOptional({ nullable: true })
  pharmacologyToxicology!: string | null;

  @ApiPropertyOptional({ nullable: true })
  drugInteractions!: string | null;

  @ApiPropertyOptional({ nullable: true })
  pharmacokinetics!: string | null;

  @ApiPropertyOptional({ nullable: true })
  overdose!: string | null;

  @ApiPropertyOptional({ nullable: true })
  storage!: string | null;

  @ApiPropertyOptional({ nullable: true })
  validityPeriod!: string | null;

  @ApiPropertyOptional({ nullable: true })
  barcode!: string | null;

  @ApiPropertyOptional({ nullable: true })
  nationalDrugCode!: string | null;

  @ApiPropertyOptional({ nullable: true })
  sourceUrl!: string | null;

  @ApiPropertyOptional({ nullable: true })
  imageUrl!: string | null;
}

export class MedicineDetailDataDto {
  @ApiProperty({ example: 'DB01050' })
  id!: string;

  @ApiProperty({
    enum: MEDICINE_KNOWLEDGE_SOURCES,
    example: DEFAULT_MEDICINE_SOURCE,
  })
  source!: MedicineKnowledgeSource;

  @ApiProperty({ example: 'Ibuprofen' })
  name!: string;

  @ApiProperty({
    example: 'CAS 15687-27-1',
    nullable: true,
  })
  subtitle!: string | null;

  @ApiProperty({
    oneOf: [
      { $ref: getSchemaPath(DrugbankMedicineDetailDto) },
      { $ref: getSchemaPath(CnMedicineDetailDto) },
    ],
  })
  detail!: DrugbankMedicineDetailDto | CnMedicineDetailDto;
}

export class MedicineSearchResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: '' })
  message!: string;

  @ApiProperty({ type: () => MedicineSearchItemDto, isArray: true })
  data!: MedicineSearchItemDto[];

  @ApiProperty({ type: () => MedicineSearchMetaDto })
  meta!: MedicineSearchMetaDto;
}

export class MedicineDetailResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: '' })
  message!: string;

  @ApiProperty({ type: () => MedicineDetailDataDto })
  data!: MedicineDetailDataDto;
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
