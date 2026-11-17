// arch-check-with-baseline.ts — Phase 0 护栏(ADR-0024 计划):基线例外清单门禁。
//
// 取代裸 `pnpm arch:check` 的 "全 warn 放行":三类观察(依赖图 / eslint.arch /
// AST 端点姿态)汇总为 `tool|rule|file` 条目清单,与
// `scripts/arch/arch-warning-baseline.json` 对账:
// - 新条目(屏幕上第一次出现的 文件+规则 组合)→ exit 1;
// - 已修复条目 → 打印提示,鼓励手动更新基线(只允许递减);
// - 基线没有的观察规则(规则本身是新的)→ 一律视为新条目。
//
// 更新基线:`pnpm arch:baseline:update`(把当前观察清单整体写入基线)。
// 到期日意义:每条观察规则给出裁决期限;到期未裁决的门禁告警(logic 见 checkExpiry)。

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');
const BASELINE_PATH = join(
  REPO_ROOT,
  'scripts',
  'arch',
  'arch-warning-baseline.json',
);

interface Baseline {
  updatedAt: string;
  /** 归档观察规则的裁决期限,不新增规则就无需改这里。 */
  ruleExpiry: Record<string, string>;
  /** 观察条目清单,`tool|rule|file`,排序去重;只允许递减。 */
  entries: string[];
}

interface Violation {
  key: string;
}

function run(command: string, opts: { shell?: boolean } = {}): string {
  const result = spawnSync(command, {
    cwd: REPO_ROOT,
    shell: opts.shell ?? true,
    encoding: 'utf-8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    throw new Error(`Failed to run: ${command}\n${String(result.error)}`);
  }
  // 观察期命令均以退出码 0 设计(warn 不阻断);若实际报错则失败提前暴露。
  if (result.status !== 0 && result.stdout.length === 0) {
    process.stderr.write(result.stderr);
    throw new Error(`Command exited ${result.status}: ${command}`);
  }
  return result.stdout;
}

/** dependency-cruiser JSON 输出 → 条目。 */
function collectDepcruise(): Violation[] {
  const raw = run(
    'pnpm exec depcruise src --config .dependency-cruiser.cjs --output-type json',
  );
  const parsed = JSON.parse(raw) as {
    violations?: { rule?: { name?: string }; from?: string }[];
    summary?: {
      violations?: { rule?: { name?: string }; from?: string }[];
    };
  };
  const violations = parsed.violations ?? parsed.summary?.violations ?? [];
  const out: Violation[] = [];
  for (const violation of violations) {
    const rule = violation.rule?.name ?? 'unknown-rule';
    const from = (violation.from ?? '').replace(/\\/g, '/');
    out.push({ key: `depcruise|${rule}|${from}` });
  }
  return dedupe(out);
}

/** eslint.arch.config.ts JSON output → 条目。 */
function collectEslintArch(): Violation[] {
  const raw = run(
    'pnpm exec eslint --no-config-lookup -c eslint.arch.config.ts --format json "src/**/*.ts" "test/**/*.ts"',
  );
  const results = JSON.parse(raw) as {
    filePath: string;
    messages: { ruleId: string | null; severity: number }[];
  }[];
  const out: Violation[] = [];
  for (const result of results) {
    const file = relative(REPO_ROOT, result.filePath).replace(/\\/g, '/');
    for (const message of result.messages) {
      if (message.severity === 1) {
        out.push({ key: `eslint|${message.ruleId ?? 'unknown-rule'}|${file}` });
      }
    }
  }
  return dedupe(out);
}

/** AST 端点姿态报告(文本 `- file:line [rule] msg`)→ 条目。 */
function collectAstWarnings(): Violation[] {
  const text = run('node scripts/arch/check-ast-conventions.ts');
  const pattern = /^- (\S+?):\d+ \[([\w-]+)\]/gm;
  const out: Violation[] = [];
  let match: RegExpExecArray | null = pattern.exec(text);
  while (match !== null) {
    const [, file, rule] = match;
    out.push({ key: `ast|${rule}|${file}` });
    match = pattern.exec(text);
  }
  return dedupe(out);
}

function dedupe(list: Violation[]): Violation[] {
  const seen = new Map<string, Violation>();
  for (const item of list) {
    if (!seen.has(item.key)) {
      seen.set(item.key, item);
    }
  }
  return [...seen.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function loadBaseline(): Baseline {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as Baseline;
}

function writeBaseline(baseline: Baseline): void {
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify(baseline, null, 2)}\n`,
    'utf-8',
  );
}

function checkExpiryBaseline(baseline: Baseline): void {
  const today = new Date().toISOString().slice(0, 10);
  for (const [rule, date] of Object.entries(baseline.ruleExpiry)) {
    if (date < today) {
      console.warn(
        `Baseline rule "${rule}" overdue since ${date}: adjudicate (retire/adopt) to keep arch:check`,
      );
    }
  }
}

function printFirstMissing(title: string, items: string[], limit = 25): void {
  console.error(`\n${title} (${items.length}):`);
  for (const item of items.slice(0, limit)) {
    console.error(`  - ${item}`);
  }
  if (items.length > limit) {
    console.error(`  ... and ${items.length - limit} more`);
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  const current = [
    ...collectDepcruise(),
    ...collectEslintArch(),
    ...collectAstWarnings(),
  ];
  const currentKeys = current.map((item) => item.key);

  if (mode === '--update' || mode === 'update') {
    const existing = existsBaseline() ? loadBaseline() : null;
    const baseline: Baseline = {
      updatedAt: new Date().toISOString().slice(0, 10),
      ruleExpiry: existing?.ruleExpiry ?? {
        // 观察期规则的裁决期限;基线递减后自行调整。
        'no-magic-numbers': '2027-01-21',
        'no-restricted-syntax': '2027-01-21',
      },
      entries: currentKeys,
    };
    writeBaseline(baseline);
    console.log(
      `Baseline updated: ${currentKeys.length} entries -> scripts/arch/arch-warning-baseline.json`,
    );
    return;
  }

  if (!existsBaseline()) {
    console.error(
      'arch-warning-baseline.json missing; run pnpm arch:baseline:update',
    );
    process.exit(1);
  }
  const baseline = loadBaseline();
  checkExpiryBaseline(baseline);
  const baseSet = new Set(baseline.entries);
  const currentSet = new Set(currentKeys);
  const added = currentKeys.filter((key) => !baseSet.has(key));
  const removed = baseline.entries.filter((key) => !currentSet.has(key));

  if (added.length > 0) {
    printFirstMissing(
      'New arch observations (update code or consciously extend baseline)',
      added,
    );
    process.exit(1);
  }

  console.log(
    `Arch checks passed: ${currentKeys.length} observed entries; baseline intact (no new).`,
  );
  if (removed.length > 0) {
    printFirstMissing(
      'Baseline can be shrunk (entries fixed; rerun pnpm arch:baseline:update)',
      removed,
    );
    console.error(
      '  Note: baseline entries only shrink; rerun pnpm arch:baseline:update to persist.',
    );
  }
}

function existsBaseline(): boolean {
  try {
    readFileSync(BASELINE_PATH, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
