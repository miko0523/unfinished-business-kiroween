import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';

// 16.1：design.md 的每条属性（P1 至 P27；阶段 18 起增加 P28 至 P33）各有一个带标签的属性测试。检查三件事：
//   1. 标签 `Feature: unfinished-business, Property N: <标题>` 的个数等于 design.md 的属性条数，编号从 1 起连续各一个，标题与 design.md 逐字相同；
//   2. 每个带标签的测试块里都有 fc.assert，且显式写出的 numRuns 全部不少于 100（至少有一个）；
//   3. tests/ 与 e2e/ 里没有 skip、todo、only。
// 这是对“写法”的静态检查：它保证每条属性有一个真实的、轮数足够的 fast-check 测试，不保证属性本身写得对。

const MIN_RUNS = 100;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : ['.ts', '.tsx'].includes(extname(p)) ? [p] : [];
  });
}

/** 从 text[open] 这个“(”起，找到与之配对的“)”；跳过字符串、模板字符串和注释。 */
export function matchingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i]!;
    const d = text[i + 1];
    if (c === '/' && d === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      i = text.indexOf('*/', i + 2);
      if (i < 0) return -1;
      i += 1;
    } else if (c === '"' || c === "'" || c === '`') {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++;
    } else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

export interface Tag {
  file: string;
  n: number;
  title: string;
  block: string;
}

const TAG = /Feature: unfinished-business, Property (\d+): ([^'"`\n]+)/g;
const CALL = /\b(?:describe|it|test)\s*\(\s*$/;

export function findTags(file: string, text: string): Tag[] {
  const tags: Tag[] = [];
  for (const m of text.matchAll(TAG)) {
    const at = m.index!;
    // 标签是某个 describe/it/test 调用的第一个参数：向前找到那个“(”。
    const quote = Math.max(text.lastIndexOf("'", at), text.lastIndexOf('"', at), text.lastIndexOf('`', at));
    const before = text.slice(0, quote);
    const call = CALL.exec(before);
    let block = '';
    if (call) {
      const open = before.lastIndexOf('(');
      const close = matchingParen(text, open);
      block = close > open ? text.slice(open, close + 1) : '';
    }
    tags.push({ file, n: Number(m[1]), title: m[2]!.trim(), block });
  }
  return tags;
}

const root = resolve('tests');
const testFiles = walk(root).filter((f) => !f.endsWith(`${sep}property-coverage.test.ts`));
const designTitles = new Map<number, string>(
  [...readFileSync(resolve('.kiro/specs/unfinished-business/design.md'), 'utf8').matchAll(/^### Property (\d+): (.+)$/gm)].map((m) => [Number(m[1]), m[2]!.trim()]),
);
const tags = testFiles.flatMap((f) => findTags(relative(resolve('.'), f), readFileSync(f, 'utf8')));
/** design.md 的属性条数：阶段 16 收口时为 27，阶段 18 声音加了 6 条。只增不减，编号必须连续。 */
const PROPERTY_COUNT = designTitles.size;
const MIN_PROPERTIES = 33;

describe('16.1 属性测试覆盖清单', () => {
  it(`design.md 列出从 P1 起连续的属性，至少 ${MIN_PROPERTIES} 条`, () => {
    expect(PROPERTY_COUNT).toBeGreaterThanOrEqual(MIN_PROPERTIES);
    expect([...designTitles.keys()]).toEqual(Array.from({ length: PROPERTY_COUNT }, (_, i) => i + 1));
  });

  it('带标签的测试个数等于 design 的属性条数，编号各一个', () => {
    expect(tags.map((t) => t.n).sort((a, b) => a - b)).toEqual(Array.from({ length: PROPERTY_COUNT }, (_, i) => i + 1));
  });

  it('每个标签的标题与 design.md 逐字相同', () => {
    expect(tags.filter((t) => designTitles.get(t.n) !== t.title).map((t) => `${t.file}: Property ${t.n} 标题应为“${designTitles.get(t.n)}”，实为“${t.title}”`)).toEqual([]);
  });

  it(`每个带标签的测试都有 fc.assert，且显式 numRuns 不少于 ${MIN_RUNS}`, () => {
    const problems: string[] = [];
    for (const t of tags) {
      const runs = [...t.block.matchAll(/numRuns:\s*(\d+)/g)].map((m) => Number(m[1]));
      if (t.block === '') problems.push(`${t.file}: Property ${t.n} 找不到所属的 describe/it`);
      else if (!/\bfc\.assert\(/.test(t.block)) problems.push(`${t.file}: Property ${t.n} 没有 fc.assert`);
      else if (runs.length === 0) problems.push(`${t.file}: Property ${t.n} 没有显式 numRuns`);
      else if (runs.some((n) => n < MIN_RUNS)) problems.push(`${t.file}: Property ${t.n} 的 numRuns ${runs.join('、')} 少于 ${MIN_RUNS}`);
    }
    expect(problems).toEqual([]);
  });

  it('tests/ 与 e2e/ 里没有 skip、todo、only', () => {
    const files = [...testFiles, ...walk(resolve('e2e'))];
    const found = files.flatMap((f) => {
      const text = readFileSync(f, 'utf8');
      return [...text.matchAll(/\b(?:it|test|describe)\s*\.\s*(?:skip|skipIf|todo|only|fixme)\b|\bx(?:it|describe)\s*\(/g)].map((m) => `${relative(resolve('.'), f)}: ${m[0]}`);
    });
    expect(found).toEqual([]);
  });

  describe('检查器自检（内存样例）', () => {
    const sample = (body: string) => findTags('x.ts', body);
    it('找到 describe 与 it 里的标签，并取到整块内容', () => {
      const ok = "describe('Feature: unfinished-business, Property 3: 标题', () => { it('a', () => { fc.assert(fc.property(x, () => {}), { numRuns: 100 }); }); });";
      const [t] = sample(ok);
      expect(t).toMatchObject({ n: 3, title: '标题' });
      expect(t!.block).toContain('numRuns: 100');
      const [u] = sample("it('Feature: unfinished-business, Property 4: 标题', () => { fc.assert(p, { numRuns: 99 }); });");
      expect([...u!.block.matchAll(/numRuns:\s*(\d+)/g)].map((m) => Number(m[1]))).toEqual([99]);
    });
    it('括号配对不被字符串、注释里的括号带偏', () => {
      const text = "f('a)', /* ) */ g(1)) // )\n h(";
      expect(text.slice(1, matchingParen(text, 1) + 1)).toBe("('a)', /* ) */ g(1))");
    });
    it('不带标签、写成别的格式的不被计入', () => {
      expect(sample("it('Property 3 示例', () => {});")).toEqual([]);
      expect(sample("it('Feature: unfinished-business, Property 7 / 8: x', () => {});")).toEqual([]);
    });
  });
});
