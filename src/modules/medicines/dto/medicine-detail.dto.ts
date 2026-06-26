import {
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';

import {
  DEFAULT_MEDICINE_SOURCE,
  MEDICINE_KNOWLEDGE_SOURCES,
  type MedicineKnowledgeSource,
} from './medicine-source.dto';

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

  @ApiPropertyOptional({
    nullable: true,
    deprecated: true,
    description:
      'Deprecated: use pregnancy and lactation fields. Kept for backward compatibility.',
  })
  pregnancyLactation!: string | null;

  @ApiPropertyOptional({ nullable: true })
  pregnancy!: string | null;

  @ApiPropertyOptional({ nullable: true })
  lactation!: string | null;

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
