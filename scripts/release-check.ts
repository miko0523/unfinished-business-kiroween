// 公开前检查（tasks 16.3）。三件事，各自独立：
//   tree     扫描当前仓库（已追踪的 + 还没追踪但没被忽略的文件）：本机绝对路径、密钥与口令、邮箱、参考图、.local-inputs、私密词。
//   licenses 检查锁文件里每个依赖的许可证，只允许 MIT、ISC、Apache-2.0、BSD 类（及等价的 0BSD）；区分“会随产物发布”与“只在构建时用”。
//   history  扫描 Git 提交历史：作者与提交者邮箱、每次提交新增的内容里是否有上面这些东西。
// 用法：node scripts/release-check.ts [tree] [licenses] [history]（不写参数 = tree 和 licenses）。
// 私密词不写在仓库里：运行时用环境变量 RELEASE_DENYLIST（逗号分隔）传入，对路径与内容、历史都生效。
// 有任何命中就以退出码 1 结束。这是对已知写法的检查，不是“已清理干净”的证明；历史里的命中只能靠发布前改写历史或另开新仓库来解决，本脚本不改动任何历史。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Finding {
  rule: string;
  where: string;
  detail: string;
}

export interface FileEntry {
  path: string;
  /** 二进制文件为 null：只按路径检查。 */
  text: string | null;
}

// ---------- 规则 ----------

