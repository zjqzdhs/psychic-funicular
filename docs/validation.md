# Local validation · 2026-10-05

This record describes the locally tested implementation and asset version `b09035069dae8d57`. It does not claim a production deployment or real-phone acceptance.

- `npm run prettify`, `npm run lint`, `npm test` and `npm run build` passed. There are 37 core, gesture and network unit tests. The standalone Vite bundle retains its size warning; the host shares Three.js and loads the route on demand.
- `node scripts/check-rig.mjs` loads the actual GLB rig and browser IK. Two players × two viewpoints × four actions × three sample times × four paddle heights produce 192 samples. Paddle-face distance from the physics contact point is below 0.05mm, rounded to 0.0mm in [the recorded report](validation/rig-contact.json). This measures alignment, not finger pressure or human anatomy.
- The browser was checked at 915×412 landscape and 390×844 portrait, including assets, serving, swinging, pause/resume, exit and a missing-asset error. Twenty load/dispose cycles returned canvases and window/document listeners to their baseline. JS heap sampling is not GPU memory or phone performance evidence.
- Two fresh Chromium contexts with separate authenticated local accounts completed a normal best-of-three match, 2:0. At 1:0 the guest disconnected during a rally, returned within 30 seconds, retained the score and replayed that serve. Local D1 stored exactly one result with `reason=completed`; neither browser reported a page error. See [the host](visual/online-host-finished.png), [guest](visual/online-guest-finished.png) and [result facts](validation/online-summary.json).
- A separate real-client/local-Worker test delayed each WebSocket direction by RTT/2 at 50, 100 and 150ms. All three cases served and returned a ball, acknowledged both inputs and agreed on score. Matching-tick state hashes agreed for 66, 68 and 69 snapshots respectively. These are controlled transport-delay tests, not three complete matches or cross-network phone tests.

The complete HTTP, WebSocket, database and latency harness belongs to the Break Builder host, which supplies the authority service. Its evidence is stored under `docs/qa/2026-10-05-table-tennis/` in that repository. Running this repository's Vite demo alone does not reproduce authenticated multiplayer.

The Blender hand close-up in [assets.md](assets.md) shows articulated mechanical fingers without a paddle. It is not proof that an anatomically natural grip has been accepted. The project currently uses stylized mechanical anatomy and assisted paddle alignment.

Phone frame timing, touch comfort on a physical device, a real weak network and interaction after public deployment remain unverified. Real-phone testing was deferred at the user's request.
