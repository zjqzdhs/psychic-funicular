export const glassStyles = `
[data-glass-theme] {
  --glass-ink: #172d40;
  --glass-muted: #455c70;
  --glass-tint: rgb(229 248 253 / 8%);
  --glass-rim: rgb(255 255 255 / 76%);
  --glass-accent: #087586;
  --glass-edge-light: #53d7e1, #a6a3f5 42%, #ee9cd9 74%, transparent;
  --glass-shadow: 0 10px 30px rgb(25 59 82 / 11%);
}

[data-glass-theme="dark"] {
  --glass-ink: #eef8ff;
  --glass-muted: #bfd0e0;
  --glass-tint: rgb(14 28 45 / 10%);
  --glass-rim: rgb(222 242 255 / 38%);
  --glass-accent: #74e1e6;
  --glass-edge-light: white, rgb(255 255 255 / 80%) 40%, transparent;
  --glass-shadow: 0 12px 36px rgb(0 0 0 / 16%);
}

[data-glass-palette="violet"] { --glass-accent: #7854b5; }
[data-glass-theme="dark"][data-glass-palette="violet"] { --glass-accent: #d1b6ff; }
[data-glass-palette="sunrise"] { --glass-accent: #a94c22; }
[data-glass-theme="dark"][data-glass-palette="sunrise"] { --glass-accent: #ffbb8e; }

.caesar-optical-layer {
  position: fixed;
  inset: 0;
  z-index: 0;
  width: 100vw;
  height: 100dvh;
  pointer-events: none;
}

.caesar-surface {
  --glass-energy: 0;
}

.caesar-surface--static { position: relative; }

.caesar-surface::after {
  position: absolute;
  inset: 0;
  z-index: 1;
  padding: 1.5px;
  border-radius: inherit;
  background: radial-gradient(190px circle at var(--glass-x, 50%) var(--glass-y, 50%), var(--glass-edge-light));
  content: "";
  pointer-events: none;
  opacity: var(--glass-energy);
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask-composite: exclude;
  transition: opacity 450ms ease-out;
}

[data-glass-rim="false"] .caesar-surface::after,
[data-glass-motion="false"] .caesar-surface::after { display: none; }
[data-glass-rim="true"][data-glass-motion="true"] :is(input,select,textarea).caesar-surface {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--glass-accent) calc(var(--glass-energy) * 65%), transparent);
}

[data-glass] {
  border: 1px solid var(--glass-rim);
  background: var(--glass-tint);
  color: var(--glass-ink);
  box-shadow: var(--glass-shadow), inset 0 1px rgb(255 255 255 / 42%), inset 0 -1px rgb(30 56 77 / 12%);
  backdrop-filter: blur(5px) saturate(1.06);
}

[data-optical-ready="true"] { backdrop-filter: none; }
[data-optical-ready="true"] { background: transparent; }
[data-glass-motion="false"] *, [data-glass-motion="false"] *::before, [data-glass-motion="false"] *::after {
  animation: none !important;
  transition: none !important;
}
[data-glass-motion="false"] :is(button,a,summary):active { transform: none !important; scale: 1 !important; }
.tt-modal > .tt-panel, .platform-modal > .platform-modal__card { position: relative; z-index: 1; }
.tt-modal > .tt-panel[data-optical-ready="true"] { background: rgb(6 16 25 / 14%); text-shadow: 0 1px 2px rgb(0 8 16 / 28%); }
.tt-modal > .caesar-optical-layer, .platform-modal > .caesar-optical-layer { z-index: 0; }
[data-glass-motion="true"] button.caesar-surface { transition: box-shadow 250ms, scale 180ms cubic-bezier(.2,.8,.3,1.3); }
[data-glass-motion="true"] button.caesar-surface[data-glass-pressed] { scale: .985; }

@media (prefers-reduced-motion: reduce) {
  .caesar-surface, .caesar-surface::after { transition: none !important; }
}
`
