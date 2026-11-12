import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';

const SRC = resolve('src');
const SVG_NS = 'http://www.w3.org/2000/svg';
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const TEXT_EXT = new Set([...CODE_EXT, '.css', '.html', '.json', '.svg', '.md', '.txt']);
const DOM_FREE_DIRS = new Set(['domain', 'house', 'persistence', 'i18n']);
/** 声音模块里唯一可以引用 DOM 的文件。 */
const AUDIO_DOM_FILE = 'sound/browserAudio.ts';

/** 把注释替换为空白（保留换行与字符串内容）；可选地把字符串内容也抹成空格。 */
function strip(text: string, blankStrings: boolean): string {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    const d = text[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) {
        out += text[i] === '\n' ? '\n' : ' ';
        i++;
      }
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      out += c;
      i++;
      while (i < n && text[i] !== c) {
        if (text[i] === '\\') {
          out += blankStrings ? '  ' : text.slice(i, i + 2);
          i += 2;
          continue;
        }
        if (c !== '`' && text[i] === '\n') break;
        out += blankStrings && text[i] !== '\n' ? ' ' : text[i];
        i++;
      }
      if (i < n && text[i] === c) {
        out += c;
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const CJK = /[\u3400-\u9fff\uff00-\uffef\u3000-\u303f]/;

export function scanSource(relPath: string, text: string): string[] {
  const issues: string[] = [];
  const ext = extname(relPath);
  const segs = relPath.split('/');
  const top = segs[0] ?? '';
  const isCode = CODE_EXT.has(ext);

  // 外部 URL：所有文本文件。唯一允许 SVG 命名空间。
  const urlSource = isCode ? strip(text, false) : text;
  for (const m of urlSource.matchAll(/https?:\/\/[^\s'"`)<>]+/g)) {
    if (m[0] !== SVG_NS) issues.push(`外部 URL：${m[0]}`);
  }
  if (isCode && /['"`]\/\/[a-z0-9]/i.test(urlSource)) issues.push('协议相对 URL');

  if (!isCode) return issues;

  const code = strip(text, true); // 注释与字符串内容都已抹掉
  const ban = (re: RegExp, label: string) => {
    if (re.test(code)) issues.push(label);
  };

  for (const w of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'dangerouslySetInnerHTML']) {
    ban(new RegExp(`\\b${w}\\b`), `禁止 ${w}`);
  }
  for (const w of ['XMLHttpRequest', 'sendBeacon']) {
    ban(new RegExp(`\\b${w}\\b`), `禁止 ${w}`);
  }
  // fetch：全仓禁止。声音字节内嵌在延迟加载的应用模块里，不需要网络读取。
  const fetches = [...code.matchAll(/\bfetch\b/g)].length;
  if (fetches > 0) issues.push('禁止 fetch');

  const noDom = DOM_FREE_DIRS.has(top) || (top === 'animation' && segs[1] !== 'player.ts') || (top === 'sound' && relPath !== AUDIO_DOM_FILE);
  if (noDom) {
    ban(/(?<![.\w])document\b/, '该目录禁止引用 document');
    ban(/(?<![.\w])window\b/, '该目录禁止引用 window');
    ban(/\bglobalThis\b/, '该目录禁止引用 globalThis');
    // 模块说明符在字符串里，需看保留字符串的版本
    const withStrings = strip(text, false);
    if (/(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)['"]preact(?:\/[^'"]*)?['"]/.test(withStrings)) {
      issues.push('该目录禁止引用 preact');
    }
  }

  if (top === 'domain') {
    ban(/\bDate\s*\.\s*now\b/, 'domain 禁止 Date.now');
    ban(/\bMath\s*\.\s*random\b/, 'domain 禁止 Math.random');
    ban(/\bcrypto\b/, 'domain 禁止 crypto');
  }

  if (top === 'components') {
    if (CJK.test(strip(text, false))) issues.push('components 中不得出现中文，玩家可见中文只能放在 i18n/zh-CN.ts');
  }

  return issues;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (TEXT_EXT.has(extname(p))) out.push(p);
  }
  return out;
}

describe('源码安全扫描：当前仓库', () => {
  const files = walk(SRC);

  it('src/ 下至少有被扫描的文件', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('没有任何违规写法', () => {
    const found: string[] = [];
    for (const f of files) {
      const rel = relative(SRC, f).split(sep).join('/');
      for (const issue of scanSource(rel, readFileSync(f, 'utf8'))) found.push(`${rel}: ${issue}`);
    }
    expect(found).toEqual([]);
  });
});

describe('源码安全扫描：扫描器自检（内存样例）', () => {
  const bad = (path: string, code: string) => scanSource(path, code).length > 0;
  const good = (path: string, code: string) => scanSource(path, code).length === 0;

  it('抓到危险 HTML 写入', () => {
    for (const w of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'dangerouslySetInnerHTML']) {
      expect(bad('components/X.tsx', `el.${w} = x;`)).toBe(true);
    }
  });

  it('抓到网络请求', () => {
    expect(bad('store/a.ts', 'fetch(u);')).toBe(true);
    expect(bad('store/a.ts', 'new XMLHttpRequest();')).toBe(true);
    expect(bad('store/a.ts', 'navigator.sendBeacon(u);')).toBe(true);
  });

  it('抓到外部 URL，但放行 SVG 命名空间', () => {
    expect(bad('components/X.tsx', 'const u = "https://example.com/a";')).toBe(true);
    expect(bad('styles.css', '.a{background:url(https://example.com/a.png)}')).toBe(true);
    expect(good('components/X.tsx', `const ns = "${SVG_NS}";`)).toBe(true);
    expect(good('components/X.tsx', '// see https://example.com in a comment\nconst a = 1;')).toBe(true);
  });

  it('domain/house/persistence/i18n 禁止 document、window、preact', () => {
    for (const dir of ['domain', 'house', 'persistence', 'i18n']) {
      expect(bad(`${dir}/a.ts`, 'const d = document.body;')).toBe(true);
      expect(bad(`${dir}/a.ts`, 'const w = window.innerWidth;')).toBe(true);
      expect(bad(`${dir}/a.ts`, "import { h } from 'preact';")).toBe(true);
      expect(bad(`${dir}/a.ts`, "import { useState } from 'preact/hooks';")).toBe(true);
    }
    expect(good('domain/a.ts', "export type Chore = 'sweep' | 'water' | 'window';")).toBe(true);
  });

  it('animation 中只有 player.ts 可以引用 DOM', () => {
    expect(bad('animation/plan.ts', 'document.title;')).toBe(true);
    expect(bad('animation/events.ts', 'window.scrollTo(0, 0);')).toBe(true);
    expect(good('animation/player.ts', 'document.title; window.scrollTo(0, 0);')).toBe(true);
  });

  it('sound 中只有 browserAudio.ts 可以引用 DOM；fetch 在全仓都禁止', () => {
    expect(bad('sound/engine.ts', 'const w = window.AudioContext;')).toBe(true);
    expect(bad('sound/controller.ts', 'document.hidden;')).toBe(true);
    expect(bad('sound/machine.ts', "import { h } from 'preact';")).toBe(true);
    expect(good('sound/browserAudio.ts', 'const b = window.atob(x); window.setTimeout(f, 1);')).toBe(true);
    expect(bad('sound/browserAudio.ts', 'const r = fetch(url);')).toBe(true);
    expect(bad('sound/browserAudio.ts', 'new XMLHttpRequest();')).toBe(true);
    expect(bad('sound/engine.ts', 'fetch(a);')).toBe(true);
    expect(bad('components/X.tsx', 'fetch(a);')).toBe(true);
  });

  it('domain 禁止 Date.now、Math.random、crypto', () => {
    expect(bad('domain/a.ts', 'Date.now();')).toBe(true);
    expect(bad('domain/a.ts', 'Math.random();')).toBe(true);
    expect(bad('domain/a.ts', 'crypto.randomUUID();')).toBe(true);
    expect(good('house/a.ts', 'const n = 1; // Date.now 只出现在注释里')).toBe(true);
  });

  it('components 中不得出现中文字面量或中文文本', () => {
    expect(bad('components/X.tsx', 'const s = "你好";')).toBe(true);
    expect(bad('components/X.tsx', 'const v = <p>你好</p>;')).toBe(true);
    expect(good('components/X.tsx', '// 中文注释可以\nconst s = "hello";')).toBe(true);
    expect(good('i18n/zh-CN.ts', 'export const hi = "你好";')).toBe(true);
  });
});
