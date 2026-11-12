// 声音开关的纯状态机：输入 → 新状态 + 要执行的命令。不碰时钟、存储与音频，便于做性质测试（P28、P30、P31、P32）。
// 开关不记住：每次页面加载都从关开始，只有按开关能打开或关闭（R14.1、R14.3）。

export type SoundStatus = 'off' | 'starting' | 'playing' | 'paused';

export interface SoundState {
  /** off：关；starting：正在起播；playing：在放；paused：切到后台暂停。 */
  status: SoundStatus;
  /** 本次页面已经通过玩家手势取得播放许可。 */
  granted: boolean;
  /** 页面此刻在后台。 */
  hidden: boolean;
  /** 切到后台前正在播放或正在起播：回到前台时才恢复。 */
  resumeOnShow: boolean;
}

export type SoundInput =
  | { type: 'toggle' }
  /** 不在声音开关上的普通玩家手势（能授予用户激活的那几种）。 */
  | { type: 'gesture' }
  | { type: 'hidden' }
  | { type: 'visible' }
  /** 引擎报告：背景音乐已经开始渐入。 */
  | { type: 'started' }
  /** 引擎报告：加载、解码或播放失败，或浏览器拒绝播放。 */
  | { type: 'failed' };

export type SoundCommand =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'pause' }
  | { type: 'resume' };

export interface SoundStep {
  state: SoundState;
  commands: SoundCommand[];
}

/** 开关的按下状态。 */
export const isSwitchOn = (s: SoundState): boolean => s.status !== 'off';

/** 页面加载：永远是关，不产生任何命令，绝不出声。 */
export function initialSound(hidden: boolean): SoundState {
  return { status: 'off', granted: false, hidden, resumeOnShow: false };
}

export function stepSound(s: SoundState, input: SoundInput): SoundStep {
  switch (input.type) {
    case 'toggle':
      // 按开关与普通手势只可能发生在可见的页面上：顺手清掉可能残留的 hidden（例如预加载出来的新标签页，
      // 加载时算后台、激活时没有可靠的 visibilitychange），否则起播成功后会被当成“已在后台”立刻暂停。
      if (s.status === 'off') {
        return { state: { ...s, status: 'starting', granted: true, hidden: false, resumeOnShow: false }, commands: [{ type: 'start' }] };
      }
      return { state: { ...s, status: 'off', hidden: false, resumeOnShow: false }, commands: [{ type: 'stop' }] };
    case 'gesture':
      // 普通手势只记下本次的播放许可（并清掉残留的 hidden），从不起播：打开声音只能按开关。
      return { state: s.granted && !s.hidden ? s : { ...s, granted: true, hidden: false }, commands: [] };
    case 'hidden':
      if (s.status === 'playing' || s.status === 'starting') {
        return { state: { ...s, status: 'paused', hidden: true, resumeOnShow: true }, commands: [{ type: 'pause' }] };
      }
      return { state: { ...s, hidden: true }, commands: [] };
    case 'visible':
      if (s.status === 'paused' && s.resumeOnShow && s.granted) {
        return { state: { ...s, status: 'starting', hidden: false, resumeOnShow: false }, commands: [{ type: 'resume' }] };
      }
      return { state: { ...s, hidden: false }, commands: [] };
    case 'started':
      if (s.status !== 'starting') return { state: s, commands: [] };
      if (s.hidden) return { state: { ...s, status: 'paused', resumeOnShow: true }, commands: [{ type: 'pause' }] };
      return { state: { ...s, status: 'playing' }, commands: [] };
    case 'failed':
      return { state: { ...s, status: 'off', resumeOnShow: false }, commands: s.status === 'off' ? [] : [{ type: 'stop' }] };
  }
}
