# Social--clone
This is a SoCal clone that is same as Reddit and Instagram but more lightweight and budget.

## IRONVEIL — Tactical Operations (game)

A tactical FPS (React 18 + Zustand + Three.js, built with **Vite**) lives in
[`game/`](game/) — run `cd game && npm install && npm run dev`, then open
<http://localhost:8000>. The start world is a real-time 3D first-person
terrain (procedurally generated Karst-9 ridges, the relay-station objective,
hostile hover drones) — **WASD + drag-aim** on desktop, floating **MOVE /
AIM thumbsticks + FIRE button** on touch devices. A realistic day/night cycle (20-minute day,
10-minute night; sun, moon, stars, spiral galaxies — `T` skips +3h, `?phase=0.75`
starts at midnight) plays over a river-carved valley with a plank bridge,
and everything is sonified with synthesized WebAudio SFX: gunshots, UI
clicks, grass/water footsteps, river, birdsong, crickets, wind (`M` mutes).

It boots straight to a **Start / Title screen** and **▶ START is playable
instantly** — the systems check (uplink, field feed, armory, squad link,
weapons) is a ~0.4s cosmetic flourish that never blocks input. INVENTORY,
SETTINGS and a mission BRIEFING (controls) are available before you deploy.
In-game, `ESC` (or the COMMAND button) opens the pause menu, which can also
**EXIT TO TITLE**. Back-navigation from the armory/settings returns to the
title screen before deployment and to the pause menu once in the field.

**Developing:** edit [`game/src/ironveil.jsx`](game/src/ironveil.jsx) (UI) and
[`game/src/world.js`](game/src/world.js) (3D world) — Vite serves with HMR on
port 8000. `npm run build` produces `game/dist/`.

### Screenshots

Captured from the running game in headless Chromium. The terrain is rendered
live by WebGL (no backdrop photo anymore); only Google Fonts was stubbed
locally during capture because the sandbox can't reach it. Desktop shots: morning deployment at spawn (river on the left) and
midnight under the stars and galaxies.

**Start menu (desktop):**

![IRONVEIL start menu](screenshots/ironveil-start-menu.png)

**Gameplay HUD — after pressing START:**

![IRONVEIL gameplay HUD](screenshots/ironveil-gameplay-hud.png)

**Midnight — stars, a spiral galaxy and moonlit ridges:**

![IRONVEIL at night](screenshots/ironveil-night.png)

**Start menu (mobile):**

![IRONVEIL start menu on mobile](screenshots/ironveil-start-menu-mobile.png)

**Pause menu (mobile):**

![IRONVEIL pause menu on mobile](screenshots/ironveil-pause-mobile.png)
