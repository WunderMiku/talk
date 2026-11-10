import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from 'remotion'
import { PAPER, INK, DUST, STAMP, SANS, MONO } from './theme'
import { Img, staticFile } from 'remotion'

const NAVY = '#0B1220'
const BLUE = '#4D6BFE'
const eo = Easing.out(Easing.cubic)

export default function Scene() {
  const f = useCurrentFrame()
  const head = interpolate(f, [0, 16], [0, 1], { extrapolateRight: 'clamp', easing: eo })
  const sub = interpolate(f, [12, 28], [0, 1], { extrapolateRight: 'clamp', easing: eo })
  const tail = interpolate(f, [6, 30], [0, 1], { extrapolateRight: 'clamp', easing: eo })
  const mark = interpolate(f, [16, 34], [0, 1], { extrapolateRight: 'clamp', easing: eo })
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1200px 900px at 80% 8%, #1A2A52 0%, ${NAVY} 55%, #05080F 100%)` }}>
      <div style={{ position: 'absolute', left: 96, top: 300, fontFamily: MONO, fontSize: 26, letterSpacing: 4, color: '#9DB4FF', opacity: head }}>
        DEEPSEEK · 蓝色大肥鱼
      </div>
      <div style={{ position: 'absolute', left: 96, top: 360, width: 720, fontFamily: SANS, fontWeight: 900, fontSize: 104, lineHeight: 1.16, color: '#F7F9FF', letterSpacing: -3, opacity: head, transform: `translateY(${(1 - head) * 40}px)` }}>
        这里<span style={{ position: 'relative', display: 'inline-block' }}>
          没有词典
          <span style={{ position: 'absolute', left: -4, right: -4, bottom: 10, height: 30, background: STAMP, transform: `scaleX(${mark})`, transformOrigin: 'left', zIndex: -1 }} />
        </span>，
        <br />只有一条<br />会查词的鱼。
      </div>
      <div style={{ position: 'absolute', left: 100, top: 900, width: 620, fontFamily: SANS, fontSize: 34, lineHeight: 1.65, color: '#B9C6E6', opacity: sub }}>
        每个词条，都由大肥鱼现场写出。<br />不查库，不抄释义，不糊弄。
      </div>
      <Img
        src={staticFile('ds-girl.png')}
        style={{
          position: 'absolute', right: -90, bottom: -40, width: 660,
          opacity: tail, transform: `translateY(${(1 - tail) * 80}px) scale(${0.94 + 0.06 * tail})`,
          filter: 'drop-shadow(0 30px 60px rgba(0,0,0,.45))'
        }}
      />
    </AbsoluteFill>
  )
}
