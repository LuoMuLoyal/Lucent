import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { SYMPTOM_CATALOG_CODES } from '../constants/symptom-catalog.constants.js';
import type { SymptomCatalogResponseDto } from '../dto/symptom-catalog.dto.js';

/**
 * 症状目录（静态参考数据，无用户维度）。
 *
 * 码与顺序来自 `SYMPTOM_CATALOG_CODES`，文案按请求语言（`Accept-Language` 由
 * nestjs-i18n 的 `AcceptLanguageResolver` 解析）从 `symptom-catalog` 命名空间取。
 */
@Injectable()
export class SymptomCatalogService {
  constructor(private readonly i18n: I18nService) {}

  list(): SymptomCatalogResponseDto {
    return {
      items: SYMPTOM_CATALOG_CODES.map((code) => ({
        code,
        label: this.i18n.t(`symptom-catalog.${code}`),
      })),
    };
  }
}
