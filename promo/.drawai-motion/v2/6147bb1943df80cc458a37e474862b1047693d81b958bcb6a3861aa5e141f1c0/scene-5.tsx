import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from 'remotion'
import { STAMP, SANS, MONO } from './theme'
import { Img, staticFile } from 'remotion'
const NAVY = '#0B1220'
const eo = Easing.out(Easing.cubic)

export default function Scene() {
  const f = useCurrentFrame()
  const a = interpolate(f, [0, 18], [0, 1], { extrapolateRight: 'clamp', easing: eo })
  const b = interpolate(f, [10, 28], [0, 1], { extrapolateRight: 'clamp', easing: eo })
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1200px 900px at 80% 8%, #1A2A52 0%, ${NAVY} 55%, #05080F 100%)` }}>
      <div style={{ position: 'absolute', left: 96, top: 620, fontFamily: SANS, fontWeight: 900, fontSize: 220, letterSpacing: -12, color: '#F7F9FF', opacity: a, transform: `translateY(${(1 - a) * 60}px)` }}>
        talk<span style={{ color: STAMP }}>.</span>
      </div>
      <div style={{ position: 'absolute', left: 100, top: 950, fontFamily: SANS, fontSize: 52, fontWeight: 600, color: '#C9D4EF', opacity: b }}>不是词典，是会写词条的 AI。</div>
      <div style={{ position: 'absolute', left: 96, top: 1120, padding: '22px 34px', border: '2px solid rgba(255,255,255,.35)', color: '#E8EEFC', fontFamily: MONO, fontSize: 30, letterSpacing: 2, opacity: b }}>wundermiku.github.io/talk</div>
      <Img src={staticFile('ds-girl.png')} style={{ position: 'absolute', right: -60, bottom: -150, width: 520, opacity: b * 0.92 }} />
      <div style={{ position: 'absolute', left: 96, bottom: 190, fontFamily: MONO, fontSize: 22, letterSpacing: 2, color: '#8194BB', opacity: b }}>TALK · 英语查词</div>
      <div style={{ position: 'absolute', left: 96, bottom: 152, fontFamily: MONO, fontSize: 22, letterSpacing: 2, color: '#C7D3F0', opacity: b }}>MADE WITH · dsh-drawai</div>
      <div style={{ position: 'absolute', left: 96, bottom: 108, width: 720, fontFamily: MONO, fontSize: 15, lineHeight: 1.5, letterSpacing: 0.5, color: '#5F719C', opacity: b }}>
        角色 · DeepSeek 娘（genderswapai.com，CC BY-NC-SA 4.0）
      </div>
    </AbsoluteFill>
  )
}
