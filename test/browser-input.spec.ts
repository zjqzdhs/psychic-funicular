import { describe, expect, it, vi } from "vitest"
import { gestureToStroke, SwipeInput } from "../src/browser/input"

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
    expect(hit).toHaveBeenCalledWith({ aim: -0.6, power: 0.5, spin: 0.15 })
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
    expect(stroke).toEqual({ aim: -1, power: 1, spin: 1 })
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
