import {
  DEFAULT_STROKE,
  STROKE_PRESETS,
  type StrokeGesture,
  type StrokeSettings,
} from "./types"

interface Sample {
  x: number
  y: number
  time: number
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

export function chargePower(elapsed: number, settings = DEFAULT_STROKE) {
  return clamp(
    (0.16 + clamp((elapsed - 90) / 470, 0, 1) * 0.84) *
      (settings.power / DEFAULT_STROKE.power),
    0.04,
    1
  )
}

/** Screen position aims; vertical brushing changes spin, never horizontal aim. */
export function gestureToStroke(
  start: Sample,
  end: Sample,
  width: number,
  height: number,
  settings: StrokeSettings = DEFAULT_STROKE,
  left = 0
): StrokeGesture {
  const dy = start.y - end.y
  const elapsed = Math.max(40, end.time - start.time)
  const brushed = Math.abs(dy) >= Math.max(18, height * 0.055)
  const tapped = !brushed && elapsed < 160
  const brush = clamp(dy / Math.max(40, height * 0.25), -1, 1)
  let technique = settings.technique
  let spin = settings.spin
  if (brushed) {
    technique = dy > 0 ? "topspin" : "push"
    spin = brush
  } else if (tapped) {
    technique = "push"
    spin = -0.25
  }
  return {
    aim: clamp(((end.x - left) / Math.max(1, width) - 0.5) * 2, -1, 1),
    power: brushed
      ? clamp(
          (Math.abs(dy) / Math.max(1, height) / (elapsed / 1000)) *
            settings.power,
          0.12,
          1
        )
      : chargePower(elapsed, settings),
    spin,
    sideSpin: settings.sideSpin,
    technique,
  }
}

const shortcut = {
  KeyQ: "push",
  KeyW: "drive",
  KeyE: "topspin",
  KeyR: "smash",
} as const

/** Capture stays in the game. Blur, cancellation and menus never release a shot. */
export class SwipeInput {
  private pointer: number | null = null
  private start: Sample | null = null
  private last: Sample | null = null
  private keyStroke: {
    code: string
    time: number
    settings: StrokeSettings
  } | null = null
  private sides = new Set<string>()
  private aimValue = 0
  private enabled = true
  private readonly abort = new AbortController()

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onStroke: (stroke: StrokeGesture) => void,
    private readonly onAim: (x: number) => void,
    private readonly onGesture: (
      active: boolean,
      strength: number,
      stroke?: StrokeGesture
    ) => void,
    private readonly getSettings: () => StrokeSettings = () => DEFAULT_STROKE
  ) {
    const signal = this.abort.signal
    canvas.addEventListener("pointerdown", this.down, { signal })
    canvas.addEventListener("pointermove", this.move, { signal })
    canvas.addEventListener("pointerup", this.up, { signal })
    canvas.addEventListener("pointercancel", this.cancelPointer, { signal })
    canvas.addEventListener("lostpointercapture", this.cancelPointer, {
      signal,
    })
    const keyboard = canvas.parentElement || canvas
    keyboard.addEventListener("keydown", this.keyDown as EventListener, {
      signal,
    })
    keyboard.addEventListener("keyup", this.keyUp as EventListener, { signal })
    window.addEventListener("blur", this.cancel, { signal })
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled
    if (!enabled) this.cancel()
  }

  private sample(event: PointerEvent): Sample {
    return { x: event.clientX, y: event.clientY, time: event.timeStamp }
  }

  private aim(clientX: number) {
    const rect = this.canvas.getBoundingClientRect()
    this.aimValue = clamp(((clientX - rect.left) / rect.width - 0.5) * 2, -1, 1)
    this.onAim(this.aimValue)
  }

  private sideSpin(fallback: number) {
    return this.sides.size
      ? Number(this.sides.has("KeyD")) - Number(this.sides.has("KeyA"))
      : fallback
  }

  private pointerStroke(time?: number) {
    if (!this.start || !this.last) return null
    const rect = this.canvas.getBoundingClientRect()
    const settings = this.getSettings()
    return gestureToStroke(
      this.start,
      { ...this.last, time: time ?? this.last.time },
      rect.width,
      rect.height,
      { ...settings, sideSpin: this.sideSpin(settings.sideSpin) },
      rect.left
    )
  }

