import { afterEach, describe, expect, it, vi } from "vitest"
import { chargePower, gestureToStroke, SwipeInput } from "../src/browser/input"
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
function pointer(type: string, time = 0, values: Partial<PointerEvent> = {}) {
  const event = new Event(type)
  Object.assign(event, {
    pointerId: 1,
    clientX: 600,
    clientY: 200,
    button: 0,
    pointerType: "mouse",
    ...values,
  })
  Object.defineProperty(event, "timeStamp", { value: time })
  return event
}
function key(type: string, code: string, time: number) {
  const event = new Event(type)
  Object.assign(event, { code, repeat: false })
  Object.defineProperty(event, "timeStamp", { value: time })
  return event
}
function setup() {
  vi.stubGlobal("window", new EventTarget())
  const canvas = new CanvasStub()
  const hit = vi.fn()
  const meter = vi.fn()
  const aim = vi.fn()
  const input = new SwipeInput(
    canvas as unknown as HTMLCanvasElement,
    hit,
    aim,
    meter
  )
  return { canvas, hit, input, meter, aim }
}
afterEach(() => vi.unstubAllGlobals())

describe("continuous court input", () => {
  it("a click lightly blocks and a held release continuously gains strength", () => {
    const { canvas, hit, input } = setup()
    canvas.dispatchEvent(pointer("pointerdown", 0))
    canvas.dispatchEvent(pointer("pointerup", 60))
    expect(hit.mock.calls[0][0]).toMatchObject({
      technique: "push",
      aim: 0.5,
      power: 0.16,
    })
    canvas.dispatchEvent(pointer("pointerdown", 100))
    expect(hit).toHaveBeenCalledTimes(1)
    canvas.dispatchEvent(pointer("pointerup", 500))
    expect(hit.mock.calls[1][0].power).toBeGreaterThan(0.6)
    expect(hit.mock.calls[1][0].technique).toBe("drive")
    input.dispose()
  })
  it("pointer preview, pointer release and keyboard release use the same absolute aim", () => {
    const { canvas, hit, input, aim } = setup()
    canvas.dispatchEvent(pointer("pointermove", 0))
    canvas.dispatchEvent(pointer("pointerdown", 10))
    canvas.dispatchEvent(pointer("pointerup", 70))
    canvas.dispatchEvent(key("keydown", "KeyW", 100))
    canvas.dispatchEvent(key("keyup", "KeyW", 180))
    expect(aim).toHaveBeenLastCalledWith(0.5)
    expect(hit.mock.calls.map(([stroke]) => stroke.aim)).toEqual([0.5, 0.5])
    input.dispose()
  })
  it("vertical brushing changes spin while horizontal aiming does not add sidespin", () => {
    const start = { x: 400, y: 200, time: 0 }
    const up = gestureToStroke(start, { x: 600, y: 100, time: 160 }, 800, 400)
    const down = gestureToStroke(start, { x: 600, y: 300, time: 160 }, 800, 400)
    expect(up).toMatchObject({
      aim: 0.5,
      technique: "topspin",
      spin: 1,
      sideSpin: 0,
    })
    expect(down).toMatchObject({
      aim: 0.5,
      technique: "push",
      spin: -1,
      sideSpin: 0,
    })
    expect(up.power).toBeCloseTo(down.power)
  })
  it("Q W E R directly release their strokes and A/D only modify sidespin", () => {
    const { canvas, hit, input } = setup()
    canvas.dispatchEvent(key("keydown", "KeyA", 0))
    for (const code of ["KeyQ", "KeyW", "KeyE", "KeyR"]) {
      canvas.dispatchEvent(key("keydown", code, 100))
      canvas.dispatchEvent(key("keyup", code, 200))
    }
    expect(hit.mock.calls.map(([stroke]) => stroke.technique)).toEqual([
      "push",
      "drive",
      "topspin",
      "smash",
    ])
    expect(hit.mock.calls.every(([stroke]) => stroke.sideSpin === -1)).toBe(
      true
    )
    expect(hit.mock.calls.every(([stroke]) => stroke.aim === 0)).toBe(true)
    input.dispose()
  })
  it("holding still updates the existing frame meter without an extra animation loop", () => {
    const { canvas, meter, input } = setup()
    canvas.dispatchEvent(pointer("pointerdown", 100))
    input.update(500)
    expect(meter.mock.lastCall?.[1]).toBeCloseTo(chargePower(400))
    input.dispose()
  })
  it("a held side-spin modifier survives ordinary pointer release until keyup", () => {
    const { canvas, hit, input } = setup()
    canvas.dispatchEvent(key("keydown", "KeyD", 0))
    for (const time of [100, 300]) {
      canvas.dispatchEvent(pointer("pointerdown", time))
      canvas.dispatchEvent(pointer("pointerup", time + 80))
      canvas.dispatchEvent(pointer("lostpointercapture", time + 81))
    }
    expect(hit.mock.calls.map(([stroke]) => stroke.sideSpin)).toEqual([1, 1])
    canvas.dispatchEvent(key("keyup", "KeyD", 400))
    canvas.dispatchEvent(pointer("pointerdown", 500))
    canvas.dispatchEvent(pointer("pointerup", 580))
    expect(hit.mock.lastCall?.[0].sideSpin).toBe(0)
    input.dispose()
  })
  it("space reads the selected settings, charges and fires on release only", () => {
    vi.stubGlobal("window", new EventTarget())
    const canvas = new CanvasStub()
    const hit = vi.fn()
    const settings = {
      ...DEFAULT_STROKE,
      technique: "topspin" as const,
      spin: 0.8,
      sideSpin: 0.35,
    }
    const input = new SwipeInput(
      canvas as unknown as HTMLCanvasElement,
      hit,
      vi.fn(),
      vi.fn(),
      () => settings
    )
    canvas.dispatchEvent(key("keydown", "Space", 0))
    expect(hit).not.toHaveBeenCalled()
    canvas.dispatchEvent(key("keyup", "Space", 300))
    expect(hit).toHaveBeenCalledWith({
      aim: 0,
      ...settings,
      power: chargePower(300, settings),
    })
    input.dispose()
  })
  it("cancelling, losing focus and pausing never release a pending shot", () => {
    const { canvas, hit, input } = setup()
    canvas.dispatchEvent(pointer("pointerdown", 0))
    canvas.dispatchEvent(pointer("pointercancel", 300))
    canvas.dispatchEvent(pointer("pointerup", 350))
    canvas.dispatchEvent(key("keydown", "KeyE", 400))
    window.dispatchEvent(new Event("blur"))
    canvas.dispatchEvent(key("keyup", "KeyE", 650))
    canvas.dispatchEvent(key("keydown", "Space", 700))
    input.setEnabled(false)
    canvas.dispatchEvent(key("keyup", "Space", 1000))
    expect(hit).not.toHaveBeenCalled()
    expect(canvas.captures.size).toBe(0)
    input.dispose()
  })
  it("ignores secondary fingers and removes listeners when disposed", () => {
    const { canvas, hit, input } = setup()
    canvas.dispatchEvent(pointer("pointerdown", 0, { pointerType: "touch" }))
    canvas.dispatchEvent(pointer("pointerup", 100, { pointerId: 2 }))
    expect(hit).not.toHaveBeenCalled()
    canvas.dispatchEvent(pointer("pointerup", 200))
    expect(hit).toHaveBeenCalledTimes(1)
    input.dispose()
    canvas.dispatchEvent(key("keydown", "KeyW", 300))
    canvas.dispatchEvent(key("keyup", "KeyW", 500))
    expect(hit).toHaveBeenCalledTimes(1)
  })
})
