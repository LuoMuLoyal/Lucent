import {
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';

import {
  DEFAULT_MEDICINE_SOURCE,
  MEDICINE_KNOWLEDGE_SOURCES,
  type MedicineKnowledgeSource,
} from './source.dto';

export class DrugbankDrugInteractionDto {
  @ApiProperty({ example: 'DB00001' })
  drugbankId!: string;

  @ApiProperty({
    example: 'The serum concentration of X can be increased when Y is used.',
  })
  description!: string;
}

export class DrugbankMedicineDetailDto {
  @ApiProperty({ example: 'drugbank' })
  kind!: 'drugbank';

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: 'small molecule',
  })
  drugType!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, example: 'solid' })
  state!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: 'A non-steroidal anti-inflammatory drug.',
  })
  description!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: 'Used for pain, fever, and inflammation.',
  })
  indication!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  mechanismOfAction!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  pharmacodynamics!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  toxicity!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  metabolism!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  absorption!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  halfLife!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  proteinBinding!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  routeOfElimination!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  volumeOfDistribution!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
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
    description: 'DrugBank interaction entries used for interaction checking.',
    type: [DrugbankDrugInteractionDto],
    nullable: true,
  })
  drugInteractions!: DrugbankDrugInteractionDto[] | null;

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

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: '国药准字H10900089',
  })
  approvalNumber!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, example: '某某制药' })
  manufacturer!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, example: '0.3g*10粒' })
  packageSpec!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, example: '布洛芬' })
  brandName!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  ingredients!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  properties!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  indications!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  dosage!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  adverseReactions!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  contraindications!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  precautions!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  pharmacologyToxicology!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  pharmacokinetics!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  overdose!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  storage!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  validityPeriod!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  barcode!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  nationalDrugCode!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  sourceUrl!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
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
    type: String,
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
