import { useId } from 'preact/hooks';

export function LanternCrown() {
  return <path class="lantern-crown" d="M70 21 L74 30 L84 31 L76 38 L78 48 L70 43 L62 48 L64 38 L56 31 L66 30 Z" fill="#FFDA79" stroke="#FFFFFF" stroke-width="3" stroke-linejoin="round" />;
}

/** The handle meets the right hand; the warm yellow lamp sits outside the body. */
export function CarriedLantern() {
  const uid = useId();
  const glow = `lantern-glow-${uid}`;
  return (
    <g class="carried-lantern">
      <defs>
        {/* Feathered pale warm yellow: strongest at the flame, no visible edge anywhere. */}
        <radialGradient id={glow}>
          <stop offset="0" stop-color="#FFF3C0" stop-opacity=".62" />
          <stop offset=".3" stop-color="#FFEAA4" stop-opacity=".4" />
          <stop offset=".6" stop-color="#FFE08E" stop-opacity=".15" />
          <stop offset=".85" stop-color="#FFDC84" stop-opacity=".04" />
          <stop offset="1" stop-color="#FFDC84" stop-opacity="0" />
        </radialGradient>
      </defs>
      <ellipse class="lantern-halo" cx="138" cy="146" rx="34" ry="38" fill={`url(#${glow})`} />
      <path d="M125 128 Q138 111 138 132" fill="none" stroke="#76512D" stroke-width="2" />
      <path d="M133 131 H143 L146 138 V151 Q146 158 138 158 Q130 158 130 151 V138 Z" fill="#FFDA79" stroke="#8A5E2F" stroke-width="2" />
      <path d="M138 139 Q130 149 138 152 Q144 149 138 139 Z" fill="#ED943C" />
      <path d="M133 132 H143 M133 158 H143" stroke="#FFF0BB" stroke-width="2" />
    </g>
  );
}
