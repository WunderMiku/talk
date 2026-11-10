import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame, Easing, Img, staticFile } from 'remotion'
import { PAPER, INK, DUST, STAMP, SANS, MONO } from './theme'
const eo = Easing.out(Easing.cubic)

export default function Scene() {
  const f = useCurrentFrame()
  const up = interpolate(f, [0, 20], [0, 1], { extrapolateRight: 'clamp', easing: eo })
  const scroll = interpolate(f, [12, 96], [0, 1], { extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) })
  const labels = [0, 1, 2].map((i) => interpolate(f, [24 + i * 18, 40 + i * 18], [0, 1], { extrapolateRight: 'clamp', easing: eo }))
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      <AbsoluteFill style={{ backgroundImage: 'repeating-linear-gradient(45deg, rgba(20,20,20,.05) 0 1px, transparent 1px 14px)' }} />
      <div style={{ position: 'absolute', left: 232, transform: `scale(${1 + 0.12 * scroll})`, transformOrigin: '50% 42%', top: 470 + (1 - up) * 120, width: 652, height: 1394, borderRadius: 72, background: '#0C0C0C', padding: 14, boxShadow: '0 60px 120px rgba(10,14,30,.35)' }}>
        <div style={{ position: 'relative', width: 624, height: 1366, borderRadius: 58, overflow: 'hidden', background: '#F6F1E7' }}>
          <Img src={staticFile('word-long.jpg')} style={{ position: 'absolute', left: 0, top: 0, width: '100%', transform: `translateY(${-980 * scroll}px)` }} />
        </div>
      </div>
      <div style={{ position: 'absolute', left: 96, right: 96, top: 190, textAlign: 'center', fontFamily: SANS, fontSize: 42, fontWeight: 700, color: '#2C2820', opacity: interpolate(f, [10, 26], [0, 1], { extrapolateRight: 'clamp' }) }}>
        每一条都是现写的，<span style={{ background: STAMP, padding: '0 8px' }}>不是抄的</span>。
      </div>
    </AbsoluteFill>
  )
}
