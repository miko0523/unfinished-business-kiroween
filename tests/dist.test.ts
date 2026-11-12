import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { build } from 'vite';

// 构建产物扫描（R12.1–R12.3、R12.8）。本测试用生产配置新建一份构建（放在 node_modules/.cache，不碰 dist/），
// 所以干净检出后 `npm test` 也能跑，不依赖先 build，也没有“没构建就跳过”的分支。
// `npm run build` 产物 dist/ 与它是同一份配置；e2e 的 production-build 规格另外读真实 dist/ 查开发标记。
// 规则的反例只用内存样例证明，不改动任何产品源码。
// 注意：扫描函数 scanBuild 本身对任何目录都适用（发布前检查脚本会拿它扫 dist/）。

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * 依赖来源边界。Preact 渲染器自带两个 W3C 命名空间常量，以及 dangerouslySetInnerHTML 的 innerHTML 实现；
 * 它们不是网络地址，应用也不调用。规则：
 *   - 只有框架自己的那一个产物文件（vite.config.ts 把 node_modules/preact 单独切成 assets/preact-*.js）可以含这些写法，
 *     并且每种写法的出现次数必须与 preact FRAMEWORK.version 逐一对应；多一处、少一处都报错，升级框架时必须重新核对。
 *   - 其余所有文件（应用脚本、样式、HTML）一概零容忍：连框架的原样写法照抄进来也会报错。
 *   - 新建构建时，用构建器给出的模块清单核实：框架文件只含 node_modules/preact 的模块，应用脚本一个都不含。
 *     扫描已有 dist/ 时没有模块清单，只能按文件名认框架文件。
 * 能力边界：这是对“文字写法”的检查，不是通用的安全证明。拼接字符串后再取属性这类绕开字面量的写法扫不到；
 * 应用源码另有 tests/source-safety.test.ts 禁止同类写法，两层合起来也只覆盖直白的用法。
 */
const FRAMEWORK = {
  version: '11.2.0',
  file: /^assets\/preact-[\w-]+\.js$/,
  /** preact 11.2.0 压缩产物中的出现次数。 */
  counts: {
    'http://www.w3.org/1998/Math/MathML': 2,
    'http://www.w3.org/1999/xhtml': 2,
    innerHTML: 2,
    __html: 4,
    dangerouslySetInnerHTML: 2,
  } as Record<string, number>,
};
const isFrameworkFile = (path: string) => FRAMEWORK.file.test(path);

const WRITE_TOKENS = ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'dangerouslySetInnerHTML', '__html', 'document.write'];
const TEXT_EXT = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.map', '.webmanifest']);
const BINARY_OK = new Set(['.png']);
const isBinary = (ext: string) => BINARY_OK.has(ext);
const DEV_MARKERS = [
  'calibrate',
  'data-debug',
  'cal-item',
  'glow-evidence',
  '/@vite',
  'import.meta.hot',
  'sourcemappingurl',
  'localhost',
  '127.0.0.1',
  '.local-inputs',
  '/users/',
];
const SW_MARKERS = [/service[-_ ]?worker/i, /workbox/i, /\bsw\.js\b/i, /manifest\.webmanifest/i];

export interface BuiltFile {
  /** 相对产物根目录、用 / 分隔。 */
  path: string;
  /** 文本文件的内容；二进制文件为 null。 */
  text: string | null;
}

