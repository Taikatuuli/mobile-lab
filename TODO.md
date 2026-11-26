# Spin: to do

Next steps for the experiment, in the order they were raised. Everything lives in `src/prototypes/spin/Spin.tsx` unless noted.

## Sound and animation

- [ ] **Match the sound to the animation for Drops (the spiral) and Ripple.**
  Iterate on how each instrument's sound and its visual move together, so what you hear fits what you see.
  - Done when: a note's attack, decay and any echoes line up with the shape's motion (the spiral lanes for Drops, the swelling ripple for Ripple), checked by ear on a phone.
  - Related: Ripple's pluck plus three echoes, and its wobble, are in `note()` and the `ripple` branch of the draw loop.

- [ ] **Make the background layers feel better when they switch on and off.**
  Improve the interaction when a base sound (Pad, Air, Ocean, Sub hum, Vinyl) turns on or off.
  - Done when: switching a layer has a clear, pleasant response in both sound (a fade that feels right) and visuals (the icon, ring and caption), and it never clicks or pops.

## Look and interface

- [ ] **Swap the icons for better ones.**
  Replace the current instrument and layer icons with clearer, better-looking ones.
  - Done when: each icon is recognizable at 20px and in both palettes, and no two icons look alike (Ocean and Ripple are both waves today).

- [ ] **Remove the unnecessary palettes: keep just dark and light.**
  Cut the palette choice down to one dark and one light look.
  - Done when: Mono (dark) and Chalk (light) are the only two, Blush is removed, and the Look swatch row and saved setting still work.

- [ ] **Add swipe gestures to show and hide the sound controls.**
  Let you swipe to hide and show the instruments and base sounds, alongside the existing Controls button.
  - Done when: a swipe down hides the dock and a swipe up shows it, without clashing with flicking the spinner.

## First launch

- [ ] **Add a first-launch onboarding.**
  Teach a new person what the toy does the first time they open it.
  - Done when: a short, skippable intro appears once on first launch (flick to spin, switch instrument, tap or drag a layer, sound needs a tap on iPhone), and it never appears again after it's been seen.
