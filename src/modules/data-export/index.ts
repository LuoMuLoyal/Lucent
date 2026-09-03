export type {
  EmbeddedFont,
  PageContext,
} from './constants/report-pdf.constants.js';
export {
  CONTENT_WIDTH,
  MARGIN_X,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  TOP_Y,
} from './constants/report-pdf.constants.js';
export {
  ensureSpace,
  drawSectionTitle,
  drawPageDecorations,
  drawPageChrome,
  wrapText,
} from './services/report-pdf/draw.service.js';