export function scanBuild(files: readonly BuiltFile[]): string[] {
  const issues: string[] = [];
  const known = new Set(files.map((f) => f.path));

  for (const f of files) {
    const ext = extname(f.path).toLowerCase();
    if (f.text === null) {
      if (!BINARY_OK.has(ext)) issues.push(`${f.path}: 意外的二进制文件类型`);
      continue;
    }
    if (!TEXT_EXT.has(ext)) issues.push(`${f.path}: 意外的文件类型`);
    if (ext === '.map') issues.push(`${f.path}: 不应发布 source map`);
    if (/(^|\/)(sw|service-worker|serviceworker)[^/]*\.js$/i.test(f.path)) issues.push(`${f.path}: Service Worker 脚本`);

    const lower = f.text.toLowerCase();
    const isJs = ext === '.js';
    const framework = isFrameworkFile(f.path);

    // 外部地址：只放行 SVG 命名空间；框架文件里再放行它自带的两个命名空间（次数在下面逐一核对）。
    for (const m of f.text.matchAll(/(?:https?|wss?|ftp):\/\/[^\s'"`)<>\\]+/g)) {
      const url = m[0];
      if (url === SVG_NS) continue;
      if (framework && url in FRAMEWORK.counts) continue;
      issues.push(`${f.path}: 外部地址 ${url}`);
    }
    if (/(?:src|href)\s*=\s*["']?\/\//i.test(f.text) || /url\(\s*["']?\/\//i.test(f.text)) issues.push(`${f.path}: 协议相对地址`);

    for (const marker of DEV_MARKERS) {
      if (lower.includes(marker)) issues.push(`${f.path}: 开发标记 ${marker}`);
    }

    // 危险的 HTML 写入，以及框架自带的命名空间常量：普通文件零容忍；框架文件的次数必须与固定版本逐一对应。
    for (const w of [...WRITE_TOKENS, ...Object.keys(FRAMEWORK.counts).filter((k) => k.startsWith('http'))]) {
      const found = f.text.split(w).length - 1;
      const expected = framework ? (FRAMEWORK.counts[w] ?? 0) : 0;
      if (found !== expected) issues.push(`${f.path}: ${w} 出现 ${found} 次，${framework ? `preact ${FRAMEWORK.version} 的产物应为 ${expected} 次` : '这里不允许出现'}`);
    }

    for (const re of SW_MARKERS) {
      if (re.test(f.text)) issues.push(`${f.path}: Service Worker 相关 ${re.source}`);
    }

    // 路径：全部相对，且指向产物里真实存在的文件。
    if (ext === '.html') {
      for (const m of f.text.matchAll(/\b(?:href|src)\s*=\s*["']([^"']*)["']/gi)) {
        const target = m[1]!;
        if (!target.startsWith('./')) {
          issues.push(`${f.path}: 非相对路径 ${target}`);
        } else if (!known.has(target.slice(2).split(/[?#]/)[0]!)) {
          issues.push(`${f.path}: 指向不存在的文件 ${target}`);
        }
      }
    }
    if (ext === '.css') {
      for (const m of f.text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
        const target = m[1]!;
        if (!target.startsWith('data:') && (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/'))) issues.push(`${f.path}: CSS 非相对路径 ${target}`);
      }
    }
    if (isJs && /[`'"]\/(?:assets|src|public)\//.test(f.text)) issues.push(`${f.path}: 脚本里有根路径写法`);
  }
  return issues;
}

function collect(root: string): BuiltFile[] {
  const out: BuiltFile[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      const rel = relative(root, p).split(sep).join('/');
      out.push({ path: rel, text: isBinary(extname(p).toLowerCase()) ? null : readFileSync(p, 'utf8') });
    }
  };
  walk(root);
  return out;
}

/** public/ 下的每个文件都必须原样出现在产物里（包括 1x、2x、JSON 与灯笼组件）。 */
function missingPublicFiles(root: string): string[] {
  const pub = resolve('public');
  const missing: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (!existsSync(join(root, relative(pub, p)))) missing.push(relative(pub, p));
    }
  };
  walk(pub);
  return missing;
}

export interface BuiltChunk {
  fileName: string;
  moduleIds: readonly string[];
}

/** 构建器给出的模块清单：框架文件只含 node_modules/preact（以及构建器自己的 \0 虚拟模块），应用脚本一个 preact 模块都不含。 */
export function checkProvenance(chunks: readonly BuiltChunk[], frameworkVersion: string, installedVersion: string): string[] {
  const issues: string[] = [];
  const inPreact = (id: string) => /[\\/]node_modules[\\/]preact[\\/]/.test(id);
  const frameworkChunks = chunks.filter((c) => isFrameworkFile(c.fileName));
  if (frameworkChunks.length !== 1) issues.push(`应当恰有一个框架文件，实际 ${frameworkChunks.length} 个`);
  if (installedVersion !== frameworkVersion) issues.push(`装的 preact 是 ${installedVersion}，扫描规则按 ${frameworkVersion} 写；升级后要重新核对出现次数`);
  for (const c of chunks) {
    const bad = isFrameworkFile(c.fileName) ? c.moduleIds.filter((id) => !id.startsWith('\0') && !inPreact(id)) : c.moduleIds.filter(inPreact);
    for (const id of bad) issues.push(`${c.fileName}: ${isFrameworkFile(c.fileName) ? '框架文件里混进了非 preact 模块' : '应用脚本里含有 preact 模块'} ${id}`);
  }
  return issues;
}

const FRESH = resolve('node_modules/.cache/ub-dist-scan');

describe('构建产物扫描：新建的生产构建', () => {
  let chunks: BuiltChunk[] = [];
  beforeAll(async () => {
    rmSync(FRESH, { recursive: true, force: true });
    // Vitest 把 NODE_ENV 设成 test，Vite 会因此保留 import.meta.env.DEV，把开发校准层打进产物。生产构建必须在 production 下进行。
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const result = await build({ configFile: resolve('vite.config.ts'), mode: 'production', logLevel: 'silent', build: { outDir: FRESH, emptyOutDir: true } });
      const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => ('output' in r ? r.output : []));
      chunks = outputs.flatMap((o) => (o.type === 'chunk' ? [{ fileName: o.fileName, moduleIds: o.moduleIds ?? Object.keys(o.modules ?? {}) }] : []));
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  }, 180_000);
  afterAll(() => rmSync(FRESH, { recursive: true, force: true }));

  it('没有开发标记、外部地址、危险 HTML 写入、Service Worker，路径全部相对', () => {
    const files = collect(FRESH);
    expect(files.some((f) => f.path === 'index.html')).toBe(true);
    expect(files.some((f) => f.path.endsWith('.js'))).toBe(true);
    expect(scanBuild(files)).toEqual([]);
  });

  it('框架文件只含 preact 模块、应用脚本不含；装的就是规则按的那个版本', () => {
    const installed = JSON.parse(readFileSync(resolve('node_modules/preact/package.json'), 'utf8')).version as string;
    expect(chunks.length).toBeGreaterThan(1);
    expect(checkProvenance(chunks, FRAMEWORK.version, installed)).toEqual([]);
  });

  it('public/ 的素材全部随产物发布', () => {
    expect(missingPublicFiles(FRESH)).toEqual([]);
  });
});

describe('构建产物扫描：扫描器自检（内存样例）', () => {
  const html = (body: string): BuiltFile => ({ path: 'index.html', text: body });
  const js = (body: string, path = 'assets/a.js'): BuiltFile => ({ path, text: body });
  const base = [js('const a=1;'), { path: 'assets/a.css', text: 'a{color:red}' }];
  const hits = (...files: BuiltFile[]) => scanBuild([...base.filter((b) => !files.some((f) => f.path === b.path)), ...files]);

  it('干净样例通过，SVG 命名空间被放行', () => {
    expect(hits(html('<script src="./assets/a.js"></script><link href="./assets/a.css">'))).toEqual([]);
    expect(hits(js(`const ns="${SVG_NS}";`))).toEqual([]);
  });

  it('抓到外部地址（含 SVG 命名空间以外的 W3C 地址出现在 HTML/CSS 里）', () => {
    expect(hits(js('fetch("https://example.com/a")')).length).toBeGreaterThan(0);
    expect(hits(js('const u="http://cdn.example.com/x.js"')).length).toBeGreaterThan(0);
    expect(hits(js('const u="//cdn.example.com/x.js"', 'assets/b.js'), html('<script src="//cdn.example.com/x.js"></script>')).length).toBeGreaterThan(0);
    expect(hits({ path: 'assets/a.css', text: '@import url(https://fonts.example.com/a.css);' }).length).toBeGreaterThan(0);
    expect(hits({ path: 'assets/a.css', text: 'a{background:url(http://www.w3.org/1999/xhtml)}' }).length).toBeGreaterThan(0);
  });

  /** 与 preact 11.2.0 压缩产物同样次数的框架样例。 */
  const frameworkSample = () =>
    [
      `n="${SVG_NS}";`,
      ...Array.from({ length: 2 }, () => 'a=`http://www.w3.org/1998/Math/MathML`;b=`http://www.w3.org/1999/xhtml`;'),
      'c||_&&(p.__html==_.__html||p.__html==t.innerHTML)||(t.innerHTML=p.__html);',
      'd==`dangerouslySetInnerHTML`?_=b:0;e==`dangerouslySetInnerHTML`?p=b:0;',
    ].join('');
  const vendor = (body: string): BuiltFile => ({ path: 'assets/preact-Cwx8y7iz.js', text: body });

  it('框架文件：次数与固定版本逐一对应才放行', () => {
    expect(hits(vendor(frameworkSample()))).toEqual([]);
  });

  it('应用脚本原样照抄框架的写法也会被抓到（依赖来源边界）', () => {
    const copy = frameworkSample();
    expect(hits(js(copy, 'assets/index-DW312JXC.js')).length).toBeGreaterThan(0);
    expect(hits(js('t.innerHTML=p.__html;', 'assets/index-DW312JXC.js')).length).toBeGreaterThan(0);
    expect(hits(js('const m="http://www.w3.org/1998/Math/MathML";', 'assets/index-DW312JXC.js')).length).toBeGreaterThan(0);
    // 名字不合规的“框架文件”不算框架文件。
    for (const path of ['assets/preact.js', 'assets/preact-Cwx8y7iz.css', 'assets/x/preact-Cwx8y7iz.js', 'preact-Cwx8y7iz.js', 'assets/not-preact-Cwx8y7iz.js']) {
      expect(hits({ path, text: copy }).length, path).toBeGreaterThan(0);
    }
  });

  it('框架文件里多出一处、少了一处、多一个地址，都会被抓到', () => {
    expect(hits(vendor(frameworkSample() + ';el.innerHTML=y')).length).toBeGreaterThan(0);
    expect(hits(vendor(frameworkSample() + ';el.outerHTML=y')).length).toBeGreaterThan(0);
    expect(hits(vendor(frameworkSample().replace('||(t.innerHTML=p.__html)', ''))).length).toBeGreaterThan(0);
    expect(hits(vendor(frameworkSample() + ';x="http://www.w3.org/1999/xlink"')).length).toBeGreaterThan(0);
    expect(hits(vendor(frameworkSample() + ';x="https://example.com/a"')).length).toBeGreaterThan(0);
    expect(hits(vendor(frameworkSample() + ';x="http://www.w3.org/1999/xhtml"')).length).toBeGreaterThan(0);
  });

  it('抓到 innerHTML 等写法（普通文件零容忍）', () => {
    for (const bad of ['el.innerHTML=x', 'el.outerHTML=x', 'el.insertAdjacentHTML("a",x)', '{dangerouslySetInnerHTML:{__html:x}}', 'document.write(x)']) {
      expect(hits(js(bad)).length, bad).toBeGreaterThan(0);
    }
    expect(hits({ path: 'assets/a.css', text: frameworkSample() }).length).toBeGreaterThan(0);
  });

  it('来源核对：框架文件混进别的模块、应用脚本含 preact 模块、缺少框架文件、版本变了，都会报错', () => {
    const app = { fileName: 'assets/index-DW312JXC.js', moduleIds: ['/p/src/main.tsx', '/p/src/components/App.tsx'] };
    const fw = { fileName: 'assets/preact-Cwx8y7iz.js', moduleIds: ['/p/node_modules/preact/dist/preact.mjs', '/p/node_modules/preact/hooks/dist/hooks.mjs', '\0rolldown/runtime.js'] };
    expect(checkProvenance([app, fw], '11.2.0', '11.2.0')).toEqual([]);
    expect(checkProvenance([app, { ...fw, moduleIds: [...fw.moduleIds, '/p/src/main.tsx'] }], '11.2.0', '11.2.0').length).toBeGreaterThan(0);
    expect(checkProvenance([{ ...app, moduleIds: [...app.moduleIds, '/p/node_modules/preact/dist/preact.mjs'] }, fw], '11.2.0', '11.2.0').length).toBeGreaterThan(0);
    expect(checkProvenance([app], '11.2.0', '11.2.0').length).toBeGreaterThan(0);
    expect(checkProvenance([app, fw], '11.2.0', '11.3.0').length).toBeGreaterThan(0);
    // Windows 风格的路径同样认得
    expect(checkProvenance([app, { ...fw, moduleIds: ['C:\\p\\node_modules\\preact\\dist\\preact.mjs'] }], '11.2.0', '11.2.0')).toEqual([]);
  });

  it('抓到开发标记与本机路径', () => {
    const localPath = ['', 'Users', 'someone', 'project'].join('/');
    for (const bad of ['calibrate', 'data-debug', 'cal-item', 'glow-evidence', 'import.meta.hot', '//# sourceMappingURL=a.js.map', 'http://localhost:5173', localPath]) {
      expect(hits(js(`const s="${bad}"`)).length, bad).toBeGreaterThan(0);
    }
  });

  it('抓到 Service Worker', () => {
    expect(hits(js('navigator.serviceWorker.register("./sw.js")')).length).toBeGreaterThan(0);
    expect(hits(js('const a=1;', 'sw.js')).length).toBeGreaterThan(0);
    expect(hits(js('importScripts("workbox-sw.js")')).length).toBeGreaterThan(0);
  });

  it('抓到非相对路径与不存在的目标', () => {
    expect(hits(html('<script src="/assets/a.js"></script>')).length).toBeGreaterThan(0);
    expect(hits(html('<script src="assets/a.js"></script>')).length).toBeGreaterThan(0);
    expect(hits(html('<script src="./assets/missing.js"></script>')).length).toBeGreaterThan(0);
    expect(hits({ path: 'assets/a.css', text: 'a{background:url(/img/a.png)}' }).length).toBeGreaterThan(0);
    expect(hits(js('const p="/assets/dollhouse/1x/a.png"')).length).toBeGreaterThan(0);
  });

  it('抓到意外的文件类型与 source map', () => {
    expect(hits({ path: 'assets/a.js.map', text: '{}' }).length).toBeGreaterThan(0);
    expect(hits({ path: 'a.woff2', text: null }).length).toBeGreaterThan(0);
  });

  it('不发布独立音频文件', () => {
    expect(hits({ path: 'assets/audio/bgm-loop.mp3', text: null }).length).toBeGreaterThan(0);
    expect(hits({ path: 'assets/audio/sfx/stamp.mp3', text: null }).length).toBeGreaterThan(0);
    expect(hits({ path: 'assets/audio/a.ogg', text: null }).length).toBeGreaterThan(0);
    expect(hits({ path: 'assets/audio/a.mp3', text: 'ID3' }).length).toBeGreaterThan(0);
  });
});
