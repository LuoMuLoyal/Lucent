export {
  SUGGESTION_RULE_CODE_ALLOWLIST,
  isKnownSuggestionRuleCode,
} from './constants/rule-code-allowlist.constants.js';
export { MAX_PRODUCT_EVENTS_PER_REQUEST } from './dto/create-product-event.dto.js';
export type {
  CreateProductEventBatchDto,
  CreateProductEventDto,
} from './dto/create-product-event.dto.js';
export { MAX_FUNNEL_RANGE_DAYS } from './dto/funnel-query.dto.js';
export type { FunnelQueryDto } from './dto/funnel-query.dto.js';
export type {
  FunnelDailyCountsDto,
  FunnelDataDto,
  FunnelOptionalCountsDto,
  FunnelResponseDto,
  FunnelTotalsDto,
  FunnelWindowDto,
} from './dto/funnel-response.dto.js';
export {
  ProductEventsService,
  type ServerProductEventInput,
} from './services/events.service.js';
export type { ProductEventRecordResult } from './services/events.service.js';
export {
  DEFAULT_FUNNEL_WINDOW_DAYS,
  MIN_FUNNEL_GROUP_SIZE,
  ProductFunnelService,
} from './services/funnel.service.js';
