import type { StretchId } from './copy';

// 脚は地面に固定し、上半身・肩・肘をそれぞれの関節で動かす。
// 右腕は左腕を反転。位置決めとCSSの回転を別のgにして回転軸を保つ。
function Arm({ right = false }: { right?: boolean }) {
  return (
    <g transform={right ? 'translate(62 62) scale(-1 1)' : 'translate(38 62)'}>
      <g className={`hi-picto-arm hi-arm-${right ? 'r' : 'l'}`}>
        <path d="M0 0l-9 22" />
        <g transform="translate(-9 22)">
          <g className="hi-picto-forearm"><path d="M0 0l-2 20" /></g>
        </g>
      </g>
    </g>
  );
}

// 肩→肘→手首→肩の3辺をつなぐ。手首も肘に追従し、手のひらは肩に接する。
// 同じパスの頂点を共有することで、動作中も3辺の継ぎ目を離さない。
function ShoulderArm({ right = false }: { right?: boolean }) {
  return (
    <g transform={right ? 'translate(54 68) scale(-1 1)' : 'translate(46 68)'}>
      <g className="hi-picto-shoulder-guide" transform="translate(0 -2) scale(.88)" strokeWidth="1.5" opacity=".4">
        <path d="M-20 22C-39 22-47-5-34-21m-1 7 1-7-7 2" />
      </g>
      <path className="hi-picto-shoulder-arm" d="M0 0L-22.88 7.68L-9.65 -7.13Z" strokeWidth="6" />
    </g>
  );
}

export function Pictogram({ kind }: { kind: StretchId }) {
  return (
    <svg className={`hi-picto hi-picto-${kind}`} width="128" height="136" viewBox="0 0 128 136" aria-hidden="true">
      {/* 腕を横に開く途中も切れないよう、左右に14pxずつ余白を取る。 */}
      <g transform="translate(14 0)">
        <ellipse cx="50" cy="130" rx="27" ry="3" fill="currentColor" opacity=".10" />
        <g fill="none" stroke="currentColor" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round">
          <path className="hi-picto-legs" d="M50 94l-15 29m15-29 15 29" />
          <g className="hi-picto-body">
            <path d="M50 53v42" />
            <g className="hi-picto-shoulders">
              {kind === 'shoulder'
                ? <><ShoulderArm /><ShoulderArm right /></>
                : <><path d="M38 62h24" /><Arm /><Arm right /></>}
            </g>
            <circle cx="50" cy="35" r="18" fill="currentColor" stroke="none" />
            <g className="hi-picto-face" stroke="var(--hi-bg)" strokeWidth="2" fill="none"><path d="M39 32q3-4 6 0m10 0q3-4 6 0M44 42q6 7 12 0" /></g>
          </g>
        </g>
        {kind === 'reach' && <g className="hi-picto-rays" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m16 17-5-7m73 7 5-7M50 9V2" /></g>}
      </g>
    </svg>
  );
}