  /** Called by the existing render loop; holding still also updates the meter. */
  update(time: number) {
    if (!this.enabled) return
    const held = this.keyStroke
    const stroke = held
      ? {
          aim: this.aimValue,
          ...held.settings,
          power: chargePower(time - held.time, held.settings),
          sideSpin: this.sideSpin(held.settings.sideSpin),
        }
      : this.pointerStroke(time)
    if (stroke) this.onGesture(true, stroke.power, stroke)
  }

  private down = (event: PointerEvent) => {
    if (
      !this.enabled ||
      this.pointer !== null ||
      this.keyStroke ||
      event.button !== 0
    )
      return
    this.pointer = event.pointerId
    this.start = this.last = this.sample(event)
    this.canvas.setPointerCapture(event.pointerId)
    this.canvas.focus({ preventScroll: true })
    this.aim(event.clientX)
    this.update(event.timeStamp)
  }

  private move = (event: PointerEvent) => {
    if (!this.enabled) return
    if (this.pointer === null && event.pointerType === "mouse") {
      this.aim(event.clientX)
      return
    }
    if (event.pointerId !== this.pointer || !this.start) return
    this.last = this.sample(event)
    this.aim(event.clientX)
    this.update(event.timeStamp)
  }

  private up = (event: PointerEvent) => {
    if (event.pointerId !== this.pointer || !this.start || !this.enabled) return
    this.last = this.sample(event)
    const stroke = this.pointerStroke()
    this.releasePointer()
    this.onGesture(false, 0)
    if (stroke) this.onStroke(stroke)
  }

  private keyDown = (event: KeyboardEvent) => {
    if (
      !this.enabled ||
      event.repeat ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return
    const target = event.target as HTMLElement | null
    if (
      target?.tagName === "INPUT" ||
      target?.tagName === "SELECT" ||
      target?.tagName === "TEXTAREA"
    )
      return
    if (event.code === "Space" && target?.tagName === "BUTTON") return
    if (event.code === "KeyA" || event.code === "KeyD") {
      event.preventDefault()
      this.sides.add(event.code)
    } else if (event.code === "Space" || event.code in shortcut) {
      event.preventDefault()
      if (this.keyStroke || this.pointer !== null) return
      const selected =
        event.code === "Space"
          ? this.getSettings()
          : STROKE_PRESETS[shortcut[event.code as keyof typeof shortcut]]
      this.keyStroke = {
        code: event.code,
        time: event.timeStamp,
        settings: { ...selected },
      }
      this.update(event.timeStamp)
    } else if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
      event.preventDefault()
      this.aimValue = clamp(
        this.aimValue + (event.code === "ArrowLeft" ? -0.2 : 0.2),
        -1,
        1
      )
      this.onAim(this.aimValue)
    }
  }

  private keyUp = (event: KeyboardEvent) => {
    this.sides.delete(event.code)
    const held = this.keyStroke
    if (!this.enabled || !held || event.code !== held.code) return
    event.preventDefault()
    const stroke = {
      aim: this.aimValue,
      ...held.settings,
      power: chargePower(event.timeStamp - held.time, held.settings),
      sideSpin: this.sideSpin(held.settings.sideSpin),
    }
    this.keyStroke = null
    this.onGesture(false, 0)
    this.onStroke(stroke)
  }

  private cancelPointer = (event: PointerEvent) => {
    if (event.pointerId === this.pointer) this.cancel()
  }

  private releasePointer() {
    const pointer = this.pointer
    this.pointer = null
    this.start = this.last = null
    if (pointer !== null && this.canvas.hasPointerCapture(pointer))
      this.canvas.releasePointerCapture(pointer)
  }

  private cancel = () => {
    this.releasePointer()
    this.keyStroke = null
    this.sides.clear()
    this.onGesture(false, 0)
  }

  dispose() {
    this.cancel()
    this.abort.abort()
  }
}
