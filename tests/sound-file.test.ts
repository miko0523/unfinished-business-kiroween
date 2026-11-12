import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EMBEDDED_AUDIO } from '../src/sound/embeddedAudio';
import { BGM_PADDING, BGM_PRIMING, BGM_RATE, BGM_SECONDS, BGM_UNTRIMMED_SECONDS, BGM_VALID_FRAMES, loopWindow } from '../src/sound/loop';

// 直接解码公开应用模块里内嵌的背景音乐，解析第一帧里的 Xing/Info 与 LAME 头，
// 核对 loop.ts 的常数就是这份真实字节的结构。素材再被换掉时，这里先失败。

interface MpegInfo {
  rate: number;
  frames: number;
  samplesPerFrame: number;
  delay: number;
  padding: number;
}

const EXPECTED_AUDIO_SHA256: Record<keyof typeof EMBEDDED_AUDIO, string> = {
  'assets/audio/bgm-loop.mp3': '666389a7bfa3fb28de2a9e1e9be929d48703f9c20b02cc694989d5225ee5d214',
  'assets/audio/sfx/lamp.mp3': 'b99f9837852c6c69b8e110cf3db4062d4863e6325182b2a1c2747246e19ed0de',
  'assets/audio/sfx/lantern.mp3': 'da42fd8cc6b035c3c467c5994284cfcc0cc1cf0b449bdab760f22d6673ded13b',
  'assets/audio/sfx/move-in.mp3': 'a44d26195c6a71e1324ea12ec4d133d793931df8ce7731a637a5ebbbf14de932',
  'assets/audio/sfx/stamp.mp3': '0b45114e633b1a71888889b90abcce7f528a6354f0b762d76d20515aa00783f4',
  'assets/audio/sfx/sweep.mp3': '2705220a4e3430288a70335db73e60ccec6392517dd18110567e161f5be4926a',
  'assets/audio/sfx/water.mp3': '412f420183c636b8e5a48b396330a909c0ff1a0d73c23bb9a25329dfc8b1a70a',
  'assets/audio/sfx/wipe.mp3': 'd20507624ac604b10244fc25efa170f7716c4b6d9356eeb189e97c4d3b17265f',
};

function readMpegInfo(b: Buffer): MpegInfo {
  let pos = 0;
  if (b.toString('latin1', 0, 3) === 'ID3') {
    const size = ((b[6]! & 0x7f) << 21) | ((b[7]! & 0x7f) << 14) | ((b[8]! & 0x7f) << 7) | (b[9]! & 0x7f);
    pos = 10 + size + (b[5]! & 0x10 ? 10 : 0);
  }
  while (pos + 1 < b.length && !(b[pos] === 0xff && (b[pos + 1]! & 0xe0) === 0xe0)) pos++;
  if (pos + 4 > b.length) throw new Error('embedded BGM: no MPEG frame sync found');
  const versionBits = (b[pos + 1]! >> 3) & 3; // 3 = MPEG-1
  const layerBits = (b[pos + 1]! >> 1) & 3; // 1 = Layer III
  expect(versionBits).toBe(3);
  expect(layerBits).toBe(1);
  const rate = [44100, 48000, 32000][(b[pos + 2]! >> 2) & 3]!;
  const mono = b[pos + 3]! >> 6 === 3;
  const tag = pos + 4 + (mono ? 17 : 32);
  if (tag + 12 > b.length) throw new Error('embedded BGM: truncated before Xing/Info header');
  expect(['Xing', 'Info']).toContain(b.toString('latin1', tag, tag + 4));
  const flags = b.readUInt32BE(tag + 4);
  expect(flags & 1).toBe(1); // 有帧数字段
  const frames = b.readUInt32BE(tag + 8);
  let lame = tag + 12;
  if (flags & 2) lame += 4;
  if (flags & 4) lame += 100;
  if (flags & 8) lame += 4;
  // LAME 扩展：9 字节编码器名之后第 12 字节起，3 字节里前 12 位是预热、后 12 位是补齐。
  const d = lame + 21;
  if (d + 3 > b.length) throw new Error('embedded BGM: truncated before LAME delay/padding');
  const delay = (b[d]! << 4) | (b[d + 1]! >> 4);
  const padding = ((b[d + 1]! & 0x0f) << 8) | b[d + 2]!;
  return { rate, frames, samplesPerFrame: 1152, delay, padding };
}

describe('背景音乐文件与循环区间常数一致', () => {
  const info = readMpegInfo(Buffer.from(EMBEDDED_AUDIO['assets/audio/bgm-loop.mp3'], 'base64'));

  it('采样率、预热、补齐、有效采样都与 loop.ts 相同', () => {
    expect(info.rate).toBe(BGM_RATE);
    expect(info.delay).toBe(BGM_PRIMING);
    expect(info.padding).toBe(BGM_PADDING);
    expect(info.frames * info.samplesPerFrame - info.delay - info.padding).toBe(BGM_VALID_FRAMES);
  });

  it('按文件算出的两种解码时长分别得到整段循环与跳过填充的循环', () => {
    const valid = (info.frames * info.samplesPerFrame - info.delay - info.padding) / info.rate;
    const untrimmed = (info.frames * info.samplesPerFrame) / info.rate;
    expect(valid).toBe(BGM_SECONDS);
    expect(untrimmed).toBe(BGM_UNTRIMMED_SECONDS);
    expect(loopWindow(valid)).toEqual({ kind: 'whole', start: 0, end: valid });
    const w = loopWindow(untrimmed);
    expect(w.kind).toBe('trimmed');
    expect(w.start).toBeCloseTo(info.delay / info.rate, 9);
    expect(w.end - w.start).toBeCloseTo(valid, 9);
  });
});

describe('内嵌音频与发起人验收过的终版逐字节一致', () => {
  it('八份音频的 SHA-256 全部匹配', () => {
    expect(Object.keys(EMBEDDED_AUDIO).sort()).toEqual(Object.keys(EXPECTED_AUDIO_SHA256).sort());
    for (const [path, expected] of Object.entries(EXPECTED_AUDIO_SHA256)) {
      const bytes = Buffer.from(EMBEDDED_AUDIO[path as keyof typeof EMBEDDED_AUDIO], 'base64');
      expect(createHash('sha256').update(bytes).digest('hex'), path).toBe(expected);
    }
  });
});
