import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from 'remotion'
import { PAPER, INK, DUST, STAMP, SANS, MONO } from './theme'
const eo = Easing.out(Easing.cubic)
const WORD = 'serendipity'
const LINES = [
  '偶然发生的美好发现；机缘巧合',
  '意外得到珍视之物的运气',
  '善于在偶然中发现价值的能力',
]

export default function Scene() {
  const f = useCurrentFrame()
  const n = Math.max(0, Math.min(WORD.length, Math.floor((f - 6) / 2.6)))
  const typed = interpolate(f, [34, 46], [0, 1], { extrapolateRight: 'clamp', easing: eo })
  const caption = interpolate(f, [10, 26], [0, 1], { extrapolateRight: 'clamp', easing: eo })
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      <AbsoluteFill style={{ backgroundImage: 'repeating-linear-gradient(45deg, rgba(20,20,20,.05) 0 1px, transparent 1px 14px)' }} />
      <div style={{ position: 'absolute', left: 96, top: 470, display: 'flex', alignItems: 'center', gap: 14, fontFamily: MONO, fontSize: 24, letterSpacing: 4, color: DUST }}>
        <span style={{ width: 10, height: 10, borderRadius: 99, background: '#D8402F', opacity: 0.55 + 0.45 * Math.abs(Math.sin(f / 9)) }} />
        AI 正在生成词条
      </div>
      <div style={{ position: 'absolute', left: 92, top: 600, fontFamily: SANS, fontWeight: 900, fontSize: 118, letterSpacing: -4, color: INK }}>
        {WORD.slice(0, n)}
        <span style={{ display: 'inline-block', width: 5, height: 92, background: '#D8402F', marginLeft: 8, verticalAlign: -6, opacity: Math.floor(f / 8) % 2 ? 0.25 : 1 }} />
      </div>
      <div style={{ position: 'absolute', left: 100, top: 800, fontFamily: MONO, fontSize: 30, color: DUST, opacity: typed }}>/ ˌser.ənˈdɪp.ə.ti / · n.</div>

      {LINES.map((t, i) => {
        const at = 46 + i * 16
        const q = interpolate(f, [at, at + 12], [0, 1], { extrapolateRight: 'clamp', easing: eo })
        const sweep = interpolate(f, [at + 2, at + 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: eo })
        return (
          <div key={i} style={{ position: 'absolute', left: 96, top: 900 + i * 96, width: 800, opacity: q, transform: `translateY(${(1 - q) * 18}px)` }}>
            <span style={{ fontFamily: MONO, fontSize: 22, color: DUST, marginRight: 16 }}>{'0' + (i + 1)}</span>
            <span style={{ fontFamily: SANS, fontSize: 36, fontWeight: 700, color: INK, backgroundImage: `linear-gradient(${STAMP},${STAMP})`, backgroundRepeat: 'no-repeat', backgroundSize: `${sweep * 100}% 100%`, padding: '2px 4px' }}>{t}</span>
          </div>
        )
      })}
      <div style={{ position: 'absolute', left: 96, top: 1210, fontFamily: MONO, fontSize: 22, letterSpacing: 2, color: DUST, opacity: interpolate(f, [94, 106], [0, 1], { extrapolateRight: 'clamp' }) }}>
        已生成 3 个义项 · 音标 · 同根词 · 例句
      </div>
      <div style={{ position: 'absolute', left: 96, right: 96, top: 1680, textAlign: 'center', fontFamily: SANS, fontSize: 42, fontWeight: 700, color: '#2C2820', opacity: caption }}>
        释义 · 音标 · 例句，<span style={{ background: STAMP, padding: '0 8px' }}>一条条写出来</span>。
      </div>
    </AbsoluteFill>
  )
}
