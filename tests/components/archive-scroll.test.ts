import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = (name: string) => readFileSync(resolve(__dirname, '../../src', name), 'utf8');
const rule = (src: string, selector: string) => src.match(new RegExp(`\\n${selector.replace('.', '\\.')} \\{[^}]*\\}`))![0];

describe('纪念册在 iPhone Safari 上能整页上下划', () => {
  it('书页只裁圆角，不留 overflow: hidden 当最终值（不形成困住手势的滚动容器）', () => {
    const book = rule(css('archive.css'), '.book');
    const values = [...book.matchAll(/overflow:\s*([a-z]+);/g)].map((m) => m[1]);
    expect(values.at(-1)).toBe('clip');
  });

  it('纪念册明确允许上下拖动和双指缩放', () => {
    expect(rule(css('archive.css'), '.archive')).toMatch(/touch-action:\s*pan-y pinch-zoom;/);
  });

  it('雾里朋友的画框同样用 clip 收尾', () => {
    const pic = rule(css('collection.css'), '.reveal-picture');
    const values = [...pic.matchAll(/overflow:\s*([a-z]+);/g)].map((m) => m[1]);
    expect(values.at(-1)).toBe('clip');
  });
});