const PATH_PATTERNS: [string, RegExp][] = [
  ['本机绝对路径', /\/Users\/[^\s'"`/\\)]+/],
  ['本机绝对路径', /\/home\/[a-z_][^\s'"`/\\)]*/],
  ['本机绝对路径', /[A-Za-z]:\\Users\\[^\s'"`\\]+/],
  ['本机绝对路径', /\/private\/var\/[^\s'"`]+/],
  ['本机绝对路径', /file:\/\/\/[^\s'"`]+/],
];

const SECRET_PATTERNS: [string, RegExp][] = [
  ['私钥', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/],
  ['GitHub 令牌', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ['GitHub 令牌', /\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ['AWS 访问密钥', /\bAKIA[0-9A-Z]{16}\b/],
  ['通用 API 密钥', /\bsk-[A-Za-z0-9]{20,}\b/],
  ['Slack 令牌', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['Google API 密钥', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['口令赋值', /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*['"][^'"\s]{8,}['"]/i],
  ['带口令的地址', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"]+:[^\s/@'"]+@[^\s/'"]+/i],
];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
/** 文档与测试里常见的、不指向真人的示例域名。 */
const HARMLESS_EMAIL_DOMAINS = /(?:^|\.)(?:example\.(?:com|org|net)|localhost|invalid|users\.noreply\.github\.com)$/i;

const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|avif|bmp|tiff?|psd|heic|svg)$/i;
/** 允许放图片的地方：ASSETS.md 登记过的旧宅素材，以及 README 用的截图。 */
const IMAGE_HOMES = [/^public\/assets\/dollhouse\//, /^docs\/screenshots\//];
const REFERENCE_NAME = /reference|参考|lantern-source|concept|mockup/i;

export function maskEmail(email: string): string {
  const [name = '', domain = ''] = email.split('@');
  return `${name.slice(0, 1)}***@${domain}`;
}

function snippet(text: string, index: number, length: number): string {
  const line = text.slice(text.lastIndexOf('\n', index) + 1, text.indexOf('\n', index) < 0 ? undefined : text.indexOf('\n', index));
  const shown = line.length > 140 ? `${line.slice(0, 140)}…` : line;
  return length > 0 ? shown.trim() : '';
}

/** 一段文字里的命中（路径、密钥、邮箱、私密词）。邮箱只给出打码后的样子。 */
export function scanText(where: string, text: string, deny: readonly string[] = []): Finding[] {
  const out: Finding[] = [];
  for (const [rule, re] of [...PATH_PATTERNS, ...SECRET_PATTERNS]) {
    const m = re.exec(text);
    if (m) out.push({ rule, where, detail: rule === '带口令的地址' || rule.endsWith('令牌') || rule.endsWith('密钥') || rule === '私钥' || rule === '口令赋值' ? `已命中（内容不显示）` : snippet(text, m.index, m[0].length) });
  }
  for (const m of text.matchAll(EMAIL)) {
    const domain = m[0].split('@')[1]!;
    if (!HARMLESS_EMAIL_DOMAINS.test(domain)) out.push({ rule: '邮箱', where, detail: maskEmail(m[0]) });
  }
  const lower = text.toLowerCase();
  for (const word of deny) {
    if (word && lower.includes(word.toLowerCase())) out.push({ rule: '私密词', where, detail: word });
  }
  return out;
}

export function scanPath(path: string, deny: readonly string[] = []): Finding[] {
  const out: Finding[] = [];
  if (path.startsWith('.local-inputs/')) out.push({ rule: '本地输入目录被追踪', where: path, detail: '.local-inputs/ 里的文件不能进仓库' });
  if (IMAGE_EXT.test(path) && !IMAGE_HOMES.some((re) => re.test(path))) out.push({ rule: '未登记的图片', where: path, detail: '图片只允许在 public/assets/dollhouse/ 与 docs/screenshots/' });
  if (REFERENCE_NAME.test(path)) out.push({ rule: '疑似参考图或概念稿', where: path, detail: '文件名像参考图' });
  const lower = path.toLowerCase();
  for (const word of deny) if (word && lower.includes(word.toLowerCase())) out.push({ rule: '私密词', where: `${path}（路径）`, detail: word });
  return out;
}

/**
 * GitHub Pages 的构建分支会把 public/ 内容发布到根目录，因此已登记的旧宅图片会以
 * assets/dollhouse/ 出现在历史中。只在历史路径检查放行这一种形态；当前源码树仍由
 * scanPath 强制只能放在 public/assets/dollhouse/，私密词等其它规则照常保留。
 */
export function scanHistoryPath(path: string, current: boolean, deny: readonly string[] = []): Finding[] {
  return scanPath(path, deny)
    .filter((finding) => !(finding.rule === '未登记的图片' && /^assets\/dollhouse\//.test(path)))
    .map((finding) => ({ ...finding, where: `${path}${current ? '' : '（已删除）'}` }));
}

/** 当前文件集合的全部命中。 */
export function scanTree(files: readonly FileEntry[], deny: readonly string[] = []): Finding[] {
  return files.flatMap((f) => [...scanPath(f.path, deny), ...(f.text === null ? [] : scanText(f.path, f.text, deny))]);
}

// ---------- 许可证 ----------

const ALLOWED_LICENSES = new Set(['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'BSD']);

/** SPDX 表达式：OR 取任一满足，AND 要求全部满足。 */
export function licenseAllowed(expression: string): boolean {
  const text = expression.trim().replace(/^\(|\)$/g, '');
  if (text === '' || text === '?') return false;
  return text.split(/\s+OR\s+/i).some((alt) => alt.split(/\s+AND\s+/i).every((id) => ALLOWED_LICENSES.has(id.replace(/[()]/g, '').trim())));
}

export interface LicenseRow {
  name: string;
  version: string;
  license: string;
  /**
   * false 只在锁文件明确写了 `dev: true` 时成立（只在开发、测试或构建时用）；其余一律保守地算会发布。
   * `optional: true` 只表示“可以不装”，不表示“不发布”：一个 optional 的运行时依赖在装上时仍会进入产物，所以不能据此免检。
   */
  shipped: boolean;
  optional: boolean;
  installed: boolean;
}

export interface LockPackage {
  version?: string;
  dev?: boolean;
  optional?: boolean;
  license?: string;
}

export function licenseRows(lock: { packages: Record<string, LockPackage> }, readInstalled: (path: string) => string | null): LicenseRow[] {
  const rows: LicenseRow[] = [];
  for (const [key, pkg] of Object.entries(lock.packages)) {
    if (key === '') continue;
    const installedLicense = readInstalled(key);
    rows.push({
      name: key.replace(/^.*node_modules\//, ''),
      version: pkg.version ?? '?',
      license: installedLicense ?? pkg.license ?? '?',
      shipped: pkg.dev !== true,
      optional: pkg.optional === true,
      installed: installedLicense !== null,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 实现者的工程分类（待主会话复核；不是法律结论）：下面两类传递依赖在锁文件里明确是 `dev: true`，只由 Vite 工具链在构建时引入，
 * 按当前发布范围（只发布 dist/ 与本仓库源码）属于未发布的构建依赖，所以单独列出，不计入“许可证检查通过”的证明。
 * 只对“锁文件里明确 dev: true + 许可证与登记的一致”成立：optional 不算，没有明确 dev: true 的包一律保守地算会发布。
 * 发布范围变了就必须重新评估。这里不裁定图片等素材的许可证。
 */
export const ACCEPTED_BUILD_TIME: { match: RegExp; license: string }[] = [
  { match: /^lightningcss(?:-[a-z0-9-]+)?$/, license: 'MPL-2.0' },
  { match: /^caniuse-lite$/, license: 'CC-BY-4.0' },
];

const isAcceptedBuildTime = (r: LicenseRow): boolean => !r.shipped && ACCEPTED_BUILD_TIME.some((a) => a.match.test(r.name) && a.license === r.license);

const licenseFinding = (r: LicenseRow, rule: string): Finding => ({
  rule,
  where: `${r.name}@${r.version}`,
  detail: `${r.license}（${r.shipped ? '会随页面发布' : '只在构建/开发时使用，不进入 dist'}${r.optional ? '，可选的平台包' : ''}）`,
});

/** 不在允许范围、也没有被裁定接受的依赖。 */
export function licenseFindings(rows: readonly LicenseRow[]): Finding[] {
  return rows.filter((r) => !licenseAllowed(r.license) && !isAcceptedBuildTime(r)).map((r) => licenseFinding(r, '许可证不在允许范围'));
}

/** 不在允许范围、但被裁定接受的仅构建时依赖（单独列出，不当作通过的证明）。 */
export function acceptedBuildTimeFindings(rows: readonly LicenseRow[]): Finding[] {
  return rows.filter((r) => !licenseAllowed(r.license) && isAcceptedBuildTime(r)).map((r) => licenseFinding(r, '仅构建时、已裁定接受'));
}

function readInstalledLicense(root: string) {
  return (key: string): string | null => {
    const file = join(root, key, 'package.json');
    if (!existsSync(file)) return null;
    try {
      const j = JSON.parse(readFileSync(file, 'utf8')) as { license?: unknown; licenses?: { type?: string }[] };
      if (typeof j.license === 'string') return j.license;
      if (j.license && typeof j.license === 'object' && 'type' in j.license) return String((j.license as { type: string }).type);
      if (Array.isArray(j.licenses)) return j.licenses.map((l) => l.type).join(' OR ');
    } catch {
      /* 读不了就当没装 */
    }
    return null;
  };
}

// ---------- 与 git、文件系统打交道的部分 ----------

const git = (args: string[], max = 512 * 1024 * 1024): string => execFileSync('git', args, { encoding: 'utf8', maxBuffer: max });
const BINARY_EXT = /\.(?:png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|zip|gz|pdf|mp3|mp4|wasm)$/i;

export function treeFiles(root = '.'): FileEntry[] {
  const names = git(['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean);
  return [...new Set(names)].filter((p) => existsSync(join(root, p))).map((path) => {
    if (BINARY_EXT.test(path)) return { path, text: null };
    const buf = readFileSync(join(root, path));
    return { path, text: buf.includes(0) ? null : buf.toString('utf8') };
  });
}

export interface HistoryReport {
  commits: number;
  identities: { identity: string; commits: number }[];
  findings: Finding[];
  /** 历史里出现过、现在已不在的路径中，命中路径规则的。 */
  pathFindings: Finding[];
}

/** 扫描全部提交：身份、新增的行、历史上出现过的路径。 */
export function scanHistory(deny: readonly string[] = [], root = '.'): HistoryReport {
  const meta = git(['-C', root, 'log', '--all', '--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce']).trim().split('\n').filter(Boolean);
  const seen = new Map<string, number>();
  for (const line of meta) {
    const [, an, ae, cn, ce] = line.split('\x1f');
    for (const id of new Set([`${an} <${ae}>`, `${cn} <${ce}>`])) seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  const identities = [...seen].map(([identity, commits]) => ({ identity, commits }));
  const findings: Finding[] = [];
  for (const { identity } of identities) {
    const email = /<([^>]*)>/.exec(identity)?.[1] ?? '';
    const domain = email.split('@')[1] ?? '';
    if (email && !HARMLESS_EMAIL_DOMAINS.test(domain)) findings.push({ rule: '提交作者邮箱', where: '提交元数据', detail: `${identity.split(' <')[0]} <${maskEmail(email)}>` });
    for (const word of deny) if (word && identity.toLowerCase().includes(word.toLowerCase())) findings.push({ rule: '私密词', where: '提交作者名', detail: word });
  }
  // 每次提交新增的行（-U0）。
  const log = git(['-C', root, 'log', '--all', '-p', '-U0', '--no-color', '--no-ext-diff', '--format=\x1fcommit %h', '--', '.', ':(exclude)package-lock.json'], 1024 * 1024 * 1024);
  let commit = '';
  let file = '';
  const added = new Map<string, string[]>();
  for (const line of log.split('\n')) {
    if (line.startsWith('\x1fcommit ')) commit = line.slice(8);
    else if (line.startsWith('+++ b/')) file = line.slice(6);
    else if (line.startsWith('+') && !line.startsWith('+++')) {
      const key = `${commit} ${file}`;
      (added.get(key) ?? added.set(key, []).get(key)!).push(line.slice(1));
    }
  }
  for (const [key, lines] of added) {
    const [c, ...f] = key.split(' ');
    for (const hit of scanText(`${c} ${f.join(' ')}`, lines.join('\n'), deny)) findings.push(hit);
  }
  const everPaths = new Set(git(['-C', root, 'log', '--all', '--name-only', '--format=', '--no-renames']).split('\n').filter(Boolean));
  const current = new Set(git(['-C', root, 'ls-files']).split('\n'));
  const pathFindings = [...everPaths].flatMap((p) => scanHistoryPath(p, current.has(p), deny));
  return { commits: meta.length, identities, findings, pathFindings };
}

// ---------- 命令行 ----------

function summarize(title: string, findings: readonly Finding[]): number {
  console.log(`\n== ${title}：${findings.length === 0 ? '无命中' : `${findings.length} 处命中`}`);
  const byRule = new Map<string, Finding[]>();
  for (const f of findings) (byRule.get(f.rule) ?? byRule.set(f.rule, []).get(f.rule)!).push(f);
  for (const [rule, list] of byRule) {
    const places = new Set(list.map((f) => f.where));
    console.log(`  - ${rule}：${list.length} 处，涉及 ${places.size} 个位置`);
    for (const f of list.slice(0, 5)) console.log(`      ${f.where}  ${f.detail}`);
    if (list.length > 5) console.log(`      …另有 ${list.length - 5} 处`);
  }
  return findings.length;
}

function main(argv: string[]): number {
  const modes = new Set(argv.filter((a) => !a.startsWith('-')));
  if (modes.size === 0) {
    modes.add('tree');
    modes.add('licenses');
  }
  const deny = (process.env.RELEASE_DENYLIST ?? '').split(',').map((w) => w.trim()).filter(Boolean);
  console.log(`私密词清单：${deny.length === 0 ? '未提供（设置 RELEASE_DENYLIST 后才会检查）' : `${deny.length} 个（不显示）`}`);
  let bad = 0;
  if (modes.has('tree')) bad += summarize('当前仓库', scanTree(treeFiles(), deny));
  if (modes.has('licenses')) {
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as { packages: Record<string, LockPackage> };
    const rows = licenseRows(lock, readInstalledLicense('.'));
    const counts = new Map<string, number>();
    for (const r of rows.filter((r) => r.shipped)) counts.set(r.license, (counts.get(r.license) ?? 0) + 1);
    console.log(`\n会随页面发布的依赖：${rows.filter((r) => r.shipped).map((r) => `${r.name}@${r.version} (${r.license})`).join('、') || '无'}`);
    summarize('依赖许可证（仅构建时、已裁定接受，不计入未通过；裁定待主会话复核）', acceptedBuildTimeFindings(rows));
    bad += summarize('依赖许可证（其余不在允许范围的）', licenseFindings(rows));
  }
  if (modes.has('history')) {
    const h = scanHistory(deny);
    console.log(`\n提交 ${h.commits} 个；作者与提交者身份：`);
    for (const i of h.identities) console.log(`  - ${i.identity.replace(/<([^>]*)>/, (_, e: string) => `<${maskEmail(e)}>`)}：${i.commits} 个提交`);
    bad += summarize('Git 历史（新增内容与作者）', h.findings);
    bad += summarize('Git 历史（出现过的路径）', h.pathFindings);
    console.log('\n注意：历史里的命中不能靠再加一个删除提交来解决，旧提交仍在；需要在发布前改写历史，或者用干净的新历史发布。本脚本不改写任何历史。');
  }
  console.log(bad === 0 ? '\n全部通过。' : `\n共 ${bad} 处命中，未通过。`);
  return bad === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) process.exit(main(process.argv.slice(2)));
