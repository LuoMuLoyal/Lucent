import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Shared CJK font for all PDF-generation services.
 *
 * Both `ReportExportPdfService` (export) and `ClinicSummaryPdfService` (reports)
 * import this single source so the font choice and its constraints live in one
 * place.
 *
 * ## 为什么不用 `@fontpkg/source-han-sans-sc-vf`
 *
 * 那个包提供的是 **CFF2 + fvar 可变字体**，而 `@pdf-lib/fontkit` 的子集化器只
 * 支持 TrueType（glyf）轮廓：
 *
 * - 对它开 `subset: true` 会抛 `glyph._decode is not a function`；
 * - 不能子集化就只能整份嵌入 —— 37 MB 字体让每份 PDF 多背 ~24 MB，
 *   单次渲染耗时约 4 秒。
 *
 * ## 现在的字体
 *
 * `assets/fonts/SourceHanSansSC-Regular.ttf` 是构建期转换产物：可变轴固化到
 * wght=400，并把 CFF2 三次轮廓转成 glyf 二次轮廓（`tools/fonts/build-pdf-font.py`）。
 * **字符集完整保留**（65535 个字形，含 GB2312 之外的生僻药名用字），
 * 由调用方的 `subset: true` 按实际用到的字符做子集化。
 *
 * 实测：同样内容的 PDF 从 24.01 MB / 4013 ms 降到 16.3 KB / 60 ms。
 *
 * 字体随镜像发布（`COPY apps/monolith/assets`），不走 `node_modules` 解析：
 * 它是本仓库的构建产物，不是第三方包资产。
 */
const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

/**
 * 字体可能落在三个位置，依次试：
 * - 运行（`dist/modules/export/pdf-fonts.js`，nest assets 把 `../assets/**` 扁平化到
 *   `dist/assets/**`）→ `dist/assets/fonts/...`
 * - 运行（旧构建布局）→ `dist/fonts/...`
 * - 测试（`src/modules/export/pdf-fonts.ts`）→ `apps/monolith/assets/fonts/...`
 */
const CANDIDATE_RELATIVE_PATHS = [
  join(HERE, '..', '..', 'assets', 'fonts', 'SourceHanSansSC-Regular.ttf'),
  join(HERE, '..', '..', 'fonts', 'SourceHanSansSC-Regular.ttf'),
  join(HERE, '..', '..', '..', 'assets', 'fonts', 'SourceHanSansSC-Regular.ttf'),
] as const;

function resolveFontPath(): string {
  const attempted: string[] = [];
  for (const candidate of CANDIDATE_RELATIVE_PATHS) {
    attempted.push(candidate);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  // 资源缺失时回退到 `@fontpkg` 可变字体：宁可 PDF 变大，也不要整条导出能力挂掉。
  // 这条路径只在构建产物漏带 assets 时触发，所以必须留下可诊断的日志。
  console.warn(
    `[pdf-fonts] static font not found in: ${attempted.join(', ')}; ` +
      'falling back to the variable font (PDFs will be ~24 MB)',
  );
  const nodeRequire = createRequire(import.meta.url);
  return nodeRequire.resolve(
    '@fontpkg/source-han-sans-sc-vf/SourceHanSansSC-VF.otf',
  );
}

/**
 * 该字体是否为可子集化的静态 glyf 轮廓。
 *
 * 调用方据此决定 `embedFont(..., { subset })` 的取值：可变字体不能开子集化
 * （会崩），静态字体必须开（否则又回到整份嵌入）。
 */
export const CJK_FONT_SUBSETTABLE = !resolveFontPath().endsWith('-VF.otf');

export const CJK_FONT_PATH = resolveFontPath();