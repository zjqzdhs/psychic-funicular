/** Shared, scene-sampled glass. Foreground controls remain native DOM. */
import { glassStyles } from "./glass-styles"

export interface GlassPreferences {
  theme: "system" | "light" | "dark"
  palette: "lagoon" | "violet" | "sunrise"
  atmosphere: "classic" | "fluid"
  rimLight: boolean
  materialMotion: boolean
  aurora: boolean
  meteors: boolean
}

const storageKey = "break-builder-glass-v1"
export const glassChangeEvent = "bb-glass-change"
export function readGlassPreferences(): GlassPreferences {
  let saved: Partial<GlassPreferences> = {}
  try {
    saved = JSON.parse(localStorage.getItem(storageKey) || "{}") || {}
  } catch {
    /* Storage is optional. */
  }
  return {
    theme: ["light", "dark"].includes(saved.theme || "")
      ? saved.theme!
      : "system",
    palette: ["violet", "sunrise"].includes(saved.palette || "")
      ? saved.palette!
      : "lagoon",
    atmosphere: saved.atmosphere === "classic" ? "classic" : "fluid",
    rimLight: saved.rimLight !== false,
    materialMotion: saved.materialMotion !== false,
    aurora: saved.aurora !== false,
    meteors: saved.meteors !== false,
  }
}

export function writeGlassPreferences(preferences: GlassPreferences) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(preferences))
  } catch {
    /* Private browsing. */
  }
  window.dispatchEvent(new Event(glassChangeEvent))
}

export function isDarkGlass(preferences = readGlassPreferences()) {
  return (
    preferences.theme === "dark" ||
    (preferences.theme === "system" &&
      matchMedia("(prefers-color-scheme: dark)").matches)
  )
}

const vertex = `#version 300 es
in vec2 position;
void main(){ gl_Position=vec4(position,0.,1.); }`
const fragment = `#version 300 es
precision highp float;
uniform sampler2D scene;
uniform vec2 resolution;
uniform vec4 sourceBounds;
uniform vec4 region;
uniform float radius;
uniform float strength;
uniform float edgeWidth;
uniform vec3 pointer;
uniform float dark;
uniform float time;
uniform float motion;
uniform float modal;
out vec4 color;
float roundedDistance(vec2 p, vec2 halfSize, float r){
  vec2 q=abs(p)-(halfSize-r);
  return length(max(q,0.))+min(max(q.x,q.y),0.)-r;
}
void main(){
  vec2 p=gl_FragCoord.xy;
  vec2 local=p-region.xy-region.zw*.5;
  vec2 halfSize=region.zw*.5;
  float d=roundedDistance(local,halfSize,radius);
  if(d>0.) discard;
  // The SDF gradient follows the actual rounded edge, not a radial oval.
  vec2 normal=normalize(vec2(
    roundedDistance(local+vec2(.5,0.),halfSize,radius)-roundedDistance(local-vec2(.5,0.),halfSize,radius),
    roundedDistance(local+vec2(0.,.5),halfSize,radius)-roundedDistance(local-vec2(0.,.5),halfSize,radius)
  )+vec2(.00001));
  float band=1.-smoothstep(0.,edgeWidth,-d);
  float bevel=sin(clamp(-d/edgeWidth,0.,1.)*3.14159);
  float touch=exp(-length(p-pointer.xy)/140.)*pointer.z;
  float flow=sin(dot(p,vec2(.018,.012))-time*.7)*.12*motion;
  vec2 uv=(p-sourceBounds.xy)/sourceBounds.zw;
  // The centre is an undistorted sample; only the narrow bevel bends the scene.
  vec2 offset=normal*bevel*strength*(1.+touch*.35+flow)/sourceBounds.zw;
  vec3 refracted=vec3(texture(scene,clamp(uv+offset*1.18,.001,.999)).r,
    texture(scene,clamp(uv+offset,.001,.999)).g,
    texture(scene,clamp(uv+offset*.82,.001,.999)).b);
  if(modal>.5){
    // Match the surrounding scrim's soft scene, rather than cut a sharp window
    // through it. Bright armour must not compete with small white labels.
    vec2 soft=vec2(5.)/sourceBounds.zw;
    vec2 sampleAt=uv+offset;
    refracted=refracted*.4+
      texture(scene,clamp(sampleAt+vec2(soft.x,soft.y),.001,.999)).rgb*.15+
      texture(scene,clamp(sampleAt+vec2(-soft.x,soft.y),.001,.999)).rgb*.15+
      texture(scene,clamp(sampleAt+vec2(soft.x,-soft.y),.001,.999)).rgb*.15+
      texture(scene,clamp(sampleAt-soft,.001,.999)).rgb*.15;
    if(dark>.5) refracted=refracted/(vec3(1.)+refracted*1.3);
    else refracted=mix(refracted,vec3(.88,.94,.96),.38);
  }
  float outer=exp(-abs(d+1.)*1.4);
  float inner=exp(-abs(d+edgeWidth*.8)*1.1);
  float light=max(0.,dot(normal,normalize(vec2(-.7,1.))));
  float reflection=outer*(.14+light*.18)+inner*.045+band*touch*.12;
  vec3 reflected=mix(vec3(.65,.91,1.),vec3(1.),dark);
  refracted*=1.-bevel*.07;
  color=vec4(refracted+reflected*reflection,(1.-smoothstep(-1.,0.,d))*.98);
}`

