import { describe, expect, it, vi } from "vitest"
import { gestureToStroke, SwipeInput } from "../src/browser/input"
import { DEFAULT_STROKE } from "../src/browser/types"

class CanvasStub extends EventTarget {
  captures = new Set<number>()
  setPointerCapture(id: number) {
    this.captures.add(id)
  }
  hasPointerCapture(id: number) {
    return this.captures.has(id)
  }
  releasePointerCapture(id: number) {
    this.captures.delete(id)
  }
  focus() {}
  getBoundingClientRect() {
    return { left: 0, width: 800, height: 400 }
  }
}

function pointer(type: string, values: Partial<PointerEvent> = {}) {
  const event = new Event(type)
  Object.assign(event, {
    pointerId: 1,
    clientX: 300,
    clientY: 200,
    button: 0,
    pointerType: "touch",
    ...values,
  })
  return event
}

describe("mobile stroke control", () => {
  it("uses the selected keyboard aim when pressing space", () => {
    vi.stubGlobal("window", new EventTarget())
    const canvas = new CanvasStub()
    const hit = vi.fn()
    const input = new SwipeInput(
      canvas as unknown as HTMLCanvasElement,
      hit,
      vi.fn(),
      vi.fn()
    )
    for (const code of ["ArrowLeft", "Space"]) {
      const event = new Event("keydown")
      Object.assign(event, { code, repeat: false })
      canvas.dispatchEvent(event)
    }
    expect(hit).toHaveBeenCalledWith({ aim: -0.6, ...DEFAULT_STROKE })
    input.dispose()
    vi.unstubAllGlobals()
  })

  it("allows a gentle short swipe without forcing full power", () => {
    const stroke = gestureToStroke(
      { x: 100, y: 100, time: 0 },
      { x: 100, y: 80, time: 400 },
      800,
      400
    )
    expect(stroke.power).toBeLessThan(0.1)
    expect(stroke.aim).toBe(0)
  })

  it("caps a fast diagonal swipe without losing left/right intent", () => {
    const stroke = gestureToStroke(
      { x: 300, y: 300, time: 0 },
      { x: 40, y: 40, time: 50 },
      800,
      400
    )
    expect(stroke).toEqual({ ...DEFAULT_STROKE, aim: -1, power: 1 })
  })

  it("keeps selected technique and both spin axes independent of drag direction", () => {
    const settings = {
      technique: "topspin" as const,
      power: 0.6,
      spin: 0.8,
      sideSpin: -0.5,
    }
    const left = gestureToStroke(
      { x: 200, y: 200, time: 0 },
      { x: 160, y: 120, time: 160 },
      800,
      400,
      settings
    )
    const right = gestureToStroke(
      { x: 200, y: 200, time: 0 },
      { x: 240, y: 120, time: 160 },
      800,
      400,
      settings
    )
    expect(left.aim).toBeLessThan(0)
    expect(right.aim).toBeGreaterThan(0)
    expect(left.spin).toBe(right.spin)
    expect(left.sideSpin).toBe(-0.5)
    expect(left.technique).toBe("topspin")
    expect(left.power).toBeCloseTo(right.power)
  })

  it("space reads the current control configuration instead of a fixed stroke", () => {
    vi.stubGlobal("window", new EventTarget())
    const canvas = new CanvasStub()
    const hit = vi.fn()
    let settings = { ...DEFAULT_STROKE }
    const input = new SwipeInput(
      canvas as unknown as HTMLCanvasElement,
      hit,
      vi.fn(),
      vi.fn(),
      () => settings
    )
    settings = { technique: "push", power: 0.16, spin: -0.7, sideSpin: 0.45 }
    const event = new Event("keydown")
    Object.assign(event, { code: "Space", repeat: false })
    canvas.dispatchEvent(event)
    expect(hit).toHaveBeenCalledWith({ aim: 0, ...settings })
    input.dispose()
    vi.unstubAllGlobals()
  })

  it("normalizes drag strength across equivalent mobile viewport sizes", () => {
    const large = gestureToStroke(
      { x: 100, y: 250, time: 0 },
      { x: 100, y: 150, time: 200 },
      800,
      400
    )
    const small = gestureToStroke(
      { x: 50, y: 125, time: 0 },
      { x: 50, y: 75, time: 200 },
      400,
      200
    )
    expect(large.power).toBeCloseTo(small.power)
  })

  it("never fires when pointer capture is cancelled or the game pauses", () => {
    vi.stubGlobal("window", new EventTarget())
    const canvas = new CanvasStub()
    const hit = vi.fn()
    const input = new SwipeInput(
      canvas as unknown as HTMLCanvasElement,
      hit,
      vi.fn(),
      vi.fn()
    )
    canvas.dispatchEvent(pointer("pointerdown"))
    canvas.dispatchEvent(pointer("pointermove", { clientY: 80 }))
    canvas.dispatchEvent(pointer("pointercancel"))
    canvas.dispatchEvent(pointer("pointerup", { clientY: 60 }))
    expect(hit).not.toHaveBeenCalled()
    canvas.dispatchEvent(pointer("pointerdown"))
    input.setEnabled(false)
    canvas.dispatchEvent(pointer("pointerup", { clientY: 60 }))
    expect(hit).not.toHaveBeenCalled()
    expect(canvas.captures.size).toBe(0)
    input.dispose()
    vi.unstubAllGlobals()
  })

  it("ignores a second finger and clears listeners on dispose", () => {
    vi.stubGlobal("window", new EventTarget())
    const canvas = new CanvasStub()
    const hit = vi.fn()
    const input = new SwipeInput(
      canvas as unknown as HTMLCanvasElement,
      hit,
      vi.fn(),
      vi.fn()
    )
    canvas.dispatchEvent(pointer("pointerdown"))
    canvas.dispatchEvent(pointer("pointerup", { pointerId: 2, clientY: 60 }))
    expect(hit).not.toHaveBeenCalled()
    canvas.dispatchEvent(pointer("pointerup", { clientY: 60 }))
    expect(hit).toHaveBeenCalledTimes(1)
    input.dispose()
    canvas.dispatchEvent(pointer("pointerdown"))
    canvas.dispatchEvent(pointer("pointerup", { clientY: 60 }))
    expect(hit).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})
