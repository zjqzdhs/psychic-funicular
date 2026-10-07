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
out vec4 color;
void main(){
  vec2 p=gl_FragCoord.xy;
  vec2 local=p-region.xy-region.zw*.5;
  vec2 q=abs(local)-(region.zw*.5-radius);
  float d=length(max(q,0.))+min(max(q.x,q.y),0.)-radius;
  if(d>0.) discard;
  vec2 normal=normalize(local/(region.zw*.5)+vec2(.0001));
  float edge=exp(-abs(d)/3.5);
  vec2 uv=(p-sourceBounds.xy)/sourceBounds.zw;
  vec2 offset=normal*edge*strength/sourceBounds.zw;
  vec3 refracted=vec3(texture(scene,clamp(uv+offset*1.2,.001,.999)).r,
    texture(scene,clamp(uv+offset,.001,.999)).g,
    texture(scene,clamp(uv+offset*.8,.001,.999)).b);
  float rim=exp(-abs(d+1.)*1.8);
  color=vec4(refracted+rim*.09, (1.-smoothstep(-1.,0.,d))*.98);
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
    options.selector || "[data-glass], button, input, select, summary"
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
  }
  const discover = () => {
    surfaces = Array.from(root.querySelectorAll<HTMLElement>(selector))
    surfaces.forEach((element) => element.classList.add("caesar-surface"))
    lastDraw = -Infinity
    if (!options.inGame) window.dispatchEvent(new Event("bb-glass-redraw"))
  }
  const onPointer = (event: PointerEvent) => {
    if (!preferences.rimLight || root.dataset.glassMotion === "false") return
    const target = (event.target as Element)?.closest<HTMLElement>(selector)
    if (target !== active) clearPointer()
    if (!target || !root.contains(target)) return
    active = target
    const rect = target.getBoundingClientRect()
    target.style.setProperty("--glass-x", `${event.clientX - rect.left}px`)
    target.style.setProperty("--glass-y", `${event.clientY - rect.top}px`)
    target.style.setProperty("--glass-energy", "1")
    target.toggleAttribute("data-glass-pressed", event.buttons > 0)
  }
  const release = (event: PointerEvent) => {
    if (event.pointerType === "touch" || event.type === "pointercancel")
      clearPointer()
    else active?.removeAttribute("data-glass-pressed")
  }
  updateTheme()
  discover()
  const observer = new MutationObserver((records) => {
    // Score/status text changes every frame; they do not change glass surfaces.
    if (
      records.some((record) =>
        [...record.addedNodes, ...record.removedNodes].some(
          (node) => node instanceof Element
        )
      )
    )
      discover()
  })
  observer.observe(root, { childList: true, subtree: true })
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
    const ratio = Math.min(
      devicePixelRatio || 1,
      options.quality === "high" ? 1.25 : 1
    )
    const width = Math.round(innerWidth * ratio),
      height = Math.round(innerHeight * ratio)
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    gl.viewport(0, 0, width, height)
    gl.disable(gl.SCISSOR_TEST)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const regions = surfaces
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
      .slice(0, 3)
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
      return
    }
    gl.uniform1i(uniforms.scene, 0)
    gl.uniform2f(uniforms.resolution, width, height)
    const sourceRect = source.getBoundingClientRect()
    gl.uniform4f(
      uniforms.sourceBounds,
      sourceRect.left * ratio,
      (innerHeight - sourceRect.bottom) * ratio,
      sourceRect.width * ratio,
      sourceRect.height * ratio
    )
    gl.uniform1f(uniforms.strength, (options.inGame ? 1.2 : 4) * ratio)
    gl.enable(gl.SCISSOR_TEST)
    for (const element of regions) {
      const rect = element.getBoundingClientRect()
      const x = rect.left * ratio,
        y = (innerHeight - rect.bottom) * ratio
      gl.scissor(
        Math.max(0, Math.floor(x)),
        Math.max(0, Math.floor(y)),
        Math.ceil(rect.width * ratio),
        Math.ceil(rect.height * ratio)
      )
      gl.uniform4f(
        uniforms.region,
        x,
        y,
        rect.width * ratio,
        rect.height * ratio
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
        element.classList.remove("caesar-surface")
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
