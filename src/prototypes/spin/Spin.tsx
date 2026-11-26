import { useEffect, useRef, useState } from 'react'

const DOTS = 24 // shapes on the ring (and detents per turn)
const SPIRAL_TURNS = 5 // Drops lays small dots on a big spiral of this many rounds instead of a ring
const spiralTaper = (u: number) => Math.pow(Math.sin(Math.PI * u), 0.5) // dots shrink and fade at both ends of the spiral
const SCALE = [0, 2, 4, 7, 9] // major pentatonic: every combination sounds consonant
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

type LayerName = 'pad' | 'air' | 'ocean' | 'sub' | 'vinyl'
const LAYERS: LayerName[] = ['pad', 'air', 'ocean', 'sub', 'vinyl']
const LAYER_LABELS: Record<LayerName, string> = { pad: 'Pad', air: 'Air', ocean: 'Ocean', sub: 'Sub hum', vinyl: 'Vinyl' }
const DEFAULT_LEVEL = 0.6 // a layer's volume is 0 to 1; at this level it plays at the loudness it was designed for
const LEVELS_KEY = 'spin-levels'
const readLevels = (): Record<LayerName, number> => {
  const d = { pad: DEFAULT_LEVEL, air: DEFAULT_LEVEL, ocean: DEFAULT_LEVEL, sub: DEFAULT_LEVEL, vinyl: DEFAULT_LEVEL }
  try {
    const j = JSON.parse(localStorage.getItem(LEVELS_KEY) || '{}')
    for (const n of LAYERS) if (typeof j[n] === 'number' && j[n] >= 0 && j[n] <= 1) d[n] = j[n]
  } catch { /* private mode */ }
  return d
}
type AudioBits = { ctx: AudioContext; master: GainNode; fb: GainNode; bus: Record<LayerName, GainNode> } // fb = how much of each echo feeds the next; bus = one volume knob per layer
type Voice = 'bowl' | 'kalimba' | 'marimba' | 'drops' | 'ripple'
const VOICES: Voice[] = ['bowl', 'kalimba', 'marimba', 'drops', 'ripple']
const VOICE_LABELS: Record<Voice, string> = { bowl: 'Bowl', kalimba: 'Kalimba', marimba: 'Marimba', drops: 'Drops', ripple: 'Ripple' }
// ---- looks you can try: palette, dot count, dot shape, font
type Theme = {
  name: string; bg: string; ink: string; ring: string; dust: [string, string, string]; hub: string
  pill: string; pillBorder: string; pillText: string; pressed: string; onAccent: string; accents: Record<Voice, string>
}
const THEMES = {
  mono: { name: 'Mono', bg: '#0d0d0d', ink: '#f4f4f4', ring: '#333333', dust: ['#3a3a3a', '#2c2c2c', '#222222'], hub: '#666666',
    pill: '#171717', pillBorder: '#2a2a2a', pillText: '#9a9a9a', pressed: '#222222', onAccent: '#0d0d0d',
    accents: { bowl: '#f4f4f4', kalimba: '#f4f4f4', marimba: '#f4f4f4', drops: '#f4f4f4', ripple: '#f4f4f4' } },
  chalk: { name: 'Chalk', bg: '#f4f4f2', ink: '#141414', ring: '#cfcfcb', dust: ['#c4c4c0', '#d2d2ce', '#dcdcd8'], hub: '#9a9a96',
    pill: '#eaeae6', pillBorder: '#d6d6d1', pillText: '#6a6a66', pressed: '#e2e2de', onAccent: '#f4f4f2',
    accents: { bowl: '#141414', kalimba: '#141414', marimba: '#141414', drops: '#141414', ripple: '#141414' } },
  blush: { name: 'Blush', bg: '#f7efec', ink: '#3a2630', ring: '#e6cfd0', dust: ['#e0c7c9', '#e9d6d6', '#f0e2e1'], hub: '#c9a3a8',
    pill: '#f0dede', pillBorder: '#e6cccd', pillText: '#8a6670', pressed: '#ead6d6', onAccent: '#fff6f4',
    accents: { bowl: '#cf4d78', kalimba: '#d85a82', marimba: '#c0406d', drops: '#d9628d', ripple: '#b8456f' } },
} satisfies Record<string, Theme>
type ThemeId = keyof typeof THEMES
const THEME_IDS = Object.keys(THEMES) as ThemeId[]
const SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif'
const dotSize = (n: number) => Math.max(3, Math.min(10, 21 / Math.sqrt(n))) // fewer dots are bigger, more dots smaller
const LOOK_KEY = 'spin-look'
const readLook = (): ThemeId => {
  try {
    const j = JSON.parse(localStorage.getItem(LOOK_KEY) || '{}')
    return j.theme in THEMES ? j.theme : 'mono'
  } catch { return 'mono' }
}
const iconProps = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
const SoundIcon = ({ off }: { off: boolean }) => (
  <svg {...iconProps}>
    <path d="M4 10v4h3l5 4V6L7 10H4z" />
    {off ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <><path d="M15.5 9a4 4 0 010 6" /><path d="M18 6.5a8 8 0 010 11" opacity=".6" /></>}
  </svg>
)
const vIcon = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const
// a small spiral for the Drops icon: a polyline that winds out from the middle
const SPIRAL_ICON = Array.from({ length: 41 }, (_, i) => {
  const t = i / 40, th = t * 2.3 * Math.PI * 2 - 0.4, r = 0.8 + 8.4 * t
  return `${i ? 'L' : 'M'}${(12 + Math.cos(th) * r).toFixed(2)} ${(12 + Math.sin(th) * r).toFixed(2)}`
}).join('')
const VOICE_ICONS: Record<Voice, React.ReactElement> = {
  bowl: <svg {...vIcon}><path d="M3.8 9.5c1.9 7.2 14.5 7.2 16.4 0-2.4 3.1-14 3.1-16.4 0z" /><path d="M9 20h6" opacity=".6" /></svg>,
  kalimba: <svg {...vIcon}><rect x="5" y="3.5" width="14" height="17" rx="3.5" /><path d="M9 8v8M12 8v10M15 8v7" /></svg>,
  marimba: <svg {...vIcon} strokeWidth="2.4"><path d="M4 7h16M6 12h12M8 17h8" /></svg>,
  drops: <svg {...vIcon}><path d={SPIRAL_ICON} /></svg>,
  ripple: <svg {...vIcon}><path d="M3 12c1.8-4 3.6-4 5.4 0s3.6 4 5.4 0 3.6-4 5.4 0" /><path d="M3 17c1.8-3 3.6-3 5.4 0s3.6 3 5.4 0 3.6-3 5.4 0" opacity=".5" /><path d="M3 7c1.8-3 3.6-3 5.4 0s3.6 3 5.4 0 3.6-3 5.4 0" opacity=".5" /></svg>,
}
const PanelIcon = () => <svg {...iconProps}><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="M3.5 13.5h17" /><path d="M8 16.5h8" opacity=".6" /></svg>
const LookIcon = () => <svg {...iconProps}><path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-1 1.6-2.1-.4-1.2.3-2.4 1.6-2.4H17a3.5 3.5 0 0 0 3.5-3.6C20.5 7.2 16.8 3.5 12 3.5z" /><circle cx="7.8" cy="11.2" r=".9" fill="currentColor" stroke="none" /><circle cx="10.4" cy="7.4" r=".9" fill="currentColor" stroke="none" /><circle cx="14.8" cy="7.6" r=".9" fill="currentColor" stroke="none" /></svg>
const LAYER_ICONS: Record<LayerName, React.ReactElement> = {
  pad: <svg {...iconProps}><circle cx="9" cy="12" r="5" /><circle cx="15" cy="12" r="5" /></svg>,
  air: <svg {...iconProps}><path d="M4 8h9M7 12h12M5 16h8" /></svg>,
  ocean: <svg {...iconProps}><path d="M3 11c2.2-3 4.4-3 6 0s3.8 3 6 0 4-3 6 0" /><path d="M3 16c2.2-3 4.4-3 6 0s3.8 3 6 0 4-3 6 0" opacity=".55" /></svg>,
  sub: <svg {...iconProps}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" /></svg>,
  vinyl: <svg {...iconProps}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.4" /><path d="M7.2 8.2a6 6 0 0 1 4-2.4" opacity=".6" /></svg>,
}
const iconBtn = (on: boolean): React.CSSProperties => ({
  width: 44, height: 44, display: 'grid', placeItems: 'center', border: 0, borderRadius: 22, color: 'var(--ink)',
  background: on ? 'var(--pressed)' : 'transparent', transition: 'background .15s ease-out, scale .15s ease-out, opacity .5s',
})
const CSS = `
.sp-root:focus{outline:none}
.sp-root:focus-visible{outline:2px solid var(--ink);outline-offset:-4px}
.sp-btn:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
fieldset.sp-fs{border:0;margin:0;padding:0;min-width:0}
.sp-vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;padding:0}
.sp-pills{display:flex;justify-content:center;gap:6px;flex-wrap:wrap}
.sp-pill{position:relative;display:block;cursor:pointer}
.sp-pill::after{content:'';position:absolute;inset:-4px} /* 36px pill, 44px touch target */
.sp-pill input{position:absolute;opacity:0;width:1px;height:1px}
.sp-pill span{display:flex;align-items:center;gap:7px;height:36px;padding:0 16px;border-radius:999px;font-size:13px;letter-spacing:.3px;text-transform:capitalize;color:var(--pillt);background:var(--pill);border:1px solid var(--pillb);transition:background .15s ease-out,color .15s ease-out,border-color .15s ease-out,scale .15s ease-out}
.sp-pill input:checked + span{background:var(--accent);color:var(--onaccent);border-color:transparent}
.sp-pill.sw span{padding:0;width:36px;justify-content:center;background:transparent}
.sp-pill.sw input:checked + span{background:transparent;border-color:var(--ink);box-shadow:0 0 0 1px var(--ink)}
.sp-pill svg{flex:none}
.sp-sw{width:20px;height:20px;border-radius:50%;display:block}
.sp-pill input:focus-visible + span{outline:2px solid var(--ink);outline-offset:2px}
.sp-cap{height:14px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--pillt);white-space:nowrap}
.sp-insrow{position:relative;display:flex;gap:8px}
.sp-ind{position:absolute;left:0;top:0;width:44px;height:44px;border-radius:50%;background:var(--accent);transition:transform .22s cubic-bezier(.32,.72,0,1)}
.sp-ins{position:relative;display:block;width:44px;height:44px;cursor:pointer}
.sp-ins input{position:absolute;opacity:0;width:1px;height:1px}
.sp-ins .ic{position:relative;display:grid;place-items:center;width:44px;height:44px;border-radius:50%;color:var(--pillt);transition:color .15s ease-out,scale .15s ease-out}
.sp-ins svg{width:20px;height:20px}
.sp-ins input:checked + .ic{color:var(--onaccent)}
.sp-ins:active .ic{scale:.96}
.sp-ins input:focus-visible + .ic{outline:2px solid var(--ink);outline-offset:2px}
.sp-lay{position:relative;width:44px;height:44px;padding:0;border-radius:50%;border:1px solid var(--pillb);background:var(--pill);color:var(--pillt);display:grid;place-items:center;touch-action:none;cursor:pointer;transition:background .15s ease-out,color .15s ease-out,scale .15s ease-out}
.sp-lay[aria-checked=true]{color:var(--ink);background:var(--pressed)}
.sp-lay svg.ic{width:20px;height:20px}
.sp-lay svg.ring{position:absolute;left:-1px;top:-1px;width:44px;height:44px;pointer-events:none;transform:rotate(-90deg)}
.sp-lay:active{scale:.96}
.sp-lay:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.sp-row{display:flex;align-items:center;justify-content:center;gap:8px}
.sp-rowl{width:52px;flex:none;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:var(--pillt)}
.sp-pill:active span,.sp-btn:active{scale:.96}
.sp-root[data-switching] *,.sp-root[data-switching] *::before{transition:none !important}
@media (prefers-reduced-motion: reduce){.sp-root *,.sp-root *::before{transition-duration:.01ms !important}}
`

