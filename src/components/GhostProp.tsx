import type { PropKind } from '../house/ghostShape';

// 道具都画在身体右侧的外面一栏（viewBox 坐标 x ≥ 104），做家务时身体向左让出 TOOL_SHIFT 个单位。
// 道具已放大一档并外移；靠道具那一侧的手由样式整只移到握持点（见 ghost-motion.css 里的 hand-*）。
// 具体的最大活动范围见 animation/choreography.ts 的 REACH。

export function Prop({ kind }: { kind: PropKind }) {
  switch (kind) {
    case 'broom':
      return (
        <g>
          <rect x="123.5" y="52" width="3" height="108" rx="1.5" fill="#8B6B43" />
          <path d="M116 150 L134 150 L136 168 L114 168 Z" fill="#D9B35C" stroke="#7A5A00" stroke-width="2" stroke-linejoin="round" />
        </g>
      );
    case 'can':
      return (
        <g>
          <path d="M114 96 C114 88 125 88 125 96" fill="none" stroke="#2C5B7A" stroke-width="2.4" stroke-linecap="round" />
          <rect x="110" y="96" width="21" height="17" rx="4" fill="#7FB3D5" stroke="#2C5B7A" stroke-width="2" />
          <path d="M131 102 L135 97" stroke="#2C5B7A" stroke-width="3" stroke-linecap="round" />
        </g>
      );
    case 'cloth':
      return <rect x="113" y="68" width="18" height="13" rx="3.5" fill="#F3C9CF" stroke="#B0707A" stroke-width="1.8" />;
    case 'eraser':
      return <rect x="111" y="106" width="20" height="14" rx="3.5" fill="#F2A7B8" stroke="#A04460" stroke-width="2" />;
    case 'suitcase':
      return (
        <g>
          <rect x="110" y="128" width="24" height="20" rx="4" fill="#B5784A" stroke="#6B4423" stroke-width="2" />
          <path d="M116 128 V123 H128 V128" fill="none" stroke="#6B4423" stroke-width="2" />
        </g>
      );
    case 'none':
    default:
      return null;
  }
}
