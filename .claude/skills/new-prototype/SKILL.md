---
name: new-prototype
description: Scaffold a new mobile prototype in this repo and register it. Use when the user asks to prototype, mock up, or try a mobile screen, flow, or interaction.
---

# New prototype

1. Pick a short kebab-case slug from the request (e.g. `onboarding`, `tip-sheet`).
2. Create `src/prototypes/<slug>/<PascalName>.tsx` with a default-exported component. Copy the patterns in `src/prototypes/hello/Hello.tsx` (a Framer Motion sheet) or `src/prototypes/spin/Spin.tsx` (canvas drawing, Web Audio, touch gestures): Framer Motion for gestures and sheets, CSS variables (`--bg`, `--fg`, `--muted`, `--line`, `--accent`) for color so dark mode works.
3. Register it in `src/prototypes/index.ts` (`slug`, `title`, `component`).
4. Use realistic fake data, never lorem ipsum. Keep state local; no backend.
5. Run `npx tsc -b` and `npm run build`. Fix errors before reporting done.
6. Verify with the `simulator-check` skill.

## Mobile rules

- Tap targets at least 44px; inputs at least 16px font size (iOS zoom).
- Use `var(--safe-top)` / `var(--safe-bottom)` for anything pinned to an edge, never raw `100vh`.
- Draggable rows: set `touch-action: pan-y`, and guard `onTap` so a drag doesn't also fire a tap.
- Use springs for sheets and gestures, short ease-out (under 250ms) for UI feedback. Respect `prefers-reduced-motion`.
- Every prototype needs an empty, loading or success state where relevant, not only the happy path.
