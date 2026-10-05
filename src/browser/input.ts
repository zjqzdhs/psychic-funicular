import type { StrokeGesture } from "./types"

interface Sample {
  x: number
  y: number
  time: number
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

export function gestureToStroke(
  start: Sample,
  end: Sample,
  width: number,
  height: number
): StrokeGesture {
  const dx = end.x - start.x
  const dy = start.y - end.y
  const elapsed = Math.max(40, end.time - start.time)
  const distance = Math.hypot(dx, dy)
  return {
    aim: clamp(dx / Math.max(48, width * 0.2), -1, 1),
    power: clamp(distance / elapsed / 2.2, 0.06, 1),
    spin: clamp(dy / Math.max(48, height * 0.25), -1, 1),
  }
}

/** Gesture capture is confined to the game canvas. Cancellation never fires. */
export class SwipeInput {
  private pointer: number | null = null
  private start: Sample | null = null
  private last: Sample | null = null
  private aimValue = 0
  private enabled = true
  private readonly abort = new AbortController()

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onStroke: (stroke: StrokeGesture) => void,
    private readonly onAim: (x: number) => void,
    private readonly onGesture: (active: boolean, strength: number) => void
  ) {
    const signal = this.abort.signal
    canvas.addEventListener("pointerdown", this.down, { signal })
    canvas.addEventListener("pointermove", this.move, { signal })
    canvas.addEventListener("pointerup", this.up, { signal })
    canvas.addEventListener("pointercancel", this.cancel, { signal })
    canvas.addEventListener("lostpointercapture", this.cancel, { signal })
    canvas.addEventListener("keydown", this.key, { signal })
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

  private down = (event: PointerEvent) => {
    if (!this.enabled || this.pointer !== null || event.button !== 0) return
    this.pointer = event.pointerId
    this.start = this.last = this.sample(event)
    this.canvas.setPointerCapture(event.pointerId)
    this.canvas.focus({ preventScroll: true })
    this.aim(event.clientX)
    this.onGesture(true, 0)
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
    const rect = this.canvas.getBoundingClientRect()
    this.onGesture(
      true,
      gestureToStroke(this.start, this.last, rect.width, rect.height).power
    )
  }

  private up = (event: PointerEvent) => {
    if (event.pointerId !== this.pointer || !this.start || !this.enabled) return
    const rect = this.canvas.getBoundingClientRect()
    const end = this.sample(event)
    const start = this.start
    this.cancel()
    if (Math.hypot(end.x - start.x, end.y - start.y) < 8) return
    this.onStroke(gestureToStroke(start, end, rect.width, rect.height))
  }

  private key = (event: KeyboardEvent) => {
    if (!this.enabled || event.repeat) return
    if (event.code === "Space") {
      event.preventDefault()
      this.onStroke({ aim: this.aimValue, power: 0.5, spin: 0.15 })
    } else if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
      event.preventDefault()
      this.aimValue = event.code === "ArrowLeft" ? -0.6 : 0.6
      this.onAim(this.aimValue)
    }
  }

  private cancel = () => {
    const pointer = this.pointer
    this.pointer = null
    this.start = this.last = null
    if (pointer !== null && this.canvas.hasPointerCapture(pointer))
      this.canvas.releasePointerCapture(pointer)
    this.onGesture(false, 0)
  }

  dispose() {
    this.cancel()
    this.abort.abort()
  }
}
