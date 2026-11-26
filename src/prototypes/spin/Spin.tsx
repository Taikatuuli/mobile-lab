import { useEffect, useRef, useState } from 'react'
import { TUNE, TUNING } from './tune'
import TunePanel from './TunePanel'

const DOTS = 24 // shapes on the ring (and detents per turn)
const SCALE = [0, 2, 4, 7, 9] // major pentatonic: every combination sounds consonant
const RIPPLE_LIFE = 0.9 // seconds a ripple lives on the ring: as long as the pluck and its single echo ring
const clampPan = (x: number) => Math.max(-1, Math.min(1, x))
// one ripple's swell at t seconds: a fast rise and a slow fall. The sound's pluck and echoes are timed from the same curve
const rippleRise = (t: number) => (t > 0 ? (1 - Math.exp(-t * 40)) * Math.exp(-t * 3.4) : 0)
const RIPPLE_ECHOES = [[0.2, 0.4]] as const // [seconds later, level]: used by both the sound and the ring
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

type Voice = 'bowl' | 'kalimba' | 'marimba' | 'drops' | 'ripple'
// one instrument on the screen: its own angle, speed, dots and notes. Several rings can be on screen at once, each spun on its own
type Ring = {
  voice: Voice; rot: number; w: number; pulse: Float32Array; pop: Float32Array; pv: Float32Array; hold: Float32Array; n: number; step: number; lastNote: number
  dragging: boolean; pid: number; lastA: number; lastT: number
  R: number; alpha: number; leaving: boolean
  replay?: boolean // the loop is spinning this ring right now, so it plays itself
}
const newRing = (voice: Voice, w = 0): Ring => ({
  voice, rot: 0, w, pulse: new Float32Array(72), pop: new Float32Array(72), pv: new Float32Array(72), hold: new Float32Array(72), n: DOTS, step: (Math.PI * 2) / DOTS, lastNote: 0,
  dragging: false, pid: -1, lastA: 0, lastT: 0, R: 0, alpha: 0, leaving: false,
})
// a detent: Ripple reads `pulse` (it fades linearly), every other shape springs: `hold` keeps the spring's target at 1 for a moment, then it settles back to 0
const trigger = (r: Ring, i: number) => { r.pulse[i] = 1; r.hold[i] = TUNE.popHold / 1000 }
// step every bead's spring (position `pop`, velocity `pv`). Sub-steps keep the integration stable however short the settle time is, and a bead hit again mid-motion keeps its speed
const stepPops = (r: Ring, dt: number) => {
  const w = (Math.PI * 2) / Math.max(0.05, TUNE.popSettle), k = w * w, c = 2 * Math.max(0.2, 1 - TUNE.popBounce) * w
  const steps = Math.max(1, Math.ceil(dt * 240)), h = dt / steps
  for (let i = 0; i < r.n; i++) {
    const held = r.hold[i] > 0; r.hold[i] = Math.max(0, r.hold[i] - dt)
    if (!held && r.pop[i] === 0 && r.pv[i] === 0) continue
    let x = r.pop[i], v = r.pv[i]
    for (let s = 0; s < steps; s++) { v += (-k * (x - (held ? 1 : 0)) - c * v) * h; x += v * h }
    if (!held && Math.abs(x) < 0.002 && Math.abs(v) < 0.02) { x = 0; v = 0 }
    r.pop[i] = x; r.pv[i] = v
  }
}
const RINGS_KEY = 'spin-rings'
const readRings = (): Voice[] => { // the instruments that were on last time
  try {
    const raw = localStorage.getItem(RINGS_KEY)
    if (raw === null) return ['bowl'] // the first visit starts with the Bowl
    const j = JSON.parse(raw)
    return Array.isArray(j) ? VOICES.filter((x) => j.includes(x)) : ['bowl'] // an empty list is allowed: you can take every instrument away
  } catch { return ['bowl'] }
}
type SpinState = { rings: Ring[]; th: Theme; fbT: number; muted: boolean; cyFrac: number; cx: number; dustR: number; dustSpin: number; W: number; H: number }
// the loop: you record how you spin the rings, and then the rings spin themselves that way, over and over
type LoopFrame = { t: number; rots: Partial<Record<Voice, number>> }
type LoopMode = 'idle' | 'rec' | 'ready' | 'play' // ready: a sample is kept and stopped; play: it is playing back
type LoopState = { repeat: boolean; pausedAt: number; mode: LoopMode; t0: number; frames: LoopFrame[]; dur: number; lastTT: number; fresh: boolean }
const rotAt = (frames: LoopFrame[], voice: Voice, tt: number): number | null => { // the recorded angle of a ring at time tt, by interpolating between two frames
  let lo = 0, hi = frames.length - 1
  while (lo < hi) { const mid = (lo + hi) >> 1; if (frames[mid].t < tt) lo = mid + 1; else hi = mid }
  const b = frames[lo], a = frames[Math.max(0, lo - 1)], rb = b.rots[voice], ra = a.rots[voice]
  if (rb === undefined && ra === undefined) return null
  if (ra === undefined) return rb!
  if (rb === undefined) return ra
  const span = b.t - a.t
  return span > 1e-6 ? ra + ((rb - ra) * (tt - a.t)) / span : rb
}
type LayerName = 'pad' | 'sub' | 'vinyl'
const LAYERS: LayerName[] = ['pad', 'sub', 'vinyl']
const LAYER_LABELS: Record<LayerName, string> = { pad: 'Pad', sub: 'Sub hum', vinyl: 'Vinyl' }
// on a phone held sideways the controls move to a column on the right and the rings take the rest, instead of being squeezed into a strip between them
const LAND_PANEL = 276
const isLandscape = (w: number, h: number) => h > 0 && h < 440 && w > h * 1.25 // measured on the screen itself, so a phone frame on a desktop page is judged by its own size
const LOOP_MAX = 30 // the longest loop that can be recorded, in seconds
const REC_RED = '#e5484d' // the record dot and its timer ring
const DEFAULT_LEVEL = 0.6 // the volume a layer's sound was designed at: a layer's volume is 0 to 1, and its gain is volume / this
const START_LEVELS: Record<LayerName, number> = { pad: 0.45, sub: 0.15, vinyl: 0.15 } // where each layer starts: the Pad sits further forward, the Sub hum and Vinyl underneath
const LEVELS_KEY = 'spin-levels-v2' // bumped so everyone picks up the new starting volumes
const readLevels = (): Record<LayerName, number> => {
  const d = { ...START_LEVELS }
  try {
    const j = JSON.parse(localStorage.getItem(LEVELS_KEY) || '{}')
    for (const n of LAYERS) if (typeof j[n] === 'number' && j[n] >= 0 && j[n] <= 1) d[n] = j[n]
  } catch { /* private mode */ }
  return d
}
type AudioBits = { ctx: AudioContext; master: GainNode; fb: GainNode; bus: Record<LayerName, GainNode> } // fb = how much of each echo feeds the next; bus = one volume knob per layer
const VOICES: Voice[] = ['bowl', 'kalimba', 'marimba', 'ripple', 'drops']
const RING_ORDER: Voice[] = VOICES // biggest ring first: Bowl outside, Drops (the bass) inside
// several rings at once: where each instrument sits in the scale (steps from its solo pitch) and how fast it runs relative to the others
const VOICE_BAND: Record<Voice, number> = { bowl: -5, marimba: -2, kalimba: 0, drops: 3, ripple: 5 }
const VOICE_GAP: Record<Voice, number> = { bowl: 1.5, marimba: 1.15, kalimba: 0.9, drops: 1.7, ripple: 1.3 }
const VOICE_LABELS:Record<Voice, string> = { bowl: 'Bowl', kalimba: 'Kalimba', marimba: 'Marimba', drops: 'Bass', ripple: 'Handpan' }
// ---- looks you can try: palette, dot count, dot shape, font
type Theme = {
  name: string; bg: string; ink: string; ring: string; dust: [string, string, string]
  pill: string; pillBorder: string; pillText: string; pressed: string; onAccent: string; accents: Record<Voice, string>
}
const THEMES = {
  // Walkman: a cool silver shell by day, a blue-black one by night, with the orange, yellow, blue, teal and red of an 80s portable.
  // Every accent is at least 3:1 against its own background; the light yellow, orange and teal are a shade deeper than the shell paint so they pass
  mono: { name: 'Mono', bg: '#0e1216', ink: '#e6ecf0', ring: '#2a323a', dust: ['#39424b', '#2b333b', '#20272e'],
    pill: '#171d23', pillBorder: '#2a323a', pillText: '#98a3ad', pressed: '#212932', onAccent: '#0e1216',
    accents: { bowl: '#ff7f3a', kalimba: '#ffd21f', marimba: '#4a8dff', drops: '#ff5043', ripple: '#27c2c4' } },
  chalk: { name: 'Chalk', bg: '#dfe3e6', ink: '#14181c', ring: '#b4bcc2', dust: ['#aab3ba', '#bec5ca', '#cbd1d5'],
    pill: '#d3d8dc', pillBorder: '#bcc3c9', pillText: '#4f5861', pressed: '#c7cdd2', onAccent: '#dfe3e6',
    accents: { bowl: '#d25818', kalimba: '#967800', marimba: '#1f5fbf', drops: '#e0392d', ripple: '#148d8f' } },
} satisfies Record<string, Theme>
type ThemeId = keyof typeof THEMES
// relative size of the five scale degrees' shapes (Kalimba tines and Marimba bars shorten up the scale, Drops dots are biggest on the first)
const KEYS = [1.15, 0.95, 0.6, 1.05, 0.8] as const
const SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif'
const dotSize = (n: number) => Math.max(3, Math.min(10, 21 / Math.sqrt(n))) // fewer dots are bigger, more dots smaller
const LOOK_KEY = 'spin-look'
const readLook = (): ThemeId => {
  const osLight = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'chalk' : 'mono' // first visit follows the device
  try {
    const j = JSON.parse(localStorage.getItem(LOOK_KEY) || '{}')
    return j.theme in THEMES ? j.theme : osLight
  } catch { return osLight }
}
const readBw = (): boolean => { try { return JSON.parse(localStorage.getItem(LOOK_KEY) || '{}').bw === true } catch { return false } }
// black and white mode: every ring is plain ink, no greys. The shapes (and the Colour/B&W swatch) tell them apart
const BW_ACCENTS: Record<ThemeId, Record<Voice, string>> = {
  mono: { bowl: '#e6ecf0', kalimba: '#e6ecf0', marimba: '#e6ecf0', drops: '#e6ecf0', ripple: '#e6ecf0' },
  chalk: { bowl: '#14181c', kalimba: '#14181c', marimba: '#14181c', drops: '#14181c', ripple: '#14181c' },
}
// the Ripple outline is sampled at this many points per frame: kept outside the frame loop so nothing is allocated while it runs
const RIPPLE_SEG = 360
const RX = new Float32Array(RIPPLE_SEG + 1), RY = new Float32Array(RIPPLE_SEG + 1), RG = new Float32Array(RIPPLE_SEG + 1)
// a tapered hairline: pointed at both ends and thickest in the middle, `half` long each way and `w` across, lying along (dx, dy). Defined once, not once per dot per frame
const lens = (ctx: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, half: number, w: number) => {
  const nx = -dy * w, ny = dx * w
  ctx.moveTo(x - dx * half, y - dy * half)
  ctx.quadraticCurveTo(x + nx, y + ny, x + dx * half, y + dy * half)
  ctx.quadraticCurveTo(x - nx, y - ny, x - dx * half, y - dy * half)
  ctx.closePath(); ctx.fill()
}
const iconProps = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
const SoundIcon = ({ off }: { off: boolean }) => (
  <svg {...iconProps}>
    <path d="M4 10v4h3l5 4V6L7 10H4z" />
    {off ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <><path d="M15.5 9a4 4 0 010 6" /><path d="M18 6.5a8 8 0 010 11" opacity=".6" /></>}
  </svg>
)
const vIcon = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const
// the Ripple shape from the canvas, simplified for 16px: a ring with twelve even crests
const RIPPLE_ICON = Array.from({ length: 193 }, (_, k) => {
  const th = (k / 192) * Math.PI * 2, r = 8.2 + 0.9 * Math.cos(th * 12)
  return `${k ? 'L' : 'M'}${(12 + Math.cos(th) * r).toFixed(2)} ${(12 + Math.sin(th) * r).toFixed(2)}`
}).join('') + 'Z'
// the instrument icons are small copies of the shapes on the rings
const ico = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const
const VOICE_ICONS: Record<Voice, React.ReactElement> = {
  bowl: <svg {...iconProps}><path d="M3.5 8a8.5 8.5 0 0 0 17 0z" /></svg>, // a half circle: flat rim, round belly
  kalimba: <svg {...iconProps}><path d="M12 4v16M6.5 7.5v12M17.5 7.5v12" /></svg>, // three tines, the middle one longest
  marimba: <svg {...iconProps}><path d="M4 5.5h16M6 12h12M8 18.5h8" /></svg>, // three bars, shortening down the scale
  drops: <svg {...ico}>{Array.from({ length: 8 }, (_, i) => { // a ring of soft diamonds
    const t = (i / 8) * Math.PI * 2, cx = 12 + Math.cos(t) * 7.6, cy = 12 + Math.sin(t) * 7.6, c = Math.cos(t), n = Math.sin(t), R = 2.6, q = 1.5, f = (v: number) => v.toFixed(2)
    return <path key={i} d={`M${f(cx + c * R)} ${f(cy + n * R)}L${f(cx - n * q)} ${f(cy + c * q)}L${f(cx - c * R)} ${f(cy - n * R)}L${f(cx + n * q)} ${f(cy - c * q)}Z`} fill="currentColor" strokeWidth={1.6} />
  })}</svg>,
  ripple: <svg {...iconProps}><path d={RIPPLE_ICON} /></svg>,
}
const TRASH_ICON = <svg {...iconProps}><path d="M5 7h14" /><path d="M10 7V5h4v2" /><path d="M7 7l1 12h8l1-12" /></svg>
const PLAY_ICON = <svg {...iconProps}><path d="M8.500 5.500v13l10-6.500z" /></svg>
const PAUSE_ICON = <svg {...iconProps}><path d="M9 6v12M15 6v12" /></svg>
const SAMPLE_ICON = <svg {...iconProps}><path d="M5 10v4M9 6.500v11M13 3.500v17M17 7.500v9M21 10.500v3" /></svg> // a little waveform: the saved sample
const PanelIcon = () => <svg {...iconProps}><circle cx="12" cy="12" r="4.5" opacity=".6" />{Array.from({ length: 12 }, (_, i) => <circle key={i} cx={(12 + Math.cos((i / 12) * Math.PI * 2) * 8.5).toFixed(2)} cy={(12 + Math.sin((i / 12) * Math.PI * 2) * 8.5).toFixed(2)} r="1.1" fill="currentColor" stroke="none" />)}</svg> // a ring of shapes, like the rings on screen
const LayersIcon = () => <svg {...iconProps}><path d="M6 4v7.8M6 16.2V20M12 4v1.8M12 10.2V20M18 4v9.8M18 18.2V20" /><circle cx="6" cy="14" r="2.2" /><circle cx="12" cy="8" r="2.2" /><circle cx="18" cy="16" r="2.2" /></svg> // a mixer: three sliders, plain lines like the layer icons
const LookIcon = () => <svg {...iconProps}><path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-1 1.6-2.1-.4-1.2.3-2.4 1.6-2.4H17a3.5 3.5 0 0 0 3.5-3.6C20.5 7.2 16.8 3.5 12 3.5z" /><circle cx="7.8" cy="11.2" r=".9" fill="currentColor" stroke="none" /><circle cx="10.4" cy="7.4" r=".9" fill="currentColor" stroke="none" /><circle cx="14.8" cy="7.6" r=".9" fill="currentColor" stroke="none" /></svg>
const LAYER_ICONS: Record<LayerName, React.ReactElement> = {
  pad: <svg {...iconProps}><path d="M3 17c3-1 4-11 9-11s6 10 9 11" /><path d="M3 20.5h18" /></svg>, // a swell: the chord rises and fades, over a baseline
  sub: <svg {...iconProps}><path d="M2.5 12c3.2-9 6.4-9 9.5 0s6.3 9 9.5 0" /></svg>, // a long, slow wave: a low frequency
  vinyl: <svg {...iconProps}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.4" /></svg>,
}
const THEME_ICONS: Record<ThemeId, React.ReactElement> = { // Mono is the dark theme, Chalk the light one
  mono: <svg {...vIcon} width={20} height={20}><path d="M20 14.2A8 8 0 0 1 9.8 4a8 8 0 1 0 10.2 10.2z" /></svg>,
  chalk: <svg {...vIcon} width={20} height={20}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" /></svg>,
}
const iconBtn = (on: boolean): React.CSSProperties => ({
  width: 44, height: 44, display: 'grid', placeItems: 'center', border: 0, borderRadius: 22, color: 'var(--ink)',
  background: on ? 'var(--pressed)' : 'transparent', transition: 'background .15s ease-out, scale .15s ease-out, opacity .5s',
})
const CSS = `
.sp-spin{position:absolute;inset:0;touch-action:none}
.sp-spin:focus{outline:none}
.sp-spin:focus-visible{outline:2px solid var(--ink);outline-offset:-4px}
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
.sp-tog{color:var(--ink);position:relative;display:flex;align-items:center;width:76px;height:36px;padding:0 8px;gap:16px;border-radius:999px;border:1px solid var(--pillb);background:var(--pill);cursor:pointer}
.sp-tog::after{content:'';position:absolute;inset:-4px}
.sp-tog .sp-sw{position:relative;z-index:1}
.sp-knob{position:absolute;left:3px;top:2px;width:30px;height:30px;border-radius:50%;border:1px solid var(--ink);box-shadow:0 0 0 1px var(--ink);transition:transform .2s cubic-bezier(.32,.72,0,1)}
.sp-tog:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.sp-tog:active{scale:.96}
.sp-sw{width:20px;height:20px;border-radius:50%;display:block}
.sp-pill input:focus-visible + span{outline:2px solid var(--ink);outline-offset:2px}
.sp-cap{height:14px;font-size:.6875rem;letter-spacing:2px;text-transform:uppercase;color:var(--pillt);white-space:nowrap}
.sp-insrow{position:relative;display:flex;gap:8px}
.sp-ins{position:relative;display:block;width:44px;height:44px;cursor:pointer}
.sp-ins input{position:absolute;opacity:0;width:1px;height:1px}
.sp-ins .ic{position:relative;display:grid;place-items:center;width:44px;height:44px;border-radius:50%;color:var(--pillt);transition:color .15s ease-out,background .15s ease-out,scale .15s ease-out}
.sp-ins svg{width:20px;height:20px}
.sp-ins input:checked + .ic{color:var(--onvc,var(--onaccent));background:var(--vc,var(--accent))}
.sp-ins:active .ic{scale:.96}
.sp-ins input:focus-visible + .ic{outline:2px solid var(--ink);outline-offset:2px}
.sp-lay{position:relative;width:44px;height:44px;padding:0;border-radius:50%;border:1px solid var(--pillb);background:var(--pill);color:var(--pillt);display:grid;place-items:center;touch-action:none;cursor:pointer;transition:background .15s ease-out,color .15s ease-out,scale .15s ease-out}
.sp-lay[aria-checked=true]{color:var(--ink);background:var(--pressed)}
.sp-lay svg.ic{width:20px;height:20px}
.sp-lay svg.ring{position:absolute;left:-1px;top:-1px;width:44px;height:44px;pointer-events:none;transform:rotate(-90deg)}
.sp-lay:active{scale:.96}
.sp-undo{position:relative;height:36px;padding:0 18px;border-radius:999px;border:1px solid var(--pillb);background:var(--pill);color:var(--ink);font-size:13px;letter-spacing:.3px;cursor:pointer}
.sp-undo::after{content:'';position:absolute;inset:-4px}
.sp-undo:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.sp-rec{animation:sp-rec 1.1s ease-in-out infinite}
@keyframes sp-rec{50%{opacity:.35}}
.sp-lay:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.sp-row{display:flex;align-items:center;justify-content:center;gap:8px}
.sp-pill:active span,.sp-btn:active{scale:.96}
.sp-root[data-switching] *,.sp-root[data-switching] *::before{transition:none !important}
/* reduced motion: nothing slides or scales, but colour and opacity still cross-fade, so every change of state stays visible */
@media (prefers-reduced-motion: reduce){
  .sp-dock{transform:none !important;transition:opacity .2s linear,visibility 0s linear .2s !important}
  .sp-pill:active span,.sp-btn:active,.sp-lay:active,.sp-tog:active,.sp-ins:active .ic{scale:1}
  .sp-rec{animation:none}
  .sp-knob{transition:none}
}
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
  const wrap = useRef<HTMLElement>(null)
  const cvs = useRef<HTMLCanvasElement>(null)
  const audio = useRef<AudioBits | null>(null)
  const knockBuf = useRef<AudioBuffer | null>(null) // a tenth of a second of white noise for the mallet knock, made on first use
  const live = useRef<number[]>([]) // when the notes still ringing will end (audio clock seconds)
  const [touched, setTouched] = useState(false)
  const [active, setActive] = useState<Voice[]>(readRings) // the instruments on the screen, biggest ring first
  const [padOn, setPadOn] = useState(false)
  const [subOn, setSubOn] = useState(false)
  const [vinylOn, setVinylOn] = useState(false)
  const [loopMode, setLoopMode] = useState<LoopMode>('idle')
  const [reviewing, setReviewing] = useState(false) // the sample menu: save, loop or discard. It replaces the other controls while it is open
  const loopEnd = useRef<() => void>()
  const [undoable, setUndoable] = useState(false) // a discarded sample can be brought back for a few seconds
  const undoRef = useRef<{ frames: LoopFrame[]; dur: number; timer: number } | null>(null)
  const pauseBtn = useRef<HTMLButtonElement>(null)
  const recBtn = useRef<HTMLButtonElement>(null)
  const wasReviewing = useRef(false)
  const [muted, setMuted] = useState(false)
  const lastPick = useRef<Ring | null>(null) // the ring you last grabbed: it keeps the grab when the gaps are tight
  const arrowRef = useRef<HTMLDivElement>(null)
  const ringTL = useRef<SVGCircleElement>(null) // the timer ring on the record button and the one on the play/pause button are drawn straight onto the SVG, so a ticking clock never re-renders the whole screen
  const ringMenu = useRef<SVGCircleElement>(null)
  const progRef = useRef(0) // how far through the recording (or the sample) we are, 0 to 1
  const setProg = (v: number) => {
    progRef.current = v
    const d = `${125.66 * v} 125.66`
    ringTL.current?.setAttribute('stroke-dasharray', d); ringMenu.current?.setAttribute('stroke-dasharray', d)
  }
  const [chrome, setChrome] = useState(true)
  const [pokeTick, setPokeTick] = useState(0)
  const [themeId, setThemeId] = useState<ThemeId>(readLook) // restored from the last visit
  const [bw, setBw] = useState<boolean>(readBw) // black and white mode, restored from the last visit
  const levelsRef = useRef<Record<LayerName, number>>(readLevels())
  const [levels, setLevels] = useState(levelsRef.current)
  const [caption, setCaption] = useState<string | null>(null) // what the line above the dock says while you're touching a layer
  const captionTimer = useRef(0)
  const drag = useRef<{ name: LayerName; y0: number; lvl0: number; moved: boolean } | null>(null)
  // three panels along the bottom, each with its own button in the top bar: the instruments, the background sounds (the mixer) and the look controls. Any mix can be open at once.
  const [instOpen, setInstOpen] = useState(true)
  const [layersOpen, setLayersOpen] = useState(true)
  const [lookOpen, setLookOpen] = useState(false)
  const [emptyHint, setEmptyHint] = useState(false) // the 'tap an instrument' hint waits a couple of seconds after the last one goes, so it only shows if you pause
  useEffect(() => {
    if (active.length > 0) { setEmptyHint(false); return }
    const t = window.setTimeout(() => setEmptyHint(true), 2200)
    return () => clearTimeout(t)
  }, [active.length])
  useEffect(() => { if (active.length === 0) setInstOpen(true) }, [active.length]) // with every instrument gone, the row to pick one from is always showing
  const theme: Theme = bw ? { ...THEMES[themeId], accents: BW_ACCENTS[themeId] } : THEMES[themeId]
  const iconOn = themeId === 'chalk' && !bw ? '#ffffff' : theme.bg // one icon colour for every coloured button in a theme, so they match: white on the light theme's deeper colours, the dark shell on the dark theme's bright ones (all at least 4:1)
  const reduceRef = useRef(false) // prefers-reduced-motion
  const padRef = useRef<{ gain: GainNode; oscs: OscillatorNode[]; lfo: OscillatorNode; timer: number } | null>(null)
  const subRef = useRef<Layer | null>(null)
  const vinylRef = useRef<Layer | null>(null)
  const loopRef = useRef<LoopState>({ repeat: true, pausedAt: 0, mode: 'idle', t0: 0, frames: [], dur: 0, lastTT: 0, fresh: false })

  const shapeScale = useRef(1) // how much the ring shapes shrink when the rings sit closer together
  const [land, setLand] = useState(false)
  useEffect(() => {
    const box = wrap.current!
    const on = () => setLand(isLandscape(box.clientWidth, box.clientHeight))
    on()
    const ro = new ResizeObserver(on); ro.observe(box)
    return () => ro.disconnect()
  }, [])
  const landRef = useRef(false)
  landRef.current = land
  const reserveRef = useRef(144) // how much of the bottom the controls cover, so the rings stay clear of them
  // where the stack of open panels ends: the sound dock (a caption line plus whichever of the instrument and mixer rows are open) sits above the look row when that is open
  const sndH = instOpen || layersOpen ? 24 + (instOpen ? 44 : 0) + (layersOpen ? 44 : 0) + (instOpen && layersOpen ? 10 : 0) : 0
  const sndBottom = lookOpen ? 72 : 16
  const stackTop = sndH ? sndBottom + sndH : lookOpen ? 52 : 0
  reserveRef.current = reviewing ? 134 : stackTop === 0 ? 80 : stackTop + (lookOpen && sndH ? 22 : 50) // the open panels plus the 'Flick to spin' line above them
  const sRef = useRef<SpinState | null>(null)
  if (!sRef.current) sRef.current = { rings: [...active].sort((x, y) => RING_ORDER.indexOf(x) - RING_ORDER.indexOf(y)).map((v) => ({ ...newRing(v, 0.15), alpha: 1 })), th: THEMES.mono as Theme, fbT: -1, muted: false, cyFrac: 0.44, cx: 0, dustR: 0, dustSpin: 0, W: 0, H: 0 }
  const s = sRef as { current: SpinState }

  s.current.th = theme // the canvas reads the look from here
  useEffect(() => { // the page behind the column and the browser bar take the palette's colour
    const html = document.documentElement
    html.classList.add('spin-active'); html.style.setProperty('--bg', theme.bg)
    const meta = document.querySelector('meta[name="theme-color"]'), prevMeta = meta?.getAttribute('content') ?? null
    meta?.setAttribute('content', theme.bg)
    // an installed iPhone app draws its status bar over the page: light text suits Mono, dark text suits Chalk (iOS may apply a change on the next launch)
    const bar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]'), prevBar = bar?.getAttribute('content') ?? null
    bar?.setAttribute('content', themeId === 'chalk' ? 'default' : 'black-translucent')
    return () => {
      html.classList.remove('spin-active'); html.style.removeProperty('--bg')
      if (meta && prevMeta !== null) meta.setAttribute('content', prevMeta)
      if (bar && prevBar !== null) bar.setAttribute('content', prevBar)
    }
  }, [theme.bg, themeId])

  useEffect(() => {
    try { localStorage.setItem(LOOK_KEY, JSON.stringify({ theme: themeId, bw })) } catch { /* private mode */ }
  }, [themeId, bw])

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

  const note = (tick: number, ring: Ring) => {
    const a = audio.current
    if (!a || s.current.muted) return
    if (a.ctx.state !== 'running') void a.ctx.resume()
    const t = a.ctx.currentTime
    const d = ((tick % 15) + 15) % 15
    // with several rings, each instrument sits in its own band (Bowl lowest, Ripple highest), moved in whole scale steps so every ring stays in key
    const shown = s.current.rings.filter((r) => !r.leaving), K = shown.length, k = shown.indexOf(ring)
    // by ring size (k = 0 is the biggest ring) or by instrument, depending on Pitch order
    const bySize = K > 1 && k >= 0 ? (0.5 - k / (K - 1)) * 10 * (TUNE.bandMode === 2 ? -1 : 1) : 0
    const shift = K > 1 && ring.voice !== 'drops' ? Math.round((TUNE.bandMode === 0 ? VOICE_BAND[ring.voice] : bySize) * TUNE.voiceBand) : 0
    const thin = 1 - TUNE.echoThin * Math.min(1, (K - 1) / 2) // tails shorten as more rings join
    if (K > 1) { // polyphony cap: when too many notes are still ringing, the newest is skipped
      live.current = live.current.filter((e) => e > t)
      if (live.current.length >= TUNE.maxNotes) return
      live.current.push(t + { bowl: 3.4, kalimba: 0.9, marimba: 0.55, ripple: 0.9, drops: TUNE.dropDecay }[ring.voice] * thin)
    } else live.current.length = 0
    const bassDeg = [0, 3, 0, 2, 3] // the bass leans on the root and the fifth, so it grounds the others instead of wandering
    const dd = ring.voice === 'drops' ? bassDeg[d % 5] : d + shift
    const f = 196 * 2 ** ((SCALE[((dd % 5) + 5) % 5] + 12 * Math.floor(dd / 5)) / 12)
    const src = soundSource(tick, ring)
    let out: AudioNode = a.master
    // Drops and Ripple sit where their shape is; with several rings every ring also takes its own side (alternating), and each note is trimmed so a crowd doesn't pile up
    const own = K > 1 && k >= 0 ? (k % 2 ? 1 : -1) * TUNE.ringPan : 0
    const placed = ring.voice === 'drops' || ring.voice === 'ripple'
    if ((placed || own !== 0) && a.ctx.createStereoPanner) {
      const pn = a.ctx.createStereoPanner(); pn.pan.value = clampPan((placed ? src.pan * TUNE.panAmount : 0) + own); pn.connect(a.master); out = pn
    }
    if (K > 1) { const trim = a.ctx.createGain(); trim.gain.value = K ** -TUNE.crowd; trim.connect(out); out = trim }
    // one partial: oscillator through an attack/decay envelope into the master bus
    const mk = (type: OscillatorType, freq: number, peak: number, attack: number, decay: number, glideTo?: number, at = 0, dest: AudioNode = out) => {
      const o = a.ctx.createOscillator(), g = a.ctx.createGain(), t0 = t + at
      o.type = type; o.frequency.setValueAtTime(freq, t0)
      if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + 0.09)
      g.gain.setValueAtTime(0, t0)
      g.gain.linearRampToValueAtTime(peak, t0 + attack)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay)
      o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + attack + decay + 0.05)
    }
    switch (ring.voice) {
      case 'bowl': // inharmonic partials that decay at different rates = a shimmering, beating tail
        { // next to other rings it becomes the bed: softer, slower to bloom, with less of the bright top
          const bed = K > 1 ? TUNE.bowlBed : 1, at = K > 1 ? 0.01 + 0.07 * (1 - TUNE.bowlBed) / 0.7 : 0.01
          mk('sine', f, 0.12 * bed, at, 3.4 * thin); mk('sine', f * 1.003, 0.06 * bed, at, 3.4 * thin)
          mk('sine', f * 2.76, 0.04 * bed * bed, at, 1.8 * thin); mk('sine', f * 5.4, 0.016 * bed * bed, at, 0.9 * thin)
        }
        break
      case 'kalimba': // short plucked attack with a metallic tick on top
        mk('triangle', f * 2, 0.15, 0.003, 0.9); mk('sine', f * 2 * 5.4, 0.03, 0.002, 0.12)
        break
      case 'marimba': { // a dry wooden bar: a short bar tone with its 4x overtone, and a tiny filtered knock of the mallet. No ring-out, so it stays out of the way of the longer voices
        mk('sine', f, 0.2, 0.003, 0.4); mk('sine', f * 4, 0.06, 0.002, 0.09)
        const kb = knockBuf.current ??= noiseBuffer(a.ctx, 1, 1, 0.1)
        const kn = a.ctx.createBufferSource(); kn.buffer = kb
        const kf = a.ctx.createBiquadFilter(); kf.type = 'bandpass'; kf.frequency.value = Math.min(f * 3, 4000); kf.Q.value = 1.4
        const kg = a.ctx.createGain(); kg.gain.setValueAtTime(0.09, t); kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.035)
        kn.connect(kf); kf.connect(kg); kg.connect(out); kn.start(t); kn.stop(t + 0.05)
        break
      }
      case 'ripple': { // a steel tongue drum: a round, resonant tone that settles from a hair sharp, with a soft octave and twelfth, then one quiet echo a touch lower
        const amp = 0.2, dec = 0.62 * thin * 1.6 // Ripple keeps its own ring time, so the Drop decay slider only shapes the bass
        mk('sine', f * 1.012, amp * 1.1, 0.003, dec, f)
        mk('sine', f * 1.016, amp * 0.55, 0.003, dec * 1.15, f * 1.004) // a slightly detuned twin: the slow beating is what makes it ring and keeps it apart from the dry Marimba
        mk('sine', f * 2.01, amp * 0.4, 0.002, dec * 0.5); mk('sine', f * 3.02, amp * 0.16, 0.002, dec * 0.25)
        RIPPLE_ECHOES.forEach(([delay, level]) => mk('sine', f * 0.994, amp * level, 0.02, dec * 0.4, undefined, delay))
        break
      }
      case 'drops': { // a warm plucked bass: a round low tone with a soft triangle body that darkens as it settles, plus its octave and fifth so a phone speaker can carry the pitch
        const amp = 0.2, dec = TUNE.dropDecay * thin * 1.8, fb = f * 0.5
        const lp = a.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.8
        lp.frequency.setValueAtTime(fb * 7, t); lp.frequency.exponentialRampToValueAtTime(fb * 1.6, t + 0.22); lp.connect(out)
        mk('sine', fb, amp * 1.5, 0.012, dec)
        mk('triangle', fb, amp * 0.9, 0.008, dec * 0.7, undefined, 0, lp)
        mk('sine', fb * 2, amp * 0.5, 0.01, dec * 0.5)
        mk('sine', fb * 3, amp * 0.18, 0.006, dec * 0.22)
        break
      }
    }
  }

  // where the dot (Drops) or crest (Ripple) that is sounding is on screen: the sound pans to its x and, for a faint dot, plays quieter
  const soundSource = (tick: number, ring: Ring) => {
    const st = s.current, N = ring.n, i = ((tick % N) + N) % N, half = st.cx || 1
    if (ring.voice === 'ripple') return { pan: clampPan((Math.cos(ring.rot + i * ring.step) * ring.R) / (half * 0.5)), vis: 1 }
    if (ring.voice === 'drops') return { pan: clampPan((Math.cos(ring.rot + i * ring.step) * ring.R) / (half * 0.5)), vis: 1 } // the Bass is a ring of beads
    return { pan: 0, vis: 1 }
  }

  // notes thin out as the ring speeds up, so a fast spin flows instead of machine-gunning
  // with several rings each instrument runs a touch faster or slower than the rest, so their notes interlock instead of landing together
  const noteGap = (ring: Ring) => {
    const gap = TUNE.gapMin + Math.min(Math.abs(ring.w) * TUNE.gapPerSpeed, TUNE.gapSpread)
    return s.current.rings.filter((r) => !r.leaving).length > 1 ? gap * (1 + (VOICE_GAP[ring.voice] - 1) * TUNE.stagger) : gap
  }

  // Pad: a soft chord that is pressed now and then, not a constant hum. Each press swells in, holds a moment and fades out, then there is a rest before the next one
  const PAD_CHORDS = [[98, 147, 196.6, 294.5], [82.4, 123.5, 164.8, 246.9], [130.8, 196, 261.6, 329.6], [73.4, 110, 146.8, 220]] // G, E minor, C, D
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
      const oscs = PAD_CHORDS[0].map((fr, i) => {
        const o = a.ctx.createOscillator()
        o.type = i % 2 ? 'triangle' : 'sine'; o.frequency.value = fr; o.detune.value = (i - 1.5) * 4
        o.connect(lp); o.start(); return o
      })
      lp.connect(gain); gain.connect(a.bus.pad)
      const pad = { gain, oscs, lfo, timer: 0 }
      padRef.current = pad
      let last = -1
      const press = () => {
        if (padRef.current !== pad) return
        const now = a.ctx.currentTime
        let c = Math.floor(Math.random() * PAD_CHORDS.length); if (c === last) c = (c + 1) % PAD_CHORDS.length; last = c // a different chord each time
        oscs.forEach((o, i) => o.frequency.setValueAtTime(PAD_CHORDS[c][i], now))
        const peak = 0.05 + Math.random() * 0.035, hold = 0.8 + Math.random() * 1.6
        gain.gain.cancelScheduledValues(now); gain.gain.setValueAtTime(gain.gain.value, now)
        gain.gain.setTargetAtTime(peak, now, 0.35) // pressed: swells in quickly
        gain.gain.setTargetAtTime(0, now + 0.9 + hold, 1.1) // lifted: fades away
        pad.timer = window.setTimeout(press, (0.9 + hold + 3.2 + Math.random() * 3.5) * 1000) // a rest, then the next press
      }
      press()
    } else if (!on && padRef.current) {
      const p = padRef.current; padRef.current = null; clearTimeout(p.timer)
      p.gain.gain.cancelScheduledValues(t); p.gain.gain.setTargetAtTime(0, t, 0.6)
      setTimeout(() => { p.oscs.forEach((o) => o.stop()); p.lfo.stop(); p.gain.disconnect() }, 4000)
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
    audio.current = null; if (padRef.current) clearTimeout(padRef.current.timer); padRef.current = null
    vinylRef.current?.stop(); vinylRef.current = null; subRef.current = null
    if (a) void a.ctx.close()
  }, [])

  useEffect(() => {
    const st = s.current
    const canvas = cvs.current!, box = wrap.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0, last = performance.now()

    const frame = () => {
      const now = performance.now() // one clock everywhere (rAF's timestamp can lag event times in Safari)
      const dt = Math.min((now - last) / 1000, 0.04); last = now
      const W = box.clientWidth, H = box.clientHeight, dpr = window.devicePixelRatio || 1
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width = W * dpr; canvas.height = H * dpr; st.W = W; st.H = H
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.fillStyle = st.th.bg; ctx.fillRect(0, 0, W, H)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const th = st.th
      // the spinner lives between the top buttons and whatever the dock takes up right now, so it centres in that space and shrinks to fit it
      const lnd = landRef.current // sideways: the controls are a column on the right, so the rings centre in the space left of it
      const top = lnd ? 16 : 60, bottom = lnd ? H - 16 : H - reserveRef.current
      const cyTarget = lnd ? 0.5 : Math.max(top + 40, (top + bottom) / 2) / H
      st.cyFrac += (cyTarget - st.cyFrac) * Math.min(1, dt * 9)
      const cx = lnd ? (W - LAND_PANEL) / 2 : W / 2, cy = H * st.cyFrac
      st.cx = cx
      if (arrowRef.current) arrowRef.current.style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px) translate(-50%, -50%)` // the spin cue sits at the centre of the rings
      const room = Math.max(Math.min((bottom - top) / 2 - 16, lnd ? cx - 16 : Infinity), 40) // the biggest ring that clears both
      const base = Math.min(Math.min(W, H) * 0.25, room)
      st.rings = st.rings.filter((r) => !(r.leaving && r.alpha < 0.01)) // a ring that has finished fading out is gone
      const rings = st.rings
      const shown = rings.filter((r) => !r.leaving)
      const K = shown.length
      // ---- layout: one instrument is the classic ring; several nest from the biggest (first in the dock) to the smallest
      const rTop = K > 1 ? Math.max(Math.min(base * 1.75, cx - 24, room), 40) : base
      const rMin = K > 1 ? Math.max(Math.min(52, rTop * 0.55), rTop - (K - 1) * 30) : 0 // neighbouring rings sit no more than 30px apart: with two or three instruments the inner ring moves out toward the outer one
      const lp = loopRef.current
      let tt = 0, resync = false
      if (lp.mode === 'play') {
        const el = (now - lp.t0) / 1000
        if (!lp.repeat && el >= lp.dur) { lp.mode = 'ready'; loopEnd.current?.() } // played through once: back to ready, the rings carry on by themselves
        else { tt = el % lp.dur; resync = lp.fresh || tt < lp.lastTT; lp.lastTT = tt; lp.fresh = false }
      }
      let fastest = 0
      for (const r of rings) {
        const k = shown.indexOf(r)
        if (k >= 0) { const target = K > 1 ? rTop - (k * (rTop - rMin)) / (K - 1) : base; r.R = r.R ? r.R + (target - r.R) * Math.min(1, dt * 9) : target }
        r.alpha += ((r.leaving ? 0 : 1) - r.alpha) * Math.min(1, dt * 8)

        // ---- physics, per ring
        let prevRot = r.rot
        let driven = false
        if (lp.mode === 'play' && !r.dragging && !r.leaving) { // the loop spins this ring the way it was recorded
          const v = rotAt(lp.frames, r.voice, tt)
          if (v !== null) {
            driven = true; r.rot = v
            if (resync) { prevRot = v; r.w = 0 } else r.w = (v - prevRot) / Math.max(dt, 0.001) // a jump back to the start is not a spin
          }
        }
        r.replay = driven
        if (!driven && !r.dragging) {
          r.w *= Math.exp(-TUNE.decay * dt) // a long, soft decay
          const floor = reduceRef.current ? Math.min(0.03, TUNE.drift) : TUNE.drift // the idle drift: almost still when motion is reduced
          if (Math.abs(r.w) < floor) r.w = floor * (r.w < 0 ? -1 : 1) // never fully stops
          r.rot += r.w * dt
        }
        // a Bowl on the outside of a stack gets more crescents, since its ring is the longest
        r.n = r.voice === 'bowl' && K > 1 && r === rings.find((x) => !x.leaving) ? Math.max(DOTS, Math.round(TUNE.bowlDots)) : DOTS
        r.step = (Math.PI * 2) / r.n
        const N = r.n, a0 = Math.floor(prevRot / r.step), a1 = Math.floor(r.rot / r.step)
        if (a1 !== a0) {
          const crossed = Math.min(Math.abs(a1 - a0), N)
          const dir = a1 > a0 ? 1 : -1
          for (let j = 1; j <= crossed; j++) trigger(r, ((a0 + dir * j) % N + N) % N)
          if (!r.leaving && now - r.lastNote > noteGap(r)) { r.lastNote = now; note(a1, r); if (TUNE.haptic && !r.replay) navigator.vibrate?.(TUNE.haptic) }
        }
        for (let i = 0; i < r.pulse.length; i++) r.pulse[i] = Math.max(0, r.pulse[i] - dt * (r.voice === 'ripple' ? 1 / RIPPLE_LIFE : 1.6))
        if (r.voice !== 'ripple') stepPops(r, dt)
        fastest = Math.max(fastest, Math.abs(r.w))
      }
      if (lp.mode === 'rec') { // while recording, write down where every ring is, every frame
        const t = (now - lp.t0) / 1000
        if (t <= LOOP_MAX) { const rots: Partial<Record<Voice, number>> = {}; for (const r of shown) rots[r.voice] = r.rot; lp.frames.push({ t, rots }) }
      }

      // ---- draw: flat and matte, solid fills only (no glow, blur, gradients or trails)
      ctx.fillStyle = th.bg
      ctx.fillRect(0, 0, W, H)
      const bf = 1 // the rings hold their size: no idle swell
      const an = audio.current
      // the echo shortens as the spinners slow: a lively tail while one spins, and only a repeat or two once they are nearly stopped
      if (an) { // only schedule a change when the target has moved: one automation event per frame piles up on the audio thread
        const fbT = TUNE.echoMin + TUNE.echoSpan * Math.min(fastest / 8, 1)
        if (Math.abs(fbT - st.fbT) > 0.004) { st.fbT = fbT; an.fb.gain.setTargetAtTime(fbT, an.ctx.currentTime, 0.2) }
      }

      // slow dust rings around the biggest ring, counter-rotating. With no instruments they stay, drifting round the size a single ring would be, so the screen is never bare
      const outer = shown[0]
      st.dustR = st.dustR ? st.dustR + ((outer ? outer.R : base) - st.dustR) * Math.min(1, dt * 6) : (outer ? outer.R : base)
      st.dustSpin = outer ? outer.rot : st.dustSpin + 0.12 * dt
      for (let k = 1; k <= 3; k++) {
        const rk = st.dustR * bf * (1 + 0.42 * k), n = 14 + k * 8
        const rot = st.dustSpin * (k % 2 ? -0.35 : 0.2) / k
        ctx.fillStyle = th.dust[k - 1]
        for (let i = 0; i < n; i++) {
          const ang = rot + (i / n) * Math.PI * 2
          ctx.beginPath(); ctx.arc(cx + Math.cos(ang) * rk, cy + Math.sin(ang) * rk, 1.7, 0, Math.PI * 2); ctx.fill()
        }
      }

      // the shapes scale with the space between neighbouring rings, so the gap between Bowl, Kalimba and Marimba stays in proportion at any size
      const spacing = K > 1 ? (rTop - rMin) / (K - 1) : Infinity
      const scTarget = Math.min(1, spacing / 27)
      shapeScale.current += (scTarget - shapeScale.current) * Math.min(1, dt * 9)
      const r0 = dotSize(DOTS) * shapeScale.current
      for (const rg of rings) {
        const R = rg.R * bf, ra = rg.alpha, N = rg.n, ripple = rg.voice === 'ripple'
        const accent = th.accents[rg.voice]
        if (rg.replay && !rg.leaving && !ripple) { // a ring the loop is turning gets a fine track, so you can see it is playing itself (it goes when you take hold of it)
          ctx.globalAlpha = 0.6 * ra; ctx.strokeStyle = th.ring; ctx.lineWidth = 1
          ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1
        }
        // no guide line behind any of the shapes: the dots alone make the ring (Ripple's rippled line is the shape itself)

        // one dot in this instrument's shape, centred at (x, y) and pointing outward along `ang`
        const drawDot = (x: number, y: number, ang: number, r: number, color: string, alpha: number, deg = -1) => {
          const m = deg < 0 ? 1 : KEYS[deg] // the five scale degrees repeat round the ring, so a graduated length or size repeats with them, like the keys of the real instrument
          const ca = Math.cos(ang), sa = Math.sin(ang)
          ctx.globalAlpha = alpha * ra; ctx.fillStyle = color; ctx.strokeStyle = color
          ctx.beginPath()
          switch (rg.voice) { // every instrument has its own shape
            case 'kalimba': lens(ctx, x, y, ca, sa, r * 1.6 * m, Math.max(1.1, r * 0.26)); break // a long, fine needle
            case 'marimba': lens(ctx, x, y, ca, sa, r * 1.4 * m, r * 0.55); break // a shorter, fuller blade
            case 'bowl': { // a bowl in profile: a flat rim facing outward with sharp pointed corners, and a smooth round belly
              const w = r * 1.4 * (deg < 0 ? 1 : 0.88 + 0.12 * m), d = w * 0.62, tx = -sa, ty = ca
              const pt = (u: number, v: number): [number, number] => [x + tx * w * u + ca * d * v, y + ty * w * u + sa * d * v] // u across the bowl, v from belly (-) to rim (+)
              const L = pt(-1, 0.45), R = pt(1, 0.45), c1 = pt(-0.7, -1.45), c2 = pt(0.7, -1.45) // the curve leaves each corner heading inward, so the corners come to a point
              ctx.moveTo(L[0], L[1]); ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], R[0], R[1])
              ctx.closePath(); ctx.fill()
              break
            }
            default: { // bass: a soft diamond, a touch longer along the ring's radius, a little bigger on the first degree
              const R = r * 0.95 * (deg < 0 ? 1 : 0.7 + 0.5 * (m - 0.6) / 0.55), tx = -sa, ty = ca
              ctx.moveTo(x + ca * R, y + sa * R); ctx.lineTo(x + tx * R * 0.55, y + ty * R * 0.55)
              ctx.lineTo(x - ca * R, y - sa * R); ctx.lineTo(x - tx * R * 0.55, y - ty * R * 0.55)
              ctx.closePath(); ctx.fill()
              ctx.lineWidth = Math.max(0.8, r * 0.2); ctx.lineJoin = 'round'; ctx.stroke() // a hairline of the same colour rounds the points off
            }
          }
          ctx.globalAlpha = 1
        }
        if (ripple) { // the whole ring is a rippled line: one ripple per detent, and the ripple that just sounded is the biggest
          const amp: number[] = [], glow: number[] = []
          for (let i = 0; i < N; i++) {
            const p = rg.pulse[i], t = (1 - p) * RIPPLE_LIFE // seconds since this ripple's note played
            const sounding = p > 0.002
            const ease = Math.min(1, p / 0.12) // eases the whole ripple out at the very end, so it never snaps flat
            // the pluck's swell plus the swells of its three echoes, at the same delays and levels as the sound
            const swell = sounding ? ease * (rippleRise(t) + RIPPLE_ECHOES.reduce((sum, [d, lv]) => sum + lv * rippleRise(t - d), 0)) : 0
            const wob = sounding && !reduceRef.current ? 1 + 0.3 * Math.exp(-t * 3) * Math.sin(t * Math.PI * 2 * 6) : 1
            amp[i] = r0 * 0.3 + r0 * 2.6 * swell * wob // every ripple is faintly there; the sounding one swells
            glow[i] = sounding ? ease * Math.exp(-t * 4.5) * (1 - Math.exp(-t * 45)) : 0
          }
          const SEG = RIPPLE_SEG
          for (let k = 0; k <= SEG; k++) {
            const th0 = (k / SEG) * Math.PI * 2, u = (th0 - rg.rot) / rg.step // position in ripple units: whole numbers are the dot positions
            const fl = Math.floor(u), f = u - fl, ia = ((fl % N) + N) % N, ib = (ia + 1) % N, sm = f * f * (3 - 2 * f)
            const A = amp[ia] * (1 - sm) + amp[ib] * sm
            const rad = R + A * Math.cos(u * Math.PI * 2) // a crest at every dot position
            RX[k] = cx + Math.cos(th0) * rad; RY[k] = cy + Math.sin(th0) * rad; RG[k] = Math.max(glow[((Math.round(u) % N) + N) % N], 0)
          }
          ctx.beginPath(); ctx.moveTo(RX[0], RY[0])
          for (let k = 1; k <= SEG; k++) ctx.lineTo(RX[k], RY[k])
          ctx.globalAlpha = ra; ctx.strokeStyle = accent; ctx.lineWidth = 1; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); ctx.globalAlpha = 1
          for (let k = 1; k <= SEG; k++) { // the ripple that just sounded lights up
            const g = (RG[k] + RG[k - 1]) / 2
            if (g > 0.03) { ctx.beginPath(); ctx.moveTo(RX[k - 1], RY[k - 1]); ctx.lineTo(RX[k], RY[k]); ctx.strokeStyle = accent; ctx.lineWidth = 1.3; ctx.globalAlpha = g * ra; ctx.stroke(); ctx.globalAlpha = 1 }
          }
        }
        for (let i = 0; i < (ripple ? 0 : N); i++) {
          const p = rg.pop[i] // a spring: 0 at rest, about 1 at the top of the pop, and a touch below 0 if it overshoots
          const ang = rg.rot + i * rg.step
          const r = r0 * (1 + p * (reduceRef.current ? Math.min(TUNE.popSize, 0.15) : TUNE.popSize))
          const x = cx + Math.cos(ang) * R, y = cy + Math.sin(ang) * R
          const tilt = rg.voice === 'marimba' || rg.voice === 'bowl' || reduceRef.current ? 0 : p * TUNE.popTilt * (i % 2 ? 1 : -1) // a passing detent also tips the shape a little, one way then the other (the Marimba bars and Bowl crescents only grow)
          drawDot(x, y, ang + tilt, r, accent, 1, i % 5)
        }
      }

      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pointerAngle = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect()
    return Math.atan2(e.clientY - (r.top + s.current.H * s.current.cyFrac), e.clientX - (r.left + s.current.cx))
  }
  // which ring a touch belongs to: the one whose edge is nearest to where the finger landed (a lone ring takes a touch anywhere)
  const pickRing = (e: React.PointerEvent): Ring | null => {
    const st = s.current, box = wrap.current!.getBoundingClientRect()
    const dist = Math.hypot(e.clientX - (box.left + st.cx), e.clientY - (box.top + st.H * st.cyFrac))
    let best: Ring | null = null, bd = Infinity
    for (const rg of st.rings) {
      if (rg.leaving) continue
      const d = Math.abs(dist - rg.R)
      if (d < bd) { bd = d; best = rg }
    }
    const last = lastPick.current // when the gaps are tight, the ring you were just spinning keeps the grab unless another is clearly nearer
    if (last && !last.leaving && st.rings.includes(last) && Math.abs(dist - last.R) <= bd + 8) best = last
    lastPick.current = best
    return best
  }
  const down = (e: React.PointerEvent) => {
    ensureAudio(); setTouched(true); setPokeTick((n) => n + 1)
    const rg = pickRing(e)
    if (!rg || rg.dragging) return // a second finger on a ring that is already held never takes it over; another ring can be held at the same time
    wrap.current!.setPointerCapture(e.pointerId)
    rg.pid = e.pointerId
    rg.dragging = true; rg.lastA = pointerAngle(e); rg.lastT = performance.now()
  }
  const move = (e: React.PointerEvent) => {
    const rg = s.current.rings.find((r) => r.dragging && r.pid === e.pointerId)
    if (!rg) return
    const a = pointerAngle(e), now = performance.now()
    const d = wrapAngle(a - rg.lastA), dt = Math.max((now - rg.lastT) / 1000, 0.001)
    const prev = rg.rot
    rg.rot += d
    rg.w = rg.w * (1 - TUNE.flick) + (d / dt) * TUNE.flick // smoothed finger velocity becomes the flick
    rg.w = Math.max(-TUNE.maxW, Math.min(TUNE.maxW, rg.w))
    const N = rg.n, a0 = Math.floor(prev / rg.step), a1 = Math.floor(rg.rot / rg.step)
    if (a1 !== a0) {
      const dir = a1 > a0 ? 1 : -1
      for (let k = 1; k <= Math.min(Math.abs(a1 - a0), N); k++) trigger(rg, ((a0 + dir * k) % N + N) % N)
      if (now - rg.lastNote > noteGap(rg)) { rg.lastNote = now; note(a1, rg); if (TUNE.haptic) navigator.vibrate?.(TUNE.haptic) }
    }
    rg.lastA = a; rg.lastT = now
  }
  const up = (e: React.PointerEvent) => {
    const rg = s.current.rings.find((r) => r.dragging && r.pid === e.pointerId)
    if (!rg) return
    rg.dragging = false
    const now = performance.now()
    if (now - rg.lastT > TUNE.holdMs) rg.w *= 0.3 // held still before release: no flick
  }

  const toggleMute = () => {
    const m = !s.current.muted
    s.current.muted = m; setMuted(m)
    const a = audio.current
    if (a) a.master.gain.setTargetAtTime(m ? 0 : 0.9, a.ctx.currentTime, 0.1) // silences the layers too
  }

  const poke = () => setPokeTick((n) => n + 1)
  // an instrument icon puts its ring on the screen or takes it off (at least one stays); the rings re-nest by their order in the dock
  const toggleVoice = (v: Voice) => {
    ensureAudio(); setTouched(true)
    const on = active.includes(v)
    const next = VOICES.filter((x) => (x === v ? !on : active.includes(x)))
    setActive(next)
    try { localStorage.setItem(RINGS_KEY, JSON.stringify(next)) } catch { /* private mode */ }
    const rings = s.current.rings
    for (const x of VOICES) {
      const ex = rings.find((r) => r.voice === x)
      if (next.includes(x)) { if (ex) ex.leaving = false; else rings.push(newRing(x, 0.8)) }
      else if (ex) ex.leaving = true
    }
    rings.sort((a, b) => RING_ORDER.indexOf(a.voice) - RING_ORDER.indexOf(b.voice))
    if (!on) note(7, rings.find((r) => r.voice === v)!)
    say(`${VOICE_LABELS[v]} ${on ? 'off' : 'on'}`)
  }
  const layerOn: Record<LayerName, boolean> = { pad: padOn, sub: subOn, vinyl: vinylOn }
  // Loop, step by step: 1. tap the record button and spin the rings. 2. tap again when done: the sample starts looping at once, and the controls give way to two choices, loop and discard.
  // Loop stops the sample and goes back to the instruments (touching a ring does the same but lets it keep playing); discard deletes it. 3. the sample sits in the bottom row, and tapping it brings the two choices back.
  const loopStart = () => { const lp = loopRef.current; if (undoRef.current) { clearTimeout(undoRef.current.timer); undoRef.current = null; setUndoable(false) } lp.pausedAt = 0; lp.mode = 'rec'; lp.t0 = performance.now(); lp.frames = []; setProg(0); setLoopMode('rec') }
  const loopPlay = (resume = false) => { const lp = loopRef.current; lp.mode = 'play'; lp.repeat = true; lp.t0 = performance.now() - (resume ? lp.pausedAt * 1000 : 0); lp.fresh = true; setProg(resume && lp.dur ? lp.pausedAt / lp.dur : 0); setLoopMode('play') }
  const loopTap = () => { // the loop slot in the bottom row
    ensureAudio(); setTouched(true)
    const lp = loopRef.current
    if (lp.mode === 'idle') loopStart()
    else if (lp.mode === 'rec') {
      const dur = lp.frames.length ? lp.frames[lp.frames.length - 1].t : 0
      if (dur < 1) { lp.mode = 'idle'; lp.frames = []; setLoopMode('idle'); say('Spin something first'); return }
      lp.dur = dur; lp.pausedAt = 0; setReviewing(true); loopPlay(); say('Playing recording') // it plays, over and over, as soon as the recording ends
    } else setReviewing(true) // a saved sample: open its choices again
  }
  const loopLoop = () => { // the sample plays over and over, from the moment recording ends, until you pause it; play picks up where it left off
    const lp = loopRef.current
    if (lp.mode === 'play') { lp.pausedAt = lp.dur > 0 ? (((performance.now() - lp.t0) / 1000) % lp.dur) : 0; lp.mode = 'ready'; setLoopMode('ready'); say('Paused') }
    else { loopPlay(true); say('Playing recording') }
  }
  const loopDiscard = () => { // the sample is kept for six seconds, so an accidental discard can be undone
    const lp = loopRef.current
    if (undoRef.current) clearTimeout(undoRef.current.timer)
    undoRef.current = { frames: lp.frames, dur: lp.dur, timer: window.setTimeout(() => { undoRef.current = null; setUndoable(false) }, 6000) }
    lp.mode = 'idle'; lp.frames = []; lp.dur = 0; lp.pausedAt = 0; setLoopMode('idle'); setReviewing(false); setUndoable(true); say('Discarded · undo available')
  }
  const loopUndo = () => {
    const u = undoRef.current, lp = loopRef.current
    if (!u || lp.mode !== 'idle') return
    clearTimeout(u.timer); undoRef.current = null; setUndoable(false)
    lp.frames = u.frames; lp.dur = u.dur; lp.pausedAt = 0; setReviewing(true); loopPlay(); say('Restored')
  }
  loopEnd.current = () => setLoopMode('ready')
  useEffect(() => { // keep keyboard and screen-reader focus with you: onto Pause when the menu opens, back onto the record button when it closes
    if (reviewing) pauseBtn.current?.focus()
    else if (wasReviewing.current) recBtn.current?.focus()
    wasReviewing.current = reviewing
  }, [reviewing])
  useEffect(() => { // the ring on the loop button is a clock: while recording it fills toward the longest length (which also ends the recording), and while playing it shows how far through the sample you are
    if (loopMode !== 'rec' && loopMode !== 'play') return
    const id = window.setInterval(() => {
      const lp = loopRef.current, t = (performance.now() - lp.t0) / 1000
      if (lp.mode === 'rec') { setProg(Math.min(1, t / LOOP_MAX)); if (t >= LOOP_MAX) loopTap() }
      else if (lp.mode === 'play' && lp.dur > 0) setProg((t % lp.dur) / lp.dur)
    }, 60)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopMode])
  const layerSet = (name: LayerName, on: boolean): boolean => {
    ensureAudio(); setTouched(true)
    if (name === 'pad') { setPadOn(on); setPad(on) }
    else if (name === 'sub') { setSubOn(on); setSub(on) }
    else { setVinylOn(on); setVinyl(on) }
    return true
  }
  const layerToggle = (name: LayerName) => { // a plain tap or click
    const on = !layerOn[name]
    if (on && levelsRef.current[name] < 0.05) setLevel(name, START_LEVELS[name])
    layerSet(name, on); say(`${LAYER_LABELS[name]} ${on ? 'on' : 'off'}`)
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
  const lastPtrUp = useRef(-1e9) // when a layer button last got a pointer release
  const layerUp = (name: LayerName) => () => {
    const d = drag.current; drag.current = null
    if (!d) return
    lastPtrUp.current = performance.now()
    if (!d.moved) layerToggle(name) // a plain tap
  }
  const layerKey = (name: LayerName) => (e: React.KeyboardEvent) => { // keyboard: arrow up and down change the volume
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault(); e.stopPropagation()
    const lv = Math.max(0, Math.min(1, levelsRef.current[name] + (e.key === 'ArrowUp' ? 0.1 : -0.1)))
    if (!layerOn[name]) layerSet(name, true)
    setLevel(name, lv); say(`${LAYER_LABELS[name]} ${Math.round(lv * 100)}%`)
  }
  // the controls slide up and fade in (250ms, ease-out) and leave a little faster (180ms): they've served their purpose
  const dockMotion = (dim: number, open: boolean): React.CSSProperties => open
    ? { opacity: chrome ? 1 : dim, transform: 'none', visibility: 'visible', transition: 'transform .25s cubic-bezier(.32,.72,0,1), opacity .25s ease-out' }
    : { opacity: 0, transform: 'translateY(14px)', visibility: 'hidden', pointerEvents: 'none', transition: 'transform .18s ease-in, opacity .18s ease-out, visibility 0s linear .18s' }
  // once a recording is looping, everything but its play/pause and discard is hidden: the only way out is to discard it
  const hideWhenLooping = (opacity: number): React.CSSProperties => reviewing
    ? { opacity: 0, visibility: 'hidden', pointerEvents: 'none', transition: 'opacity .2s ease-out, visibility 0s linear .2s' }
    : { opacity, transition: 'opacity .3s ease-out' }
  const switchTheme = (id: ThemeId) => { // a theme switch shouldn't fire every colour transition on the page
    const el = wrap.current
    if (el) { el.dataset.switching = '1'; requestAnimationFrame(() => requestAnimationFrame(() => { delete el.dataset.switching })) }
    setThemeId(id)
  }
  const switchBw = (on: boolean) => { // same quiet switch as a palette change
    const el = wrap.current
    if (el) { el.dataset.switching = '1'; requestAnimationFrame(() => requestAnimationFrame(() => { delete el.dataset.switching })) }
    setBw(on)
  }
  const stop = (e: React.PointerEvent) => { e.stopPropagation(); poke() }
  const dockPos: React.CSSProperties = land ? { left: 'auto', right: 8, width: LAND_PANEL - 8 } : { left: 8, right: 8, maxWidth: 420, margin: '0 auto' }
  const hintBottom = stackTop === 0 ? 36 : stackTop + 6 // the hint sits in the gap between the rings and the controls

  // keyboard access to the spinner itself: arrows spin it
  const onKey = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return
    poke(); ensureAudio()
    const push = (d: number) => { for (const r of s.current.rings) if (!r.leaving) r.w = Math.max(-TUNE.maxW, Math.min(TUNE.maxW, r.w + d)); setTouched(true); e.preventDefault() } // arrows spin every ring
    if (e.key === 'ArrowRight') push(3)
    else if (e.key === 'ArrowLeft') push(-3)
  }

  return (
    <main ref={wrap} className="sp-root"
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      style={{ position: 'fixed', top: 0, bottom: 0, left: 0, right: 0, maxWidth: land ? 'none' : 520, margin: '0 auto', background: 'var(--bg)', overflow: 'hidden', touchAction: 'manipulation', userSelect: 'none', // the spinner surface keeps touch-action none (its rings need every finger); the controls around it leave zoom to the browser
       
        fontFamily: SANS,
        ['--bg' as string]: theme.bg, ['--ink' as string]: theme.ink, ['--pill' as string]: theme.pill, ['--pillb' as string]: theme.pillBorder,
        ['--pillt' as string]: theme.pillText, ['--pressed' as string]: theme.pressed, ['--onaccent' as string]: theme.onAccent, ['--accent' as string]: theme.ink } as React.CSSProperties}>
      <style>{CSS}</style>
      <h1 className="sp-vh">Spin</h1>
      <canvas ref={cvs} aria-hidden="true" style={{ width: '100%', height: '100%', display: 'block' }} />
      {/* the spinner is its own focus stop (not the whole screen), so the buttons and radios around it keep their normal screen-reader behaviour */}
      <div className="sp-spin" tabIndex={0} role="group" aria-label="Spinner. Arrow keys spin every ring." onKeyDown={onKey} />
      {/* spoken updates for what the caption shows: a layer switching on or off, or its volume */}
      <div className="sp-vh" role="status" aria-live="polite">{caption ?? (loopMode === 'rec' ? 'Recording. Tap the red record button to finish.' : null)}</div>
      {TUNING && <TunePanel />}

      {/* the cue: a few quiet words in the middle of the rings (the frame loop keeps them centred). "Spin to play" until you touch anything; with no instruments, "Tap an instrument…" after a pause */}
      <div ref={arrowRef} style={{ position: 'absolute', left: 0, top: 0, width: 'max-content', maxWidth: 230, textAlign: 'center', textWrap: 'balance', color: 'var(--ink)', pointerEvents: 'none', fontSize: 13, fontWeight: 300, letterSpacing: 2, lineHeight: 1.5, textTransform: 'uppercase',
        opacity: active.length === 0 ? (emptyHint ? 0.55 : 0) : (touched ? 0 : 0.55), transition: 'opacity .6s ease-out' }}>
        {active.length === 0 ? 'Tap an instrument to start playing' : 'Spin to play'}
      </div>
      {undoable && !reviewing && <button type="button" className="sp-undo" onPointerDown={stop} onClick={loopUndo} style={{ position: 'absolute', left: land ? `calc((100% - ${LAND_PANEL}px) / 2)` : '50%', transform: 'translateX(-50%)', bottom: `calc(var(--safe-bottom) + ${land ? 56 : hintBottom + 36}px)`, zIndex: 2 }}>Undo discard</button>}
      {/* the sample: top left. Record, and once there is a recording, a button that brings back its play, pause and discard choices */}
      <div onPointerDown={stop} style={{ position: 'absolute', zIndex: 1, top: 'calc(var(--safe-top) + 8px)', left: 8, ...hideWhenLooping(chrome ? 0.9 : 0.6) }}>
        <button type="button" ref={recBtn} className="sp-lay" aria-label={loopMode === 'rec' ? 'Recording. Tap when done' : loopMode === 'idle' ? 'Record a sample' : 'Sample. Tap for play, pause and discard'}
          style={(loopMode === 'rec' || loopMode === 'play' || reviewing) ? { background: 'var(--pressed)', color: 'var(--ink)' } : undefined} onClick={loopTap}>
          {loopMode === 'rec' ? <svg {...iconProps} className="sp-rec"><circle cx="12" cy="12" r="5.5" fill={REC_RED} stroke="none" /></svg>
            : loopMode === 'idle' ? <svg {...iconProps}><circle cx="12" cy="12" r="5.500" fill="currentColor" stroke="none" /></svg>
            : SAMPLE_ICON}
          {(loopMode === 'rec' || loopMode === 'play') && <svg className="ring" viewBox="0 0 44 44" aria-hidden="true"><circle ref={ringTL} cx="22" cy="22" r="20" fill="none" stroke={loopMode === 'rec' ? REC_RED : 'var(--ink)'} strokeWidth="2" strokeLinecap="round"
            strokeDasharray={`${125.66 * progRef.current} 125.66`} /></svg>}
        </button>
      </div>
      {/* quick actions are toggle buttons: constant label, state in aria-pressed */}
      <div onPointerDown={stop} style={{ position: 'absolute', top: 'calc(var(--safe-top) + 8px)', left: 8, right: 8,
        display: 'flex', justifyContent: 'flex-end', ...hideWhenLooping(chrome ? 0.9 : 0.6) }}>
        <div style={{ display: 'flex' }}>
          <button type="button" className="sp-btn" aria-label="Instruments" aria-pressed={instOpen} aria-controls="spin-sound" style={iconBtn(instOpen)}
            onClick={() => { poke(); setInstOpen(!instOpen) }}>
            <PanelIcon />
          </button>
          <button type="button" className="sp-btn" aria-label={(padOn || subOn || vinylOn) ? 'Background sounds, some playing' : 'Background sounds'} aria-pressed={layersOpen} aria-controls="spin-layers" style={{ ...iconBtn(layersOpen), position: 'relative' }}
            onClick={() => { poke(); setLayersOpen(!layersOpen) }}>
            <LayersIcon />
            {(padOn || subOn || vinylOn) && !layersOpen && <i aria-hidden="true" style={{ position: 'absolute', top: 9, right: 9, width: 7, height: 7, borderRadius: '50%', background: 'var(--ink)' }} />}
          </button>
          <button type="button" className="sp-btn" aria-label="Look" aria-pressed={lookOpen} aria-controls="spin-look" style={iconBtn(lookOpen)}
            onClick={() => { poke(); setLookOpen(!lookOpen) }}>
            <LookIcon />
          </button>
          <button type="button" className="sp-btn" aria-label="Mute" aria-pressed={muted} style={iconBtn(muted)}
            onClick={() => { poke(); toggleMute() }}>
            <SoundIcon off={muted} />
          </button>
        </div>
      </div>

      {/* sound controls: two compact rows under the spinner, never a modal, so you can change them mid-spin */}
      <div id="spin-sound" className="sp-dock" role="group" aria-label="Sound" onPointerDown={stop}
        onPointerMove={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onPointerCancel={(e) => e.stopPropagation()}
        style={{ position: 'absolute', ...dockPos, bottom: `calc(var(--safe-bottom) + ${reviewing ? 16 : sndBottom}px)`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: 'var(--ink)',
          ...dockMotion(0.8, instOpen || layersOpen || reviewing) }}>
        <div aria-hidden="true" className="sp-cap">{caption ?? (reviewing ? (loopMode === 'play' ? 'Playing recording' : 'Paused') : null)}</div>
        {reviewing ? (
          /* the sample menu: only play or pause (it plays over and over until paused) and discard, so there is nothing else to tap */
          <div role="group" aria-label="Sample" style={{ display: 'flex', gap: 16 }}>
            <button type="button" ref={pauseBtn} className="sp-lay" aria-label={loopMode === 'play' ? 'Pause' : 'Play'} onClick={loopLoop}>
              {loopMode === 'play' ? PAUSE_ICON : PLAY_ICON}
              <svg className="ring" viewBox="0 0 44 44" aria-hidden="true"><circle ref={ringMenu} cx="22" cy="22" r="20" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" strokeDasharray={`${125.66 * progRef.current} 125.66`} /></svg>
            </button>
            <button type="button" className="sp-lay" aria-label="Discard the sample and exit" onClick={loopDiscard}>{TRASH_ICON}</button>
          </div>
        ) : (<>
        {/* any combination: each icon puts its own ring on the screen, and the rings nest from the biggest (left) to the smallest (right) */}
        {instOpen && (
        <fieldset className="sp-fs">
          <legend className="sp-vh">Instruments on the screen</legend>
          <div className="sp-insrow">
            {VOICES.map((v) => (
              <label key={v} className="sp-ins" style={{ ['--vc' as string]: theme.accents[v], ['--onvc' as string]: iconOn } as React.CSSProperties}>
                <input type="checkbox" value={v} checked={active.includes(v)} onChange={() => toggleVoice(v)} />
                <span className="ic">{VOICE_ICONS[v]}<b className="sp-vh">{VOICE_LABELS[v]}</b></span>
              </label>
            ))}
          </div>
        </fieldset>
        )}
        {/* independent layers: tap to switch on or off, press and drag up or down for volume */}
        {layersOpen && <div id="spin-layers" role="group" aria-label="Layers" style={{ display: 'flex', gap: 8 }}>
          {LAYERS.map((n) => (
            <button key={n} type="button" role="switch" className="sp-lay" aria-checked={layerOn[n]}
              aria-label={`${LAYER_LABELS[n]}${layerOn[n] ? `, volume ${Math.round(levels[n] * 100)}%` : ''}. Arrow up and down change the volume.`}
              onPointerDown={layerDown(n)} onPointerMove={layerMove} onPointerUp={layerUp(n)} onPointerCancel={() => { drag.current = null }}
              onKeyDown={layerKey(n)} onClick={() => { // a click right after a pointer release is the tap already handled; any other click (keyboard, screen reader) toggles here
                if (performance.now() - lastPtrUp.current < 700) return
                layerToggle(n)
              }}>
              {LAYER_ICONS[n]}
              {layerOn[n] && <svg className="ring" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="20" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round"
                strokeDasharray={`${125.66 * levels[n]} 125.66`} /></svg>}
            </button>
          ))}
        </div>}
        </>)}
      </div>

      {/* look controls: the palette. They sit under the instruments and layers while open, so every option is visible at once */}
      <div id="spin-look" className="sp-dock" role="group" aria-label="Look" onPointerDown={stop}
        onPointerMove={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onPointerCancel={(e) => e.stopPropagation()}
        style={{ position: 'absolute', ...dockPos, bottom: 'calc(var(--safe-bottom) + 16px)',
          display: 'flex', flexDirection: 'column', gap: 10, color: 'var(--ink)', ...dockMotion(0.8, lookOpen && !reviewing) }}>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16 }}>
        <div className="sp-row">
          <button type="button" role="switch" aria-checked={themeId === 'chalk'} aria-label="Light theme" className="sp-tog" onClick={() => switchTheme(themeId === 'chalk' ? 'mono' : 'chalk')}>
            <i className="sp-knob" style={{ transform: themeId === 'chalk' ? 'translateX(36px)' : 'none' }} />
            <span className="sp-sw" style={{ display: 'grid', placeItems: 'center' }}>{THEME_ICONS.mono}</span>
            <span className="sp-sw" style={{ display: 'grid', placeItems: 'center' }}>{THEME_ICONS.chalk}</span>
          </button></div>
        <div className="sp-row">
          <button type="button" role="switch" aria-checked={bw} aria-label="Black and white" className="sp-tog" onClick={() => switchBw(!bw)}>
            <i className="sp-knob" style={{ transform: bw ? 'translateX(36px)' : 'none' }} />
            <svg className="sp-sw" viewBox="-10 -10 20 20" aria-hidden="true">{/* five flat wedges, one per instrument colour, round a hollow centre: no gradient */}
              {VOICES.map((v, i) => {
                const a0 = (i / VOICES.length) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 1) / VOICES.length) * Math.PI * 2 - Math.PI / 2, R = 10, r = 4.2
                const P = (rad: number, ang: number) => `${(rad * Math.cos(ang)).toFixed(2)} ${(rad * Math.sin(ang)).toFixed(2)}`
                return <path key={v} fill={THEMES[themeId].accents[v]} d={`M${P(r, a0)}L${P(R, a0)}A${R} ${R} 0 0 1 ${P(R, a1)}L${P(r, a1)}A${r} ${r} 0 0 0 ${P(r, a0)}Z`} />
              })}
            </svg>
            <i className="sp-sw" style={{ background: `linear-gradient(90deg, ${theme.ink} 50%, ${theme.bg} 50%)`, boxShadow: `inset 0 0 0 1px ${theme.pillBorder}` }} />
          </button></div>
        </div>
      </div>
    </main>
  )
}
