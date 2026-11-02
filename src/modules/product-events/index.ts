export {
  SUGGESTION_RULE_CODE_ALLOWLIST,
  isKnownSuggestionRuleCode,
} from './constants/rule-code-allowlist.constants.js';
export { MAX_PRODUCT_EVENTS_PER_REQUEST } from './adapters/http/dto/create-product-event.js';
export type {
  CreateProductEventBatchDto,
  CreateProductEventDto,
} from './adapters/http/dto/create-product-event.js';
export { MAX_FUNNEL_RANGE_DAYS } from './adapters/http/dto/funnel-query.js';
export { productFunnelQuerySchema } from './adapters/http/dto/funnel-query.js';
export type { FunnelQueryDto } from './adapters/http/dto/funnel-query.js';
export { funnelResponseSchema } from './adapters/http/dto/funnel-response.js';
export type {
  FunnelDailyCountsDto,
  FunnelDataDto,
  FunnelOptionalCountsDto,
  FunnelResponseDto,
  FunnelTotalsDto,
  FunnelWindowDto,
} from './adapters/http/dto/funnel-response.js';
export {
  ProductEventsService,
  type ServerProductEventInput,
} from './application/use_cases/events.js';
export type { ProductEventRecordResult } from './application/use_cases/events.js';
export {
  DEFAULT_FUNNEL_WINDOW_DAYS,
  MIN_FUNNEL_GROUP_SIZE,
  ProductFunnelService,
} from './application/use_cases/funnel.js';