function compile(gl: WebGL2RenderingContext, type: number, text: string) {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, text)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function opticalPriority(element: HTMLElement) {
  if (element.closest("[role='dialog'],.platform-modal,.tt-modal")) return 100
  if (element.closest("details[open]")) return 80
  if (element.matches(".holo-topbar,.tt-scoreboard")) return 30
  return 10
}

export function mountGlassOverlay(
  root: HTMLElement,
  source: HTMLCanvasElement,
  options: {
    quality?: "low" | "balanced" | "high"
    reducedMotion?: boolean
    inGame?: boolean
    selector?: string
  } = {}
) {
  const selector =
    options.selector ||
    "[data-glass], button, a, input, select, textarea, summary"
  const style = document.createElement("style")
  style.textContent = glassStyles
  root.append(style)
  const canvas = document.createElement("canvas")
  canvas.className = "caesar-optical-layer"
  canvas.setAttribute("aria-hidden", "true")
  root.prepend(canvas)
  const gl =
    options.quality === "low"
      ? null
      : canvas.getContext("webgl2", {
          alpha: true,
          antialias: false,
          depth: false,
          powerPreference: "low-power",
        })
  let program: WebGLProgram | null = null
  let texture: WebGLTexture | null = null
  let buffer: WebGLBuffer | null = null
  let uniforms: Record<string, WebGLUniformLocation | null> = {}
  let lost = false
  const initialize = () => {
    if (!gl) return
    const vs = compile(gl, gl.VERTEX_SHADER, vertex)
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragment)
    if (!vs || !fs) {
      if (vs) {
        gl.deleteShader(vs)
      }
      if (fs) {
        gl.deleteShader(fs)
      }
      return
    }
    program = gl.createProgram()!
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program)
      program = null
      return
    }
    gl.useProgram(program)
    buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    )
    const position = gl.getAttribLocation(program, "position")
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    uniforms = Object.fromEntries(
      [
        "scene",
        "resolution",
        "sourceBounds",
        "region",
        "radius",
        "strength",
        "edgeWidth",
        "pointer",
        "dark",
        "time",
        "motion",
        "modal",
      ].map((name) => [name, gl.getUniformLocation(program!, name)])
    )
  }
  initialize()
  let preferences = readGlassPreferences()
  const media = matchMedia("(prefers-reduced-motion: reduce)")
  const darkMedia = matchMedia("(prefers-color-scheme: dark)")
  let surfaces: HTMLElement[] = []
  let active: HTMLElement | null = null
  let disposed = false
  let lastDraw = -Infinity
  let frame = 0
  const pointer = { x: innerWidth / 2, y: innerHeight / 2, energy: 0 }
  const targetPointer = { ...pointer }
  let motionTime = 0
  let lastTime = performance.now()
  const updateTheme = () => {
    preferences = readGlassPreferences()
    root.dataset.glassTheme = isDarkGlass(preferences) ? "dark" : "light"
    root.dataset.glassPalette = preferences.palette
    root.dataset.glassMotion = String(
      preferences.materialMotion && !media.matches && !options.reducedMotion
    )
    root.dataset.glassRim = String(preferences.rimLight)
    lastDraw = -Infinity
    if (!preferences.rimLight || root.dataset.glassMotion === "false")
      clearPointer()
  }
  const clearPointer = () => {
    active?.style.setProperty("--glass-energy", "0")
    active?.removeAttribute("data-glass-pressed")
    active = null
    targetPointer.energy = 0
  }
  const discover = () => {
    root
      .querySelectorAll<HTMLElement>(".tt-panel,.platform-modal__card")
      .forEach((element) => {
        element.dataset.glass = "optical"
      })
    surfaces = Array.from(root.querySelectorAll<HTMLElement>(selector))
    surfaces.forEach((element) => {
      element.classList.add("caesar-surface")
      if (getComputedStyle(element).position === "static")
        element.classList.add("caesar-surface--static")
    })
    lastDraw = -Infinity
    if (!options.inGame) window.dispatchEvent(new Event("bb-glass-redraw"))
  }
  const onPointer = (event: PointerEvent) => {
    if (!preferences.rimLight || root.dataset.glassMotion === "false") return
    const target = (event.target as Element)?.closest<HTMLElement>(selector)
    if (target !== active) clearPointer()
    if (!target || !root.contains(target)) return
    active = target
    targetPointer.x = event.clientX
    targetPointer.y = event.clientY
    targetPointer.energy = 1
    const rect = target.getBoundingClientRect()
    target.style.setProperty("--glass-x", `${event.clientX - rect.left}px`)
    target.style.setProperty("--glass-y", `${event.clientY - rect.top}px`)
    target.style.setProperty("--glass-energy", "1")
    target.toggleAttribute("data-glass-pressed", event.buttons > 0)
  }
  const release = (event: PointerEvent) => {
    if (event.pointerType === "touch" || event.type === "pointercancel")
      clearPointer()
    else {
      active?.removeAttribute("data-glass-pressed")
      targetPointer.energy = 0.45
    }
  }
  updateTheme()
  discover()
  const observer = new MutationObserver((records) => {
    // Score/status text changes every frame; they do not change glass surfaces.
    if (
      records.some(
        (record) =>
          (record.type === "attributes" &&
            record.target instanceof Element &&
            record.target.matches(
              "[data-glass],details,.tt-modal,.platform-modal,[role='dialog']"
            )) ||
          [...record.addedNodes, ...record.removedNodes].some(
            (node) => node instanceof Element
          )
      )
    )
      discover()
  })
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden", "open", "aria-hidden"],
  })
  root.addEventListener("pointermove", onPointer, { passive: true })
  root.addEventListener("pointerdown", onPointer, { passive: true })
  root.addEventListener("pointerup", release, { passive: true })
  root.addEventListener("pointercancel", release, { passive: true })
  root.addEventListener("pointerleave", clearPointer)
  window.addEventListener("blur", clearPointer)
  window.addEventListener(glassChangeEvent, updateTheme)
  window.addEventListener("storage", updateTheme)
  media.addEventListener("change", updateTheme)
  darkMedia.addEventListener("change", updateTheme)
  const onLost = (event: Event) => {
    event.preventDefault()
    lost = true
    surfaces.forEach((e) => e.removeAttribute("data-optical-ready"))
  }
  const onRestored = () => {
    lost = false
    initialize()
    lastDraw = -Infinity
  }
  canvas.addEventListener("webglcontextlost", onLost)
  canvas.addEventListener("webglcontextrestored", onRestored)
  const render = (now = performance.now()) => {
    if (
      disposed ||
      !gl ||
      !program ||
      lost ||
      document.hidden ||
      now - lastDraw < 1000 / 30 ||
      !source.width ||
      source.classList.contains("spectra-fx--fallback")
    )
      return
    lastDraw = now
    const elapsed = Math.min(0.1, Math.max(0, now - lastTime) / 1000)
    lastTime = now
    const moving = root.dataset.glassMotion === "true"
    if (moving) motionTime += elapsed
    const settle = 1 - Math.exp(-elapsed * 18)
    pointer.x += (targetPointer.x - pointer.x) * settle
    pointer.y += (targetPointer.y - pointer.y) * settle
    pointer.energy +=
      ((moving ? targetPointer.energy : 0) - pointer.energy) * settle
    const ratio = Math.min(
      devicePixelRatio || 1,
      options.quality === "high" ? 1.25 : 1
    )
    let regions = surfaces
      .filter(
        (element) =>
          element.dataset.glass === "optical" &&
          element.getClientRects().length > 0 &&
          !element.closest("details:not([open]),[hidden],[aria-hidden='true']")
      )
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        return (
          rect.bottom > 0 &&
          rect.top < innerHeight &&
          rect.right > 0 &&
          rect.left < innerWidth
        )
      })
      .sort((a, b) => opticalPriority(b) - opticalPriority(a))
      .slice(0, 3)
    const modal = regions
      .find((element) =>
        element.closest("[role='dialog'],.platform-modal,.tt-modal")
      )
      ?.closest<HTMLElement>("[role='dialog'],.platform-modal,.tt-modal")
    regions = regions.filter((element) => !modal || modal.contains(element))
    const layerHost = modal || root
    if (canvas.parentElement !== layerHost) layerHost.prepend(canvas)
    // A backdrop-filter ancestor establishes a containing block for fixed
    // children. Use this layer's actual screen rectangle after reparenting;
    // never assume a modal-hosted canvas starts at the viewport origin.
    const layerRect = canvas.getBoundingClientRect()
    const width = Math.max(1, Math.round(layerRect.width * ratio))
    const height = Math.max(1, Math.round(layerRect.height * ratio))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    const scaleX = width / Math.max(1, layerRect.width)
    const scaleY = height / Math.max(1, layerRect.height)
    gl.viewport(0, 0, width, height)
    gl.disable(gl.SCISSOR_TEST)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    surfaces.forEach((element) => {
      if (!regions.includes(element))
        element.removeAttribute("data-optical-ready")
    })
    if (!regions.length) return
    gl.useProgram(program)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    try {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source
      )
    } catch {
      surfaces.forEach((element) =>
        element.removeAttribute("data-optical-ready")
      )
      return
    }
    gl.uniform1i(uniforms.scene, 0)
    gl.uniform2f(uniforms.resolution, width, height)
    const sourceRect = source.getBoundingClientRect()
    gl.uniform4f(
      uniforms.sourceBounds,
      (sourceRect.left - layerRect.left) * scaleX,
      (layerRect.bottom - sourceRect.bottom) * scaleY,
      sourceRect.width * scaleX,
      sourceRect.height * scaleY
    )
    gl.uniform1f(uniforms.strength, (options.inGame ? 2.2 : 11) * ratio)
    gl.uniform1f(uniforms.edgeWidth, (options.inGame ? 7 : 14) * ratio)
    gl.uniform3f(
      uniforms.pointer,
      (pointer.x - layerRect.left) * scaleX,
      (layerRect.bottom - pointer.y) * scaleY,
      pointer.energy
    )
    gl.uniform1f(
      uniforms.dark,
      Number(options.inGame || isDarkGlass(preferences))
    )
    gl.uniform1f(uniforms.time, motionTime)
    gl.uniform1f(uniforms.motion, moving && !options.inGame ? 1 : 0)
    gl.uniform1f(uniforms.modal, modal ? 1 : 0)
    gl.enable(gl.SCISSOR_TEST)
    for (const element of regions) {
      const rect = element.getBoundingClientRect()
      const x = (rect.left - layerRect.left) * scaleX,
        y = (layerRect.bottom - rect.bottom) * scaleY
      gl.scissor(
        Math.max(0, Math.floor(x)),
        Math.max(0, Math.floor(y)),
        Math.ceil(rect.width * scaleX),
        Math.ceil(rect.height * scaleY)
      )
      gl.uniform4f(
        uniforms.region,
        x,
        y,
        rect.width * scaleX,
        rect.height * scaleY
      )
      gl.uniform1f(
        uniforms.radius,
        Math.min(
          parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0,
          rect.height / 2
        ) * ratio
      )
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      element.dataset.opticalReady = "true"
    }
    gl.disable(gl.SCISSOR_TEST)
  }
  // No independent render loop: caller invokes immediately after rendering its scene.
  const onScroll = () => {
    lastDraw = -Infinity
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      if (!options.inGame) window.dispatchEvent(new Event("bb-glass-redraw"))
    })
  }
  window.addEventListener("scroll", onScroll, { passive: true, capture: true })
  root.addEventListener("toggle", onScroll, true)
  return {
    render,
    dispose() {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      clearPointer()
      root.removeEventListener("pointermove", onPointer)
      root.removeEventListener("pointerdown", onPointer)
      root.removeEventListener("pointerup", release)
      root.removeEventListener("pointercancel", release)
      root.removeEventListener("pointerleave", clearPointer)
      window.removeEventListener("blur", clearPointer)
      window.removeEventListener(glassChangeEvent, updateTheme)
      window.removeEventListener("storage", updateTheme)
      window.removeEventListener("scroll", onScroll, true)
      root.removeEventListener("toggle", onScroll, true)
      media.removeEventListener("change", updateTheme)
      darkMedia.removeEventListener("change", updateTheme)
      canvas.removeEventListener("webglcontextlost", onLost)
      canvas.removeEventListener("webglcontextrestored", onRestored)
      surfaces.forEach((element) => {
        element.classList.remove("caesar-surface", "caesar-surface--static")
        element.removeAttribute("data-optical-ready")
      })
      if (gl) {
        gl.deleteTexture(texture)
        gl.deleteBuffer(buffer)
        gl.deleteProgram(program)
      }
      canvas.remove()
      style.remove()
    },
  }
}
