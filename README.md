# mobile-lab

Live: **https://taikatuuli.github.io/mobile-lab/** (opens straight into Spin; the list of all prototypes is at `#/lab`)

## Spin

A calm, flick-to-spin fidget toy. Best on a phone, with sound on. No goal, score or fail state.

- **Spin it:** flick or drag around the center. It has inertia and never quite stops. Every detent plays a soft note.
- **Five instruments**, each with its own sound and its own shape: Bowl (crescents), Kalimba (thin lines), Marimba (thick bars), Drops (a five-round spiral of dots in lanes that turn in opposite directions) and Ripple (a rippled ring where the ripple that just sounded is the biggest).
- **Five background layers** you can stack: Pad, Air (follows spin speed), Ocean (slow waves), Sub hum and Vinyl crackle.
- **Look:** Mono, Chalk or Blush. Remembered on the device.
- **Accessible:** real radio and switch controls, keyboard support (arrow keys spin it), reduced-motion handling, and the audio unlocks on the first tap on iOS.

Everything is synthesised with Web Audio and drawn on a canvas: no audio files, no images, no backend.

A fast sandbox for prototyping mobile experiences. Vite + React + TypeScript + Framer Motion.

## Run

```bash
npm install
npm run dev
```

Vite prints a **Network** URL (e.g. `http://192.168.x.x:5173`). Open it on your phone (same Wi-Fi) to test real touch, safe areas and keyboard behavior. On desktop, prototypes render inside a phone-sized frame.

## Add a prototype

1. Create `src/prototypes/<name>/<Name>.tsx` with a default-exported component.
2. Register it in `src/prototypes/index.ts`.
3. Open `#/<slug>`.

## Mobile defaults baked in

- `viewport-fit=cover` + safe-area CSS variables (`--safe-top`, `--safe-bottom`)
- 16px inputs (no iOS focus zoom), `100dvh`, no tap-highlight flash, no overscroll bounce
- `touch-action: manipulation`, 44px tap targets, hover only on hover-capable devices
- Dark mode via `prefers-color-scheme`

## Deploy

`npm run build` outputs `dist/` with relative paths, so it works on GitHub Pages or any static host.

## Claude Code skills

Project skills live in `.claude/skills/`:

- `new-prototype`: scaffold and register a prototype following the repo's mobile rules
- `simulator-check`: verify a prototype in the iOS Simulator, including gestures

## Archive

Earlier experiments (Invoices, Stack and Orbit) were removed from the app to keep the repo focused. They're kept in git under the tag `archive/early-prototypes`:

```bash
git show archive/early-prototypes:src/prototypes/invoices/Invoices.tsx
```

## Next

The list of what's planned is in [TODO.md](TODO.md).
