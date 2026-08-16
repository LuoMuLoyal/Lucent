import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 加药前预检的可信药品库候选。客户端在「加入药箱」前提交待加药品的
 * source/id，服务端即时跑一次静态检查（不落库、不输出安全判断）。
 */
export class RiskCheckCandidateDto {
  @ApiProperty({
    enum: ['cn', 'drugbank'],
    description: '候选药品所在的可信药品库来源',
  })
  @IsEnum(['cn', 'drugbank'])
  source!: 'cn' | 'drugbank';

  @ApiProperty({
    description: '候选药品在可信药品库中的 id',
  })
  @IsString()
  @IsNotEmpty()
  id!: string;
}

export class RunRiskCheckDto {
  @ApiProperty({
    enum: ['static', 'llm'],
    description: 'Type of risk check to run',
  })
  @IsEnum(['static', 'llm'])
  type!: 'static' | 'llm';

  @ApiPropertyOptional({
    type: () => RiskCheckCandidateDto,
    description:
      '加药前预检的可信药品库候选；仅 type=static 时允许；预检不落库',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => RiskCheckCandidateDto)
  candidate?: RiskCheckCandidateDto;
}
