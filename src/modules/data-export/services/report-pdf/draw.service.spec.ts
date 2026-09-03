import { wrapText, ensureHeight, ensureSpace } from './draw.service.js';
import type {
  PageContext,
  EmbeddedFont,
  PdfPage,
} from '../../constants/report-pdf.constants.js';
import type { PDFDocument } from 'pdf-lib';

function createMockFont(): vi.Mocked<EmbeddedFont> {
  return {
    widthOfTextAtSize: vi.fn((text: string) => text.length * 8),
  } as unknown as vi.Mocked<EmbeddedFont>;
}

function createMockPage(): vi.Mocked<PdfPage> {
  return {
    drawText: vi.fn(),
    drawRectangle: vi.fn(),
    drawLine: vi.fn(),
  } as unknown as vi.Mocked<PdfPage>;
}

function createMockContext(overrides: Partial<PageContext> = {}): PageContext {
  return {
    pdf: {
      addPage: vi.fn().mockReturnValue(createMockPage()),
      getPageCount: vi.fn().mockReturnValue(1),
      getPage: vi.fn().mockReturnValue(createMockPage()),
    } as unknown as PDFDocument,
    cjkFont: createMockFont(),
    page: createMockPage(),
    cursorY: 748,
    title: 'Test Report',
    headerSubtitle: 'Test Subtitle',
    footerNote: 'Test Footer',
    pageNumberLabel: 'Page {{page}} / {{total}}',
    kindLabel: 'Hospital',
    ...overrides,
  };
}

describe('draw.service', () => {
  describe('wrapText', () => {
    it('returns single line when text fits', () => {
      const font = createMockFont();
      font.widthOfTextAtSize.mockReturnValue(50);

      const lines = wrapText('hello', font, 12, 100);
      expect(lines).toEqual(['hello']);
    });

    it('wraps text when it exceeds maxWidth', () => {
      const font = createMockFont();
      // Each character is 10px wide, maxWidth is 30, so 3 chars per line
      font.widthOfTextAtSize.mockImplementation(
        (text: string) => text.length * 10,
      );

      const lines = wrapText('abcdef', font, 12, 30);
      expect(lines).toEqual(['abc', 'def']);
    });

    it('wraps long text into multiple lines', () => {
      const font = createMockFont();
      font.widthOfTextAtSize.mockImplementation(
        (text: string) => text.length * 10,
      );

      const lines = wrapText('abcdefghij', font, 12, 25);
      expect(lines).toHaveLength(5);
      expect(lines[0]).toBe('ab');
    });

    it('handles empty string', () => {
      const font = createMockFont();
      const lines = wrapText('', font, 12, 100);
      expect(lines).toEqual([]);
    });

    it('handles single character', () => {
      const font = createMockFont();
      font.widthOfTextAtSize.mockReturnValue(5);

      const lines = wrapText('x', font, 12, 100);
      expect(lines).toEqual(['x']);
    });
  });

  describe('ensureHeight', () => {
    it('does nothing when there is enough space', () => {
      const context = createMockContext({ cursorY: 500 });
      ensureHeight(context, 100);

      // No new page should be added
      expect(context.pdf.addPage).not.toHaveBeenCalled();
      expect(context.cursorY).toBe(500);
    });

    it('adds a new page when space is insufficient', () => {
      const context = createMockContext({ cursorY: 100 });
      ensureHeight(context, 200);

      expect(context.pdf.addPage).toHaveBeenCalled();
      expect(context.cursorY).toBe(748); // TOP_Y
    });
  });

  describe('ensureSpace', () => {
    it('calculates needed height correctly and does not add page when enough space', () => {
      const context = createMockContext({ cursorY: 500 });
      ensureSpace(context, 3, 10);

      expect(context.pdf.addPage).not.toHaveBeenCalled();
    });

    it('adds a new page when calculated height exceeds available space', () => {
      const context = createMockContext({ cursorY: 100 });
      // neededHeight = 3 * 15 + 10 = 55
      // cursorY - neededHeight = 100 - 55 = 45, which is < BOTTOM_Y (96)
      ensureSpace(context, 3, 10);

      expect(context.pdf.addPage).toHaveBeenCalled();
    });
  });
});
