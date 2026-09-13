# Urbana Redemption

A self-contained playable vertical slice for the original frontier action-adventure **Urbana Redemption**. It runs as a WebGL 3D game in the browser and is structured to be wrapped for Android with Capacitor.

## Run

```bash
npm run dev
```

Open the local preview, choose **NEW JOURNEY**, and enter Cinderwell. The slice includes third-person exploration, horse riding and bonding, wildlife, revolver combat, law response, a story mission, hunting activity, dialogue, day/night, weather, save/load, pause/settings, responsive keyboard controls, and touch controls.

### Controls

- `WASD` move · `Shift` sprint · mouse drag camera
- `E` interact / talk · `Space` continue dialogue / mount near horse
- `F` whistle · `R` reload · `Q` switch weapon · `Esc` pause
- Left mouse button aims/fires; on touch, use the on-screen controls

## Android shell

`capacitor.config.json` contains the app identity and web root for a Capacitor Android project. The repository intentionally keeps the first phase asset-light so the vertical slice stays fast on mobile; future regions can be streamed into the same modular renderer.