type Layer = { out: GainNode; mod?: GainNode; stop: () => void } // a running background layer
// a few seconds of loopable noise; `smooth` low-passes it (small = darker, 1 = white)
const noiseBuffer = (ctx: AudioContext, smooth: number, level: number, seconds: number) => {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
  const d = buf.getChannelData(0); let y = 0
  for (let i = 0; i < d.length; i++) { y += smooth * ((Math.random() * 2 - 1) - y); d[i] = y * level }
  return buf
}

export default function Spin() {
  const wrap = useRef<HTMLDivElement>(null)
  const cvs = useRef<HTMLCanvasElement>(null)
  const audio = useRef<AudioBits | null>(null)
  const [muted, setMuted] = useState(false)
  const [touched, setTouched] = useState(false)
  const [voice, setVoiceState] = useState<Voice>('bowl')
  const [padOn, setPadOn] = useState(false)
  const [noiseOn, setNoiseOn] = useState(false)
  const [oceanOn, setOceanOn] = useState(false)
  const [subOn, setSubOn] = useState(false)
  const [vinylOn, setVinylOn] = useState(false)
  const [chrome, setChrome] = useState(true)
  const [pokeTick, setPokeTick] = useState(0)
  const [themeId, setThemeId] = useState<ThemeId>(readLook) // restored from the last visit
  const [lookOpen, setLookOpen] = useState(false)
  const levelsRef = useRef<Record<LayerName, number>>(readLevels())
  const [levels, setLevels] = useState(levelsRef.current)
  const [caption, setCaption] = useState<string | null>(null) // what the line above the dock says while you're touching a layer
  const captionTimer = useRef(0)
  const drag = useRef<{ name: LayerName; y0: number; lvl0: number; moved: boolean } | null>(null)
  const [dockOpen, setDockOpen] = useState(true) // show or hide the instrument, layer and look controls
  const theme: Theme = THEMES[themeId]
  const reduceRef = useRef(false) // prefers-reduced-motion
  const padRef = useRef<{ gain: GainNode; oscs: OscillatorNode[]; lfo: OscillatorNode } | null>(null)
  const noiseRef = useRef<{ gain: GainNode; src: AudioBufferSourceNode } | null>(null)
  const oceanRef = useRef<Layer | null>(null)
  const subRef = useRef<Layer | null>(null)
  const vinylRef = useRef<Layer | null>(null)

  const s = useRef({
    rot: 0, w: 0.15, dragging: false, lastA: 0, lastT: 0,
    pulse: new Float32Array(DOTS * SPIRAL_TURNS), th: THEMES.mono as Theme, n: DOTS, step: (Math.PI * 2) / DOTS, lastNote: 0, muted: false, voice: 'bowl' as Voice, cyFrac: 0.44, pid: -1, W: 0, H: 0,
  })

  s.current.th = theme // the canvas reads the look from here
  useEffect(() => { // the page behind the column and the browser bar take the palette's colour
    const html = document.documentElement
    html.classList.add('spin-active'); html.style.setProperty('--bg', theme.bg)
    const meta = document.querySelector('meta[name="theme-color"]'), prevMeta = meta?.getAttribute('content') ?? null
    meta?.setAttribute('content', theme.bg)
    return () => {
      html.classList.remove('spin-active'); html.style.removeProperty('--bg')
      if (meta && prevMeta !== null) meta.setAttribute('content', prevMeta)
    }
  }, [theme.bg])

  useEffect(() => {
    try { localStorage.setItem(LOOK_KEY, JSON.stringify({ theme: themeId })) } catch { /* private mode */ }
  }, [themeId])

  const say = (text: string) => { // show a short note above the dock, and put the instrument's name back a moment later
    setCaption(text); clearTimeout(captionTimer.current); captionTimer.current = window.setTimeout(() => setCaption(null), 900)
  }
  const setLevel = (name: LayerName, v: number) => {
    const lv = Math.max(0, Math.min(1, v))
    levelsRef.current = { ...levelsRef.current, [name]: lv }; setLevels(levelsRef.current)
    const a = audio.current
    if (a) a.bus[name].gain.setTargetAtTime(lv / DEFAULT_LEVEL, a.ctx.currentTime, 0.05)
    try { localStorage.setItem(LEVELS_KEY, JSON.stringify(levelsRef.current)) } catch { /* private mode */ }
  }

  const ensureAudio = () => {
    if (audio.current) {
      if (audio.current.ctx.state !== 'running') void audio.current.ctx.resume()
      return
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const master = ctx.createGain(); master.gain.value = 0.9
    const delay = ctx.createDelay(1); delay.delayTime.value = 0.3
    const fb = ctx.createGain(); fb.gain.value = 0.1
    const wet = ctx.createGain(); wet.gain.value = 0.38
    master.connect(ctx.destination)
    master.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(ctx.destination)
    const bus = {} as Record<LayerName, GainNode>
    for (const n of LAYERS) { const g = ctx.createGain(); g.gain.value = levelsRef.current[n] / DEFAULT_LEVEL; g.connect(master); bus[n] = g }
    audio.current = { ctx, master, fb, bus }
    const blip = ctx.createBufferSource(); blip.buffer = ctx.createBuffer(1, 1, 22050); blip.connect(ctx.destination); blip.start(0) // a silent blip: the usual trick to unlock iOS audio
    void ctx.resume()
  }

  const note = (tick: number) => {
    const a = audio.current
    if (!a || s.current.muted) return
    if (a.ctx.state !== 'running') void a.ctx.resume()
    const t = a.ctx.currentTime
    const d = ((tick % 15) + 15) % 15
    const f = 196 * 2 ** ((SCALE[d % 5] + 12 * Math.floor(d / 5)) / 12)
    // one partial: oscillator through an attack/decay envelope into the master bus
    const mk = (type: OscillatorType, freq: number, peak: number, attack: number, decay: number, glideTo?: number, at = 0, dest: AudioNode = a.master) => {
      const o = a.ctx.createOscillator(), g = a.ctx.createGain(), t0 = t + at
      o.type = type; o.frequency.setValueAtTime(freq, t0)
      if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + 0.09)
      g.gain.setValueAtTime(0, t0)
      g.gain.linearRampToValueAtTime(peak, t0 + attack)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay)
      o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + attack + decay + 0.05)
    }
    switch (s.current.voice) {
      case 'bowl': // inharmonic partials that decay at different rates = a shimmering, beating tail
        mk('sine', f, 0.12, 0.01, 3.4); mk('sine', f * 1.003, 0.06, 0.01, 3.4)
        mk('sine', f * 2.76, 0.04, 0.01, 1.8); mk('sine', f * 5.4, 0.016, 0.01, 0.9)
        break
      case 'kalimba': // short plucked attack with a metallic tick on top
        mk('triangle', f * 2, 0.15, 0.003, 0.9); mk('sine', f * 2 * 5.4, 0.03, 0.002, 0.12)
        break
      case 'marimba': // rounded wooden knock with a quick decay
        mk('sine', f, 0.2, 0.004, 0.55); mk('sine', f * 4, 0.05, 0.002, 0.07)
        break
      case 'ripple': { // a soft, round pluck followed by three fading echoes, each later and a little lower, like rings spreading across water
        const tg = a.ctx.createGain(); tg.gain.value = 0.82 // a slow shimmer on the whole tail, matching the wobble of the ring
        const lfo = a.ctx.createOscillator(); lfo.frequency.value = 6
        const lg = a.ctx.createGain(); lg.gain.value = 0.18
        lfo.connect(lg); lg.connect(tg.gain); tg.connect(a.master); lfo.start(t); lfo.stop(t + 2.6)
        mk('sine', f, 0.17, 0.006, 1.0, undefined, 0, tg); mk('sine', f * 2, 0.045, 0.004, 0.35, undefined, 0, tg)
        for (const [delay, level, drift] of [[0.17, 0.55, 0.996], [0.4, 0.32, 0.99], [0.74, 0.17, 0.984]])
          mk('sine', f * drift, 0.17 * level, 0.03, 0.75, undefined, delay, tg)
        break
      }
      case 'drops': // pitch glides upward like a water drop
        mk('sine', f * 1.5, 0.2, 0.004, 0.4, f * 2.4)
        break
    }
  }

  // notes thin out as the ring speeds up, so a fast spin flows instead of machine-gunning
  const noteGap = () => 70 + Math.min(Math.abs(s.current.w) * 14, 230)

  const setPad = (on: boolean) => {
    const a = audio.current
    if (!a) return
    const t = a.ctx.currentTime
    if (on && !padRef.current) {
      const gain = a.ctx.createGain(); gain.gain.value = 0
      const lp = a.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 0.4
      const lfo = a.ctx.createOscillator(); lfo.frequency.value = 0.07
      const lg = a.ctx.createGain(); lg.gain.value = 260
      lfo.connect(lg); lg.connect(lp.frequency); lfo.start()
      const oscs = [98, 147, 196.6, 294.5].map((fr, i) => {
        const o = a.ctx.createOscillator()
        o.type = i % 2 ? 'triangle' : 'sine'; o.frequency.value = fr; o.detune.value = (i - 1.5) * 4
        o.connect(lp); o.start(); return o
      })
      lp.connect(gain); gain.connect(a.bus.pad)
      gain.gain.setTargetAtTime(0.06, t, 1.5)
      padRef.current = { gain, oscs, lfo }
    } else if (!on && padRef.current) {
      const p = padRef.current; padRef.current = null
      p.gain.gain.setTargetAtTime(0, t, 0.8)
      setTimeout(() => { p.oscs.forEach((o) => o.stop()); p.lfo.stop(); p.gain.disconnect() }, 4000)
    }
  }

  const setNoise = (on: boolean) => {
    const a = audio.current
    if (!a) return
    const t = a.ctx.currentTime
    if (on && !noiseRef.current) {
      const buf = a.ctx.createBuffer(1, a.ctx.sampleRate * 2, a.ctx.sampleRate)
      const data = buf.getChannelData(0); let y = 0
      for (let i = 0; i < data.length; i++) { y += 0.08 * ((Math.random() * 2 - 1) - y); data[i] = y * 3.5 } // soft, low-passed noise
      const src = a.ctx.createBufferSource(); src.buffer = buf; src.loop = true
      const bp = a.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.5
      const gain = a.ctx.createGain(); gain.gain.value = 0
      src.connect(bp); bp.connect(gain); gain.connect(a.bus.air); src.start()
      noiseRef.current = { gain, src }
    } else if (!on && noiseRef.current) {
      const n = noiseRef.current; noiseRef.current = null
      n.gain.gain.setTargetAtTime(0, t, 0.5)
      setTimeout(() => { n.src.stop(); n.gain.disconnect() }, 2500)
    }
  }

  // Ocean: dark noise that swells and ebbs like waves (and brightens on the crest).
  const setOcean = (on: boolean) => {
    const a = audio.current
    if (!a) return
    const t = a.ctx.currentTime
    if (on && !oceanRef.current) {
      const src = a.ctx.createBufferSource(); src.buffer = noiseBuffer(a.ctx, 0.06, 3.2, 6); src.loop = true
      const lp = a.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.3
      const swell = a.ctx.createGain(); swell.gain.value = 0.5
      const lfo = a.ctx.createOscillator(); lfo.frequency.value = 0.09 // a wave about every 11 seconds
      const lg = a.ctx.createGain(); lg.gain.value = 0.45
      const lf = a.ctx.createGain(); lf.gain.value = 280
      lfo.connect(lg); lg.connect(swell.gain); lfo.connect(lf); lf.connect(lp.frequency)
      const mod = a.ctx.createGain(), out = a.ctx.createGain(); out.gain.value = 0
      src.connect(lp); lp.connect(swell); swell.connect(mod); mod.connect(out); out.connect(a.bus.ocean)
      src.start(); lfo.start(); out.gain.setTargetAtTime(0.1, t, 1.5)
      oceanRef.current = { out, mod, stop: () => { src.stop(); lfo.stop(); out.disconnect() } }
    } else if (!on && oceanRef.current) {
      const o = oceanRef.current; oceanRef.current = null
      o.out.gain.setTargetAtTime(0, t, 0.8); setTimeout(o.stop, 4000)
    }
  }

  // Sub hum: a very low tone with a slow beat, plus a couple of overtones so phone speakers can carry it
  const setSub = (on: boolean) => {
    const a = audio.current
    if (!a) return
    const t = a.ctx.currentTime
    if (on && !subRef.current) {
      const lp = a.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260
      const trem = a.ctx.createGain(); trem.gain.value = 0.85
      const lfo = a.ctx.createOscillator(); lfo.frequency.value = 0.17
      const lg = a.ctx.createGain(); lg.gain.value = 0.15
      lfo.connect(lg); lg.connect(trem.gain)
      const oscs = ([[55, 1], [55.5, 0.9], [110, 0.5], [165, 0.2]] as const).map(([f, lv]) => {
        const o = a.ctx.createOscillator(), g = a.ctx.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.value = lv
        o.connect(g); g.connect(lp); o.start(); return o
      })
      const out = a.ctx.createGain(); out.gain.value = 0
      lp.connect(trem); trem.connect(out); out.connect(a.bus.sub); lfo.start(); out.gain.setTargetAtTime(0.14, t, 1.5)
      subRef.current = { out, stop: () => { oscs.forEach((o) => o.stop()); lfo.stop(); out.disconnect() } }
    } else if (!on && subRef.current) {
      const o = subRef.current; subRef.current = null
      o.out.gain.setTargetAtTime(0, t, 0.8); setTimeout(o.stop, 4000)
    }
  }

  // Vinyl: a faint hiss with random crackle and the odd bigger pop
  const setVinyl = (on: boolean) => {
    const a = audio.current
    if (!a) return
    const t = a.ctx.currentTime
    if (on && !vinylRef.current) {
      const out = a.ctx.createGain(); out.gain.value = 0
      const hiss = a.ctx.createBufferSource(); hiss.buffer = noiseBuffer(a.ctx, 1, 0.5, 3); hiss.loop = true
      const hp = a.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3200
      const hg = a.ctx.createGain(); hg.gain.value = 0.012
      hiss.connect(hp); hp.connect(hg); hg.connect(out); hiss.start()
      const sr = a.ctx.sampleRate, click = a.ctx.createBuffer(1, Math.floor(sr * 0.014), sr), cd = click.getChannelData(0)
      for (let i = 0; i < cd.length; i++) cd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sr * 0.0018)) // a tiny decaying burst = one crackle
      out.connect(a.bus.vinyl); out.gain.setTargetAtTime(1, t, 1)
      let timer = 0, alive = true
      const crackle = () => {
        if (!alive) return
        const c = a.ctx.createBufferSource(), g = a.ctx.createGain(); c.buffer = click; c.playbackRate.value = 0.6 + Math.random() * 1.6
        g.gain.value = Math.random() < 0.12 ? 0.2 + Math.random() * 0.2 : 0.015 + Math.random() * 0.07
        c.connect(g); g.connect(out); c.start()
        timer = window.setTimeout(crackle, Math.random() < 0.25 ? 20 + Math.random() * 50 : 90 + Math.random() * 650) // sometimes a quick cluster
      }
      crackle()
      vinylRef.current = { out, stop: () => { alive = false; clearTimeout(timer); hiss.stop(); out.disconnect() } }
    } else if (!on && vinylRef.current) {
      const o = vinylRef.current; vinylRef.current = null
      o.out.gain.setTargetAtTime(0, t, 0.4); setTimeout(o.stop, 2000)
    }
  }

  useEffect(() => { // controls dim (never hide) after a few quiet seconds, so they stay reachable while you play
    setChrome(true)
    const t = window.setTimeout(() => setChrome(false), 4000)
    return () => clearTimeout(t)
  }, [pokeTick])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)'), on = () => { reduceRef.current = mq.matches }
    on(); mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  useEffect(() => { // iOS only unlocks audio on a touch release or click, not on touch down: so wake it on every one of those, anywhere
    const unlock = () => ensureAudio()
    const evs = ['touchend', 'click', 'pointerup', 'keydown'] as const
    evs.forEach((e) => window.addEventListener(e, unlock, { passive: true }))
    const vis = () => { if (!document.hidden) ensureAudio() } // and when you come back to the tab or unlock the phone
    document.addEventListener('visibilitychange', vis)
    return () => { evs.forEach((e) => window.removeEventListener(e, unlock)); document.removeEventListener('visibilitychange', vis) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => { // leaving the route must stop all sound
    const a = audio.current
    audio.current = null; padRef.current = null; noiseRef.current = null
    vinylRef.current?.stop(); vinylRef.current = null; oceanRef.current = null; subRef.current = null
    if (a) void a.ctx.close()
  }, [])

  useEffect(() => {
    const st = s.current
    const canvas = cvs.current!, box = wrap.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0, last = performance.now(), t0 = last

    const frame = () => {
      const now = performance.now() // one clock everywhere (rAF's timestamp can lag event times in Safari)
      const dt = Math.min((now - last) / 1000, 0.04); last = now
      const time = (now - t0) / 1000
      const W = box.clientWidth, H = box.clientHeight, dpr = window.devicePixelRatio || 1
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width = W * dpr; canvas.height = H * dpr; st.W = W; st.H = H
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.fillStyle = st.th.bg; ctx.fillRect(0, 0, W, H)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      // ---- physics
      const prevRot = st.rot
      if (!st.dragging) {
        st.w *= Math.exp(-0.42 * dt) // a long, soft decay
        const floor = reduceRef.current ? 0.03 : 0.14 // the idle drift: almost still when motion is reduced
        if (Math.abs(st.w) < floor) st.w = floor * (st.w < 0 ? -1 : 1) // never fully stops
        st.rot += st.w * dt
      }
      const spiral = st.voice === 'drops'
      st.n = spiral ? DOTS * SPIRAL_TURNS : DOTS // same detents per finger-turn either way: the spiral just has more dots on it
      const N = st.n, a0 = Math.floor(prevRot / st.step), a1 = Math.floor(st.rot / st.step)
      if (a1 !== a0) {
        const crossed = Math.min(Math.abs(a1 - a0), N)
        const dir = a1 > a0 ? 1 : -1
        for (let k = 1; k <= crossed; k++) st.pulse[(((a0 + dir * k) % N) + N) % N] = 1
        if (now - st.lastNote > noteGap()) { st.lastNote = now; note(a1); navigator.vibrate?.(4) }
      }
      st.pulse.forEach((_, i) => { st.pulse[i] = Math.max(0, st.pulse[i] - dt * 1.6) })

      // ---- draw: flat and matte, solid fills only (no glow, blur, gradients or trails)
      const th = st.th
      ctx.fillStyle = th.bg; ctx.fillRect(0, 0, W, H)
      const cx = W / 2, cy = H * st.cyFrac
      const base = Math.min(W, H) * 0.25
      const b = 0.5 + 0.5 * Math.sin(time * 0.9) // the idle swell
      const breath = reduceRef.current ? 0.012 : 0.035 // the ring's slow idle swell
      const nz = noiseRef.current, an = audio.current
      // the echo shortens as the spinner slows: a lively tail while it spins, and only a repeat or two once it's nearly stopped
      if (an) an.fb.gain.setTargetAtTime(0.1 + 0.2 * Math.min(Math.abs(st.w) / 8, 1), an.ctx.currentTime, 0.2)
      if (nz && an) nz.gain.gain.setTargetAtTime(0.012 + Math.min(Math.abs(st.w) / 22, 1) * 0.05, an.ctx.currentTime, 0.15)
      const R = base * (1 + breath * (b - 0.5) * 2)
      const accent = th.accents[st.voice]

      for (let k = 1; k <= (spiral ? 0 : 3); k++) { // slow outer dust rings, counter-rotating (the spiral fills the screen, so it has none)
        const rk = R * (1 + 0.42 * k), n = 14 + k * 8
        const rot = st.rot * (k % 2 ? -0.35 : 0.2) / k
        ctx.fillStyle = th.dust[k - 1]
        for (let i = 0; i < n; i++) {
          const ang = rot + (i / n) * Math.PI * 2
          ctx.beginPath(); ctx.arc(cx + Math.cos(ang) * rk, cy + Math.sin(ang) * rk, 1.7, 0, Math.PI * 2); ctx.fill()
        }
      }
      // the spiral: five rounds from near the middle out to the edges of the screen, scaled with the idle swell
      const sMax = (W / 2 - 4) * (R / base), sMin = W * 0.05
      const spiralR = (u: number) => sMin + (sMax - sMin) * u
      const ripple = st.voice === 'ripple'
      // no guide line behind any of the shapes: the dots alone make the ring, the spiral and the lanes (Ripple's rippled line is the shape itself)

      const r0 = dotSize(DOTS)
      // one dot in the chosen shape, centred at (x, y) and pointing outward along `ang`
      const drawDot = (x: number, y: number, ang: number, r: number, color: string, alpha: number) => {
        const ca = Math.cos(ang), sa = Math.sin(ang)
        ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.strokeStyle = color
        ctx.beginPath()
        switch (st.voice) { // every instrument has its own shape
          case 'kalimba': // thin, long tines
            ctx.moveTo(x - ca * r * 2.5, y - sa * r * 2.5); ctx.lineTo(x + ca * r * 2.5, y + sa * r * 2.5)
            ctx.lineWidth = Math.max(1.6, r * 0.62); ctx.lineCap = 'round'; ctx.stroke(); break
          case 'marimba': // thick, shorter bars
            ctx.moveTo(x - ca * r * 1.5, y - sa * r * 1.5); ctx.lineTo(x + ca * r * 1.5, y + sa * r * 1.5)
            ctx.lineWidth = r * 1.4; ctx.lineCap = 'round'; ctx.stroke(); break
          case 'bowl': { // a slim crescent: the profile of a singing bowl, drawn as one fine curved sliver with pointed tips
            const R = r * 1.55, tx = -sa, ty = ca
            const cxb = x - ca * R * 0.2, cyb = y - sa * R * 0.2 // sits just outside the middle of the ring
            const t1x = cxb + tx * R * 0.95, t1y = cyb + ty * R * 0.95, t2x = cxb - tx * R * 0.95, t2y = cyb - ty * R * 0.95
            ctx.moveTo(t1x, t1y)
            ctx.quadraticCurveTo(cxb + ca * R * 1.7, cyb + sa * R * 1.7, t2x, t2y) // the outer curve, deep
            ctx.quadraticCurveTo(cxb + ca * R * 0.8, cyb + sa * R * 0.8, t1x, t1y) // the inner curve, shallower: what is left between them is the sliver
            ctx.closePath(); ctx.fill(); break
          }
          default: ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill() // drops: plain filled dots
        }
        ctx.globalAlpha = 1
      }
      if (ripple) { // the whole ring is a rippled line: one ripple per detent, and the ripple that just sounded is the biggest
        const amp: number[] = [], glow: number[] = []
        for (let i = 0; i < N; i++) {
          const p = st.pulse[i], t = (1 - p) / 1.6 // seconds since this ripple's note played
          const sounding = p > 0.002
          const swell = sounding ? (1 - Math.exp(-t * 28)) * Math.exp(-t * 2.4) : 0
          const wob = sounding ? 1 + 0.3 * Math.exp(-t * 3) * Math.sin(t * Math.PI * 2 * 6) : 1
          amp[i] = r0 * 0.3 + r0 * 2.6 * swell * wob // every ripple is faintly there; the sounding one swells
          glow[i] = sounding ? Math.exp(-t * 4.5) * (1 - Math.exp(-t * 45)) : 0
        }
        const SEG = 360, pts: { x: number; y: number; g: number }[] = []
        for (let k = 0; k <= SEG; k++) {
          const th0 = (k / SEG) * Math.PI * 2, u = (th0 - st.rot) / st.step // position in ripple units: whole numbers are the dot positions
          const fl = Math.floor(u), f = u - fl, ia = ((fl % N) + N) % N, ib = (ia + 1) % N, sm = f * f * (3 - 2 * f)
          const A = amp[ia] * (1 - sm) + amp[ib] * sm
          const rad = R + A * Math.cos(u * Math.PI * 2) // a crest at every dot position
          pts.push({ x: cx + Math.cos(th0) * rad, y: cy + Math.sin(th0) * rad, g: Math.max(glow[((Math.round(u) % N) + N) % N], 0) })
        }
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y)
        for (let k = 1; k <= SEG; k++) ctx.lineTo(pts[k].x, pts[k].y)
        ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke()
        for (let k = 1; k <= SEG; k++) { // the ripple that just sounded lights up
          const g = (pts[k].g + pts[k - 1].g) / 2
          if (g > 0.03) { ctx.beginPath(); ctx.moveTo(pts[k - 1].x, pts[k - 1].y); ctx.lineTo(pts[k].x, pts[k].y); ctx.strokeStyle = th.ink; ctx.lineWidth = 2.4; ctx.globalAlpha = g; ctx.stroke(); ctx.globalAlpha = 1 }
        }
      }
      for (let i = 0; i < (ripple ? 0 : N); i++) {
        const p = st.pulse[i]
        if (spiral) { // each round of the spiral is its own lane of dots, and neighbouring rounds turn in opposite directions
          const lane = Math.floor(i / DOTS), j = i % DOTS, dir = lane % 2 ? -1 : 1
          const f = (((j / DOTS + dir * st.rot / (Math.PI * 2)) % 1) + 1) % 1 // how far round this lane the dot is
          const u = (lane + f) / SPIRAL_TURNS
          const th2 = -Math.PI / 2 + f * Math.PI * 2, rr = spiralR(u)
          const seam = Math.min(1, f / 0.07, (1 - f) / 0.07) // dots fade where a lane's end meets its start, so the hop between rounds is hidden
          const tp = spiralTaper(u) * seam
          const x = cx + Math.cos(th2) * rr, y = cy + Math.sin(th2) * rr, r = 3.3 * (1 + p * 0.7) * (0.35 + 0.65 * tp)
          drawDot(x, y, th2, r, accent, tp)
          if (p > 0.02) drawDot(x, y, th2, r, th.ink, p * tp)
          continue
        }
        const ang = st.rot + i * st.step
        const r = r0 * (1 + p * 0.65)
        const x = cx + Math.cos(ang) * R, y = cy + Math.sin(ang) * R
        drawDot(x, y, ang, r, accent, 1)
        if (p > 0.02) drawDot(x, y, ang, r, th.ink, p) // a passing detent lights the dot up
      }
      ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2)
      ctx.fillStyle = th.hub; ctx.fill()

      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pointerAngle = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect()
    return Math.atan2(e.clientY - (r.top + s.current.H * s.current.cyFrac), e.clientX - (r.left + s.current.W / 2))
  }
  const down = (e: React.PointerEvent) => {
    ensureAudio(); setTouched(true); setPokeTick((n) => n + 1)
    const st = s.current
    if (st.dragging) return // a second finger never takes over the spin
    wrap.current!.setPointerCapture(e.pointerId)
    st.pid = e.pointerId
    st.dragging = true; st.lastA = pointerAngle(e); st.lastT = performance.now()
  }
  const move = (e: React.PointerEvent) => {
    const st = s.current
    if (!st.dragging || e.pointerId !== st.pid) return
    const a = pointerAngle(e), now = performance.now()
    const d = wrapAngle(a - st.lastA), dt = Math.max((now - st.lastT) / 1000, 0.001)
    const prev = st.rot
    st.rot += d
    st.w = st.w * 0.6 + (d / dt) * 0.4 // smoothed finger velocity becomes the flick
    st.w = Math.max(-26, Math.min(26, st.w))
    const N = st.n, a0 = Math.floor(prev / st.step), a1 = Math.floor(st.rot / st.step)
    if (a1 !== a0) {
      const dir = a1 > a0 ? 1 : -1
      for (let k = 1; k <= Math.min(Math.abs(a1 - a0), N); k++) st.pulse[(((a0 + dir * k) % N) + N) % N] = 1
      if (now - st.lastNote > noteGap()) { st.lastNote = now; note(a1); navigator.vibrate?.(4) }
    }
    st.lastA = a; st.lastT = now
  }
  const up = (e: React.PointerEvent) => {
    const st = s.current
    if (!st.dragging || e.pointerId !== st.pid) return
    st.dragging = false
    const now = performance.now()
    if (now - st.lastT > 90) st.w *= 0.3 // held still before release: no flick
  }

  const toggleMute = () => {
    const m = !s.current.muted
    s.current.muted = m; setMuted(m)
    const a = audio.current
    if (a) a.master.gain.setTargetAtTime(m ? 0 : 0.9, a.ctx.currentTime, 0.1) // silences pad and noise too
  }

  const poke = () => setPokeTick((n) => n + 1)
  const layerOn: Record<LayerName, boolean> = { pad: padOn, air: noiseOn, ocean: oceanOn, sub: subOn, vinyl: vinylOn }
  const layerSet = (name: LayerName, on: boolean) => {
    ensureAudio(); setTouched(true)
    if (name === 'pad') { setPadOn(on); setPad(on) }
    else if (name === 'air') { setNoiseOn(on); setNoise(on) }
    else if (name === 'ocean') { setOceanOn(on); setOcean(on) }
    else if (name === 'sub') { setSubOn(on); setSub(on) }
    else { setVinylOn(on); setVinyl(on) }
  }
  // a layer button: tap to switch it on or off; press and drag up or down to set its volume (a drag switches it on)
  const layerDown = (name: LayerName) => (e: React.PointerEvent) => {
    e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); poke()
    drag.current = { name, y0: e.clientY, lvl0: levelsRef.current[name], moved: false }
  }
  const layerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dy = d.y0 - e.clientY
    if (!d.moved && Math.abs(dy) > 8) { d.moved = true; if (!layerOn[d.name]) layerSet(d.name, true) }
    if (d.moved) { const lv = Math.max(0, Math.min(1, d.lvl0 + dy / 110)); setLevel(d.name, lv); say(`${LAYER_LABELS[d.name]} ${Math.round(lv * 100)}%`) }
  }
  const layerUp = (name: LayerName) => () => {
    const d = drag.current; drag.current = null
    if (!d) return
    if (!d.moved) { // a plain tap
      const on = !layerOn[name]
      if (on && levelsRef.current[name] < 0.05) setLevel(name, DEFAULT_LEVEL)
      layerSet(name, on); say(`${LAYER_LABELS[name]} ${on ? 'on' : 'off'}`)
    }
  }
  const layerKey = (name: LayerName) => (e: React.KeyboardEvent) => { // keyboard: arrow up and down change the volume
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault(); e.stopPropagation()
    const lv = Math.max(0, Math.min(1, levelsRef.current[name] + (e.key === 'ArrowUp' ? 0.1 : -0.1)))
    if (!layerOn[name]) layerSet(name, true)
    setLevel(name, lv); say(`${LAYER_LABELS[name]} ${Math.round(lv * 100)}%`)
  }
  // the controls slide up and fade in (250ms, ease-out) and leave a little faster (180ms): they've served their purpose
  const dockMotion = (dim: number): React.CSSProperties => dockOpen
    ? { opacity: chrome ? 1 : dim, transform: 'none', visibility: 'visible', transition: 'transform .25s cubic-bezier(.32,.72,0,1), opacity .3s ease-out' }
    : { opacity: 0, transform: 'translateY(24px)', visibility: 'hidden', pointerEvents: 'none', transition: 'transform .18s ease-in, opacity .18s ease-out, visibility 0s linear .18s' }
  const switchTheme = (id: ThemeId) => { // a theme switch shouldn't fire every colour transition on the page
    const el = wrap.current
    if (el) { el.dataset.switching = '1'; requestAnimationFrame(() => requestAnimationFrame(() => { delete el.dataset.switching })) }
    setThemeId(id)
  }
  const stop = (e: React.PointerEvent) => { e.stopPropagation(); poke() }
  const hintBottom = 190

  // keyboard access to the spinner itself: arrows spin it
  const onKey = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return
    const st = s.current
    poke(); ensureAudio()
    if (e.key === 'ArrowRight') { st.w = Math.min(26, st.w + 3); setTouched(true); e.preventDefault() }
    else if (e.key === 'ArrowLeft') { st.w = Math.max(-26, st.w - 3); setTouched(true); e.preventDefault() }
  }

  return (
    <div ref={wrap} className="sp-root" tabIndex={0} role="application"
      aria-label="Spinner. Arrow keys spin it."
      onKeyDown={onKey} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      style={{ position: 'fixed', top: 0, bottom: 0, left: 0, right: 0, maxWidth: 520, margin: '0 auto', background: 'var(--bg)', overflow: 'hidden', touchAction: 'none', userSelect: 'none',
        fontFamily: SANS,
        ['--bg' as string]: theme.bg, ['--ink' as string]: theme.ink, ['--pill' as string]: theme.pill, ['--pillb' as string]: theme.pillBorder,
        ['--pillt' as string]: theme.pillText, ['--pressed' as string]: theme.pressed, ['--onaccent' as string]: theme.onAccent, ['--accent' as string]: theme.accents[voice] } as React.CSSProperties}>
      <style>{CSS}</style>
      <canvas ref={cvs} aria-hidden="true" style={{ width: '100%', height: '100%', display: 'block' }} />

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: `calc(var(--safe-bottom) + ${hintBottom}px)`, textAlign: 'center',
        color: 'var(--ink)', pointerEvents: 'none', opacity: touched ? 0 : 1, transition: 'opacity .4s ease-out' }}>
        <div style={{ fontSize: 22, fontWeight: 200, letterSpacing: 1 }}>Flick to spin</div>
      </div>
      {/* quick actions are toggle buttons: constant label, state in aria-pressed */}
      <div onPointerDown={stop} style={{ position: 'absolute', top: 'calc(var(--safe-top) + 8px)', left: 8, right: 8,
        display: 'flex', justifyContent: 'flex-end', opacity: chrome ? 0.8 : 0.3, transition: 'opacity .6s ease-out' }}>
        <div style={{ display: 'flex' }}>
          <button type="button" className="sp-btn" aria-label="Controls" aria-pressed={dockOpen} aria-controls={lookOpen ? 'spin-look' : 'spin-sound'} style={iconBtn(dockOpen)}
            onClick={() => { poke(); if (dockOpen) setLookOpen(false); setDockOpen(!dockOpen) }}> {/* hiding also closes the swatches, so the controls always come back as the instruments and layers */}
            <PanelIcon />
          </button>
          <button type="button" className="sp-btn" aria-label="Look" aria-pressed={lookOpen && dockOpen} aria-controls="spin-look" style={iconBtn(lookOpen && dockOpen)}
            onClick={() => { poke(); setLookOpen(dockOpen ? !lookOpen : true); setDockOpen(true) }}>
            <LookIcon />
          </button>
          <button type="button" className="sp-btn" aria-label="Mute" aria-pressed={muted} style={iconBtn(false)}
            onClick={() => { poke(); toggleMute() }}>
            <SoundIcon off={muted} />
          </button>
        </div>
      </div>

      {/* sound controls: two compact rows under the spinner, never a modal, so you can change them mid-spin */}
      {!lookOpen && <div id="spin-sound" role="group" aria-label="Sound" onPointerDown={stop}
        onPointerMove={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onPointerCancel={(e) => e.stopPropagation()}
        style={{ position: 'absolute', left: 8, right: 8, bottom: 'calc(var(--safe-bottom) + 16px)', maxWidth: 420, margin: '0 auto',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: 'var(--ink)',
          ...dockMotion(0.5) }}>
        <div aria-hidden="true" className="sp-cap">{caption ?? VOICE_LABELS[voice]}</div>
        {/* choose one: round icon buttons, and one highlight that slides to the choice */}
        <fieldset className="sp-fs">
          <legend className="sp-vh">Instrument</legend>
          <div className="sp-insrow">
            <span className="sp-ind" aria-hidden="true" style={{ transform: `translateX(${VOICES.indexOf(voice) * 52}px)` }} />
            {VOICES.map((v) => (
              <label key={v} className="sp-ins">
                <input type="radio" name="voice" value={v} checked={voice === v}
                  onChange={() => { ensureAudio(); setTouched(true); s.current.voice = v; setVoiceState(v); note(7) }} />
                <span className="ic">{VOICE_ICONS[v]}<b className="sp-vh">{VOICE_LABELS[v]}</b></span>
              </label>
            ))}
          </div>
        </fieldset>
        {/* independent layers: tap to switch on or off, press and drag up or down for volume */}
        <div role="group" aria-label="Layers" style={{ display: 'flex', gap: 8 }}>
          {LAYERS.map((n) => (
            <button key={n} type="button" role="switch" className="sp-lay" aria-checked={layerOn[n]}
              aria-label={`${LAYER_LABELS[n]}, ${layerOn[n] ? Math.round(levels[n] * 100) + '%' : 'off'}. Arrow up and down change the volume.`}
              onPointerDown={layerDown(n)} onPointerMove={layerMove} onPointerUp={layerUp(n)} onPointerCancel={() => { drag.current = null }}
              onKeyDown={layerKey(n)} onClick={(e) => { if (e.detail === 0) { layerSet(n, !layerOn[n]); say(`${LAYER_LABELS[n]} ${layerOn[n] ? 'off' : 'on'}`) } }}>
              {LAYER_ICONS[n]}
              {layerOn[n] && <svg className="ring" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="20" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round"
                strokeDasharray={`${125.66 * levels[n]} 125.66`} /></svg>}
            </button>
          ))}
        </div>
      </div>}

      {/* look controls: the palette. They replace the sound pills while open, so the spinner stays clear */}
      {lookOpen && <div id="spin-look" role="group" aria-label="Look" onPointerDown={stop}
        onPointerMove={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onPointerCancel={(e) => e.stopPropagation()}
        style={{ position: 'absolute', left: 8, right: 8, bottom: 'calc(var(--safe-bottom) + 16px)', maxWidth: 420, margin: '0 auto',
          display: 'flex', flexDirection: 'column', gap: 10, color: 'var(--ink)', ...dockMotion(0.6) }}>
        <fieldset className="sp-fs"><legend className="sp-vh">Palette</legend>
          <div className="sp-row"><span className="sp-rowl" aria-hidden="true">Palette</span>
            <div className="sp-pills">
              {THEME_IDS.map((id) => (
                <label key={id} className="sp-pill sw">
                  <input type="radio" name="theme" value={id} checked={themeId === id} onChange={() => switchTheme(id)} />
                  <span><i className="sp-sw" style={{ background: `linear-gradient(90deg, ${THEMES[id].bg} 50%, ${THEMES[id].accents.bowl} 50%)`,
                    boxShadow: `inset 0 0 0 1px ${THEMES[id].pillBorder}` }} /><b className="sp-vh">{THEMES[id].name}</b></span>
                </label>
              ))}
            </div></div>
        </fieldset>
      </div>}
    </div>
  )
}
