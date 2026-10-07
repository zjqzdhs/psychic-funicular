import { describe, expect, it } from "vitest"
import { applyInput, createMatch, stepMatch } from "../src/core/match"
import { PracticeCoach, missedStrokeHint } from "../src/browser/coaching"
import type { MatchEvent, MatchState } from "../src/core/types"

function emit(
  coach: PracticeCoach,
  state: MatchState,
  type: MatchEvent["type"],
  player: 0 | 1 = 0
) {
  return coach.observe({ type, player, tick: state.tick++ }, state, 0)
}
function contact(
  coach: PracticeCoach,
  state: MatchState,
  serving = false,
  power = 0.25,
  speed = 4,
  spin = 0
) {
  state.phase = "rally"
  state.lastHitter = 0
  state.serveStage = serving ? 0 : 2
  state.receiverBounces = 0
  state.players[0].paddle.stroke = {
    aimX: 0,
    power,
    spin,
    technique: spin ? "topspin" : "drive",
  }
  state.ball.velocity = { x: 0, y: speed, z: 0 }
  state.ball.spin = { x: spin ? -30 : 0, y: 0, z: 0 }
  emit(coach, state, serving ? "serve" : "hit")
}
function land(coach: PracticeCoach, state: MatchState) {
  state.serveStage = 2
  state.receiverBounces = 1
  return emit(coach, state, "bounce", 1)
}

describe("practice lessons use actual learner contact and legal landing", () => {
  it("recognizes a real core serve only after both required bounces", () => {
    const coach = new PracticeCoach()
    const state = createMatch({ mode: "practice" })
    coach.start()
    applyInput(state, 0, {
      kind: "serve",
      seq: 0,
      aimX: 0,
      power: 0.5,
      spin: 0,
    })
    let serveSeen = false
    for (let tick = 0; tick < 240 && coach.stage === "serve"; tick++) {
      stepMatch(state)
      for (const event of state.events) {
        coach.observe(event, state, 0)
        if (event.type === "serve") {
          serveSeen = true
          expect(coach.stage).toBe("serve")
        }
      }
    }
    expect(serveSeen).toBe(true)
    expect(coach.stage).toBe("power")
  })
  it("does not pass a serve on contact, own bounce, an opponent action or a fault", () => {
    const coach = new PracticeCoach()
    const state = createMatch({ mode: "practice" })
    coach.start()
    contact(coach, state, true)
    expect(coach.stage).toBe("serve")
    state.serveStage = 1
    emit(coach, state, "bounce", 0)
    expect(coach.stage).toBe("serve")
    state.phase = "point"
    emit(coach, state, "point", 1)
    state.phase = "rally"
    land(coach, state)
    emit(coach, state, "hit", 1)
    expect(coach.stage).toBe("serve")
    contact(coach, state, true)
    land(coach, state)
    expect(coach.stage).toBe("power")
  })

  it("requires a light landing, measurably faster strong landing and actual topspin landing", () => {
    const coach = new PracticeCoach()
    const state = createMatch({ mode: "practice" })
    coach.start()
    contact(coach, state, true)
    land(coach, state)
    contact(coach, state, false, 0.25, 4)
    land(coach, state)
    expect(coach.lightSpeed).toBe(4)
    contact(coach, state, false, 0.8, 4.1)
    land(coach, state)
    expect(coach.stage).toBe("power")
    contact(coach, state, false, 0.8, 7)
    land(coach, state)
    expect(coach.stage).toBe("spin")
    contact(coach, state, false, 0.6, 6, 0.65)
    state.ball.spin.x = 0
    // Re-capture a deliberately non-spinning contact: a selected label is insufficient.
    emit(coach, state, "hit")
    land(coach, state)
    expect(coach.stage).toBe("spin")
    contact(coach, state, false, 0.6, 6, 0.65)
    expect(coach.stage).toBe("spin")
    expect(land(coach, state)).toBe(true)
    expect(coach.stage).toBe("complete")
  })

  it("allows retry, skip and replay without stale contact passing a lesson", () => {
    const coach = new PracticeCoach()
    const state = createMatch({ mode: "practice" })
    coach.start()
    contact(coach, state, true)
    emit(coach, state, "let")
    land(coach, state)
    expect(coach.stage).toBe("serve")
    contact(coach, state, true)
    coach.skip()
    land(coach, state)
    expect(coach.active).toBe(false)
    coach.start()
    land(coach, state)
    expect(coach.stage).toBe("serve")
    contact(coach, state, true)
    land(coach, state)
    expect(coach.stage).toBe("power")
  })
})

describe("miss feedback only claims timing supported by the observed ball", () => {
  it("distinguishes passed/near ball, ball still approaching and unknown contact", () => {
    expect(missedStrokeHint(-0.04, -0.35)).toContain("偏晚")
    expect(missedStrokeHint(0.55, 0.12)).toContain("偏早")
    expect(missedStrokeHint(0.15, -0.12)).toContain("未触球")
    expect(missedStrokeHint(null, null)).toContain("未触球")
  })
})
