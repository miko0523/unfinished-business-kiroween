// 背景音乐的循环区间（R14.6）。纯函数，只依赖解码后的时长。
//
// 素材已换为 0.8 倍速版本（第三轮）。bgm-loop.mp3 的 LAME 头：44.1 kHz，576 个预热采样 + 7756088 个有效采样
// + 904 个尾部补齐（共 6734 帧 × 1152）。有效部分约 175.875 秒，就是剪好的那一圈。按 LAME 头去掉填充的解码器
// （Chromium 实测如此）给出约 175.875 秒，整段循环即可；没有去填充的解码器给出约 175.909 秒，
// 循环区间要跳过开头的预热采样和结尾的补齐。tests/sound-file.test.ts 直接读文件的 LAME 头核对这几个数。

export const BGM_RATE = 44100;
export const BGM_PRIMING = 576;
export const BGM_VALID_FRAMES = 7756088;
export const BGM_PADDING = 904;
export const BGM_SECONDS = BGM_VALID_FRAMES / BGM_RATE;
export const BGM_UNTRIMMED_SECONDS = (BGM_PRIMING + BGM_VALID_FRAMES + BGM_PADDING) / BGM_RATE;
/** 时长比较的容差：2 毫秒，远小于两种情况的差（约 34 毫秒）。 */
const TOLERANCE = 0.002;

export interface LoopWindow {
  kind: 'whole' | 'trimmed';
  /** 循环起点与起播位置（秒）。 */
  start: number;
  /** 循环终点（秒）；whole 时等于解码时长。 */
  end: number;
}

export function loopWindow(decodedSeconds: number): LoopWindow {
  if (Math.abs(decodedSeconds - BGM_UNTRIMMED_SECONDS) <= TOLERANCE) {
    const start = BGM_PRIMING / BGM_RATE;
    return { kind: 'trimmed', start, end: start + BGM_SECONDS };
  }
  // 已去填充（≈175.875 秒），或长度对不上已知结构：循环整段，不猜。
  return { kind: 'whole', start: 0, end: decodedSeconds };
}
