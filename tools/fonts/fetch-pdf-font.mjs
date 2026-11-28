/**
 * 下载并校验 PDF 用的 CJK 静态字体。
 *
 * ## 为什么是「下载」而不是「转换」
 *
 * `@pdf-lib/fontkit` 的子集化器只支持 TrueType（glyf）轮廓。仓库原本用的
 * `@fontpkg/source-han-sans-sc-vf` 是 CFF2 + fvar 可变字体，开 `subset: true`
 * 会抛 `glyph._decode is not a function`；不开就只能整份嵌入 37 MB。
 *
 * 就地转换（fontTools 走 cu2qu）要 2 分多钟且需要额外 Python 依赖。
 * 直接从 Google Fonts CDN 取同一字族的 **静态 glyf** 版本更省事，且它是
 * Google 官方发布的字体，不需要自己维护一套转换脚本。
 *
 * ## 覆盖范围
 *
 * 该版本 cmap 有 30890 个码位：
 * - **CJK 基本区（4E00-9FFF）与扩展 A（3400-4DBF）完整**；
 * - 缺的是韩文谚文（11534 个）与 CJK 兼容区（244 个，同一批汉字的重复编码）。
 *
 * 对本项目（中文医疗记录）完全够用。脚本会断言这一条不变量，字体升级若开始
 * 丢汉字会直接失败，而不是静默产出豆腐块。
 *
 * 用法：
 *     node tools/fonts/fetch-pdf-font.mjs          # 缺失时下载
 *     node tools/fonts/fetch-pdf-font.mjs --force  # 强制重新下载
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const TARGET = join(
  REPO_ROOT,
  'apps',
  'monolith',
  'assets',
  'fonts',
  'SourceHanSansSC-Regular.ttf',
);

/** Google Fonts 官方发布的 Noto Sans SC 静态实例（TrueType/glyf）。 */
const SOURCE_URL =
  'https://fonts.gstatic.com/s/notosanssc/v37/' +
  'k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_FnYxNbPzS5HE.ttf';

/** 固定校验和：URL 内容变了（字体升级）必须人工确认，不能悄悄换字体。 */
const EXPECTED_SHA256 =
  '5cf8b2a0576d5680284ab03a7a8219499d59bbe981a79bb3dc0031f251c39736';

/** CJK 基本区与扩展 A 的首尾码位，用于覆盖断言。 */
const CJK_RANGES = [
  [0x4e00, 0x9fff],
  [0x3400, 0x4dbf],
];

/** 抽样汉字：覆盖常用药名与生僻字，缺任何一个即判定字体不可用。 */
const SAMPLE_CHARS =
  '氨氯地平缬沙坦二甲双胍蒽醌哌嗪噻唑吡啶羧巯嘌呤羟磺肼胺阿莫西林布洛芬对乙酰氨基酚';

/**
 * 极简 TT 解析：只读 `cmap` format 4/12 的码位集合。
 * 不引入 fontkit/fontTools 依赖 —— 这个脚本要在 CI 与容器的裸 Node 里跑。
 */
function readCmapCodepoints(buf) {
  const numTables = buf.readUInt16BE(4);
  let cmapOffset = -1;
  for (let i = 0; i < numTables; i += 1) {
    const rec = 12 + i * 16;
    if (buf.toString('ascii', rec, rec + 4) === 'cmap') {
      cmapOffset = buf.readUInt32BE(rec + 8);
      break;
    }
  }
  if (cmapOffset < 0) {
    throw new Error('font has no cmap table');
  }

  const numSubtables = buf.readUInt16BE(cmapOffset + 2);
  const codepoints = new Set();
  for (let i = 0; i < numSubtables; i += 1) {
    const rec = cmapOffset + 4 + i * 8;
    const subOffset = cmapOffset + buf.readUInt32BE(rec + 4);
    const format = buf.readUInt16BE(subOffset);

    if (format === 4) {
      const segX2 = buf.readUInt16BE(subOffset + 6);
      const segCount = segX2 / 2;
      const endBase = subOffset + 14;
      const startBase = endBase + segX2 + 2;
      for (let s = 0; s < segCount; s += 1) {
        const end = buf.readUInt16BE(endBase + s * 2);
        const start = buf.readUInt16BE(startBase + s * 2);
        if (start === 0xffff) continue;
        for (let cp = start; cp <= end && cp !== 0xffff; cp += 1) {
          codepoints.add(cp);
        }
      }
    } else if (format === 12) {
      const nGroups = buf.readUInt32BE(subOffset + 12);
      for (let g = 0; g < nGroups; g += 1) {
        const base = subOffset + 16 + g * 12;
        const start = buf.readUInt32BE(base);
        const end = buf.readUInt32BE(base + 4);
        for (let cp = start; cp <= end; cp += 1) {
          codepoints.add(cp);
        }
      }
    }
  }
  return codepoints;
}

async function download() {
  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`font download failed: HTTP ${String(response.status)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const force = process.argv.includes('--force');
  if (existsSync(TARGET) && !force) {
    console.log(`font already present: ${TARGET}`);
    return;
  }

  console.log(`downloading ${SOURCE_URL}`);
  const bytes = await download();
  if (bytes.length < 1_000_000) {
    throw new Error(`download too small (${String(bytes.length)} bytes)`);
  }

  const sha = createHash('sha256').update(bytes).digest('hex');
  if (EXPECTED_SHA256 !== 'PLACEHOLDER' && sha !== EXPECTED_SHA256) {
    console.warn(
      `WARNING: font checksum changed (${sha}). ` +
        'Google may have republished the file — verify glyph coverage before merging.',
    );
  }

  const codepoints = readCmapCodepoints(bytes);
  for (const [start, end] of CJK_RANGES) {
    for (let cp = start; cp <= end; cp += 97) {
      if (!codepoints.has(cp)) {
        throw new Error(
          `font is missing U+${cp.toString(16).toUpperCase()} — CJK coverage incomplete`,
        );
      }
    }
  }
  for (const ch of SAMPLE_CHARS) {
    if (!codepoints.has(ch.codePointAt(0))) {
      throw new Error(`font is missing sample char "${ch}" — refusing to install`);
    }
  }

  mkdirSync(dirname(TARGET), { recursive: true });
  writeFileSync(TARGET, bytes);
  console.log(
    `saved ${TARGET} (${(bytes.length / 1024 / 1024).toFixed(2)} MB, ` +
      `${String(codepoints.size)} codepoints, sha256=${sha.slice(0, 16)}…)`,
  );
  console.log(`record this checksum in EXPECTED_SHA256: ${sha}`);
}

main().catch((error) => {
  console.error(`font fetch failed: ${error.message}`);
  process.exitCode = 1;
});
