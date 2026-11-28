import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { StandardFonts, type PDFDocument, type PDFFont } from 'pdf-lib';

/**
 * PDF 生成用的字体解析。两条路，二选一，没有第三级：
 *
 * - **字体就绪** → 用 `assets/fonts/SourceHanSansSC-Regular.ttf`（静态 glyf 轮廓），
 *   开 `subset: true` 只嵌实际用到的字形。中文完整、PDF 约 10 KB。
 * - **字体缺失** → 回退 `StandardFonts.Helvetica`：PDF 仍能生成，但**只有英文**，
 *   中文会缺字。
 *
 * 字体由 `tools/fonts/fetch-pdf-font.mjs`（`postinstall` 的 `font:build`）从
 * Google Fonts 取回，是**构建产物、不入库**。拉取失败时该步骤只打 warning、
 * 不阻断构建 —— 于是这里的 `CJK_FONT_PATH` 为 `null`，走英文路径。
 *
 * ## 为什么不用 `@fontpkg/source-han-sans-sc-vf`
 *
 * 它是 **CFF2 + fvar 可变字体**，而 `@pdf-lib/fontkit` 的子集化器只支持 TrueType
 * （glyf）轮廓：开 `subset: true` 会抛 `glyph._decode is not a function`，
 * 不开就只能整份嵌入 37 MB（每份 PDF 约 24 MB / 4 秒）。所以它的位置被上面那份
 * 静态 glyf 字体取代了。
 */
const HERE = dirname(
  new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
);

/**
 * 字体可能落在三个位置，依次试：
 * - 运行（`dist/modules/export/pdf-fonts.js`，nest assets 把 `../assets/**`
 *   扁平化到 `dist/assets/**`）→ `dist/assets/fonts/...`
 * - 运行（旧构建布局）→ `dist/fonts/...`
 * - 测试（`src/modules/export/pdf-fonts.ts`）→ `apps/monolith/assets/fonts/...`
 */
const CANDIDATE_RELATIVE_PATHS = [
  join(HERE, '..', '..', 'assets', 'fonts', 'SourceHanSansSC-Regular.ttf'),
  join(HERE, '..', '..', 'fonts', 'SourceHanSansSC-Regular.ttf'),
  join(
    HERE,
    '..',
    '..',
    '..',
    'assets',
    'fonts',
    'SourceHanSansSC-Regular.ttf',
  ),
] as const;

function resolveCjkFontPath(): string | null {
  for (const candidate of CANDIDATE_RELATIVE_PATHS) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  console.warn(
    '[pdf-fonts] CJK font not found; PDF export falls back to Helvetica ' +
      '(English only — Chinese text will be missing). Run `pnpm font:build` to restore it.',
  );
  return null;
}

/** CJK 字体路径；`null` 表示字体未就绪，调用方必须回退到 Helvetica（纯英文）。 */
export const CJK_FONT_PATH: string | null = resolveCjkFontPath();

/**
 * 为一份 PDF 嵌入正文字体。
 *
 * - **CJK 字体就绪** → 嵌入它并开 `subset: true`（中文完整，体积小）；
 * - **字体缺失** → `StandardFonts.Helvetica`（**纯英文**，中文缺字）。
 *
 * 调用方不必知道分支：所有 PDF 服务都调这个函数即可。
 */
export async function embedReportFont(pdf: PDFDocument): Promise<PDFFont> {
  if (CJK_FONT_PATH == null) {
    return pdf.embedFont(StandardFonts.Helvetica);
  }
  const fontBytes = await readFile(CJK_FONT_PATH);
  return pdf.embedFont(fontBytes, { subset: true });
}
