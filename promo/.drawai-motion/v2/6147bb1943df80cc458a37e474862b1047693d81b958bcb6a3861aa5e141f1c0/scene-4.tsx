import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame, Easing, Img, staticFile } from 'remotion'
import { PAPER, INK, DUST, SANS, MONO } from './theme'
const eo = Easing.out(Easing.cubic)

const CARDS = [
  { img: 'translator.jpg', label: '五种语气翻译', x: 80, y: 500 },
  { img: 'theme-salon.jpg', label: '四套主题', x: 572, y: 556 },
  { img: 'settings-data.jpg', label: '本地缓存 · 离线可查', x: 316, y: 1236 },
]

export default function Scene() {
  const f = useCurrentFrame()
  const h = interpolate(f, [0, 16], [0, 1], { extrapolateRight: 'clamp', easing: eo })
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      <AbsoluteFill style={{ backgroundImage: 'repeating-linear-gradient(45deg, rgba(20,20,20,.05) 0 1px, transparent 1px 14px)' }} />
      <div style={{ position: 'absolute', left: 96, top: 150, fontFamily: MONO, fontSize: 24, letterSpacing: 4, color: DUST, opacity: h }}>EVERYTHING IN ONE PLACE</div>
      <div style={{ position: 'absolute', left: 96, top: 206, fontFamily: SANS, fontWeight: 900, fontSize: 96, letterSpacing: -3, color: INK, opacity: h }}>而且不止查词。</div>
      {CARDS.map((c, i) => {
        const p = interpolate(f, [8 + i * 10, 26 + i * 10], [0, 1], { extrapolateRight: 'clamp', easing: eo })
        return (
          <div key={c.img} style={{ position: 'absolute', left: c.x, top: c.y + (1 - p) * 70, width: 404, padding: 12, background: '#FFFDF6', border: '2px solid rgba(20,20,20,.75)', boxShadow: '14px 16px 0 rgba(20,20,20,.12)', opacity: p, transform: `rotate(${(1 - p) * (i === 1 ? 2 : -2)}deg)` }}>
            <Img src={staticFile(c.img)} style={{ width: '100%', height: 520, objectFit: 'cover', objectPosition: 'top center', display: 'block' }} />
            <div style={{ marginTop: 12, fontFamily: SANS, fontSize: 28, fontWeight: 800, color: INK }}>{c.label}</div>
          </div>
        )
      })}
    </AbsoluteFill>
  )
}
