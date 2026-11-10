import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from 'remotion'
import { PAPER, INK, DUST, SANS, MONO } from './theme'
const eo = Easing.out(Easing.cubic)
const RED = '#D8402F'

export default function Scene() {
  const f = useCurrentFrame()
  const h = interpolate(f, [0, 16], [0, 1], { extrapolateRight: 'clamp', easing: eo })
  const cards = interpolate(f, [8, 30], [0, 1], { extrapolateRight: 'clamp', easing: eo })
  const strike = interpolate(f, [26, 46], [0, 1], { extrapolateRight: 'clamp', easing: eo })
  const note = interpolate(f, [36, 56], [0, 1], { extrapolateRight: 'clamp', easing: eo })
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      <AbsoluteFill style={{ backgroundImage: 'repeating-linear-gradient(45deg, rgba(20,20,20,.05) 0 1px, transparent 1px 14px)' }} />
      <div style={{ position: 'absolute', left: 96, top: 250, fontFamily: MONO, fontSize: 24, letterSpacing: 4, color: DUST, opacity: h }}>THE PROBLEM</div>
      <div style={{ position: 'absolute', left: 96, top: 310, fontFamily: SANS, fontWeight: 900, fontSize: 112, lineHeight: 1.14, color: INK, letterSpacing: -3, opacity: h, transform: `translateY(${(1 - h) * 36}px)` }}>
        词典是别人<br />写好的。
      </div>
      <div style={{ position: 'absolute', left: 96, top: 760, display: 'flex', gap: 26, opacity: cards, transform: `translateY(${(1 - cards) * 30}px)` }}>
        {['预置词条', '固定释义', '几年不更新'].map((t) => (
          <div key={t} style={{ width: 250, height: 150, border: '2px solid rgba(20,20,20,.55)', background: '#FFFDF6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SANS, fontSize: 30, fontWeight: 700, color: INK }}>{t}</div>
        ))}
      </div>
      <div style={{ position: 'absolute', left: 90, top: 918, height: 5, width: 760 * strike, background: RED, transform: 'rotate(-1.4deg)' }} />
      <div style={{ position: 'absolute', left: 96, top: 1090, fontFamily: SANS, fontSize: 46, lineHeight: 1.55, color: '#4A4438', fontWeight: 600, opacity: note }}>
        可你的问题，<br />它<span style={{ background: RED, color: '#fff', padding: '0 10px' }}>从来没写过</span>。
      </div>
    </AbsoluteFill>
  )
}
