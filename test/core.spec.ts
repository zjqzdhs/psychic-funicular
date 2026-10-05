import { describe, expect, it } from "vitest"
import {
  AI_LEVELS,
  BALL_RADIUS,
  FIXED_DT,
  PADDLE_Y,
  PHYSICS_HZ,
  TABLE,
  accelerate,
  applyInput,
  awardForfeit,
  awardPoint,
  createMatch,
  createSnapshot,
  firstContact,
  restoreSnapshot,
  serverForScore,
  stepMatch,
  vec,
} from "../src/core/index"
import type { MatchState, PlayerId, PlayerInput } from "../src/core/index"

const stroke = (kind: PlayerInput["kind"], seq = 0): PlayerInput => ({
  kind,
  seq,
  aimX: 0,
  power: 0.5,
  spin: 0,
})
function advance(state: MatchState, seconds: number) {
  for (let i = 0; i < Math.round(seconds * PHYSICS_HZ); i++) stepMatch(state)
}
function score(state: MatchState, player: PlayerId) {
  state.phase = "rally"
  awardPoint(state, player, "miss")
  advance(state, 1.12)
}
function returnBall(state: MatchState, player: PlayerId, aimX = 0, spin = 0) {
  const p = state.players[player]
  if (state.phase === "serve" && state.server === player) {
    applyInput(state, player, { ...stroke("serve", p.lastInputSeq + 1), aimX })
  } else if (
    state.phase === "rally" &&
    state.lastHitter !== player &&
    state.receiverBounces &&
    state.serveStage === 2
  ) {
    const time =
      (p.paddle.position.y - state.ball.position.y) / state.ball.velocity.y
    if (
      time > 0 &&
      time < 0.09 &&
      Math.sign(state.ball.velocity.y) === state.ends[player]
    ) {
      applyInput(state, player, {
        ...stroke("swing", p.lastInputSeq + 1),
        aimX,
        spin,
      })
    }
  }
}

describe("continuous collision detection", () => {
  it("catches a table collision even when the whole surface is crossed in one tick", () => {
    const s = createMatch()
    s.ball.position = vec(0, 0.6, TABLE.height + 0.15)
    s.ball.velocity = vec(0, 0, -70)
    const hit = firstContact(s.ball, FIXED_DT, [], 1)
    expect(hit?.kind).toBe("table")
    expect(hit?.position.z).toBeCloseTo(TABLE.height + BALL_RADIUS)
  })
  it("does not bounce balls whose swept path misses the finite tabletop", () => {
    const s = createMatch()
    s.ball.position = vec(1.2, 0.6, TABLE.height + 0.15)
    s.ball.velocity = vec(0, 0, -70)
    expect(firstContact(s.ball, FIXED_DT, [], 1)).toBeUndefined()
  })
  it("catches a fast ball crossing the net and allows one passing above it", () => {
    const s = createMatch()
    s.ball.position = vec(0, -0.2, TABLE.height + 0.07)
    s.ball.velocity = vec(0, 80, 0)
    expect(firstContact(s.ball, FIXED_DT, [], 1)?.kind).toBe("net")
    s.ball.position.z = TABLE.height + TABLE.netHeight + 0.04
    expect(firstContact(s.ball, FIXED_DT, [], 1)).toBeUndefined()
  })
  it("catches a fast ball crossing an active racket, but not a mistimed or lateral miss", () => {
    const s = createMatch()
    s.ball.position = vec(0, PADDLE_Y - 0.3, 1.05)
    s.ball.velocity = vec(0, 80, 0)
    s.players[1].paddle.activeUntil = 100
    expect(firstContact(s.ball, FIXED_DT, s.players, 1)?.player).toBe(1)
    expect(firstContact(s.ball, FIXED_DT, s.players, 101)).toBeUndefined()
    s.ball.position.x = 0.4
    expect(firstContact(s.ball, FIXED_DT, s.players, 1)).toBeUndefined()
  })
  it("interpolates a moving racket to contact time instead of only using its end position", () => {
    const s = createMatch()
    s.ball.position = vec(0, PADDLE_Y - BALL_RADIUS - 80 * FIXED_DT * 0.5, 1.05)
    s.ball.velocity = vec(0, 80, 0)
    s.players[1].paddle.activeUntil = 10
    s.players[1].paddle.position.x = 0.3
    s.players[1].paddle.velocity.x = 72
    expect(firstContact(s.ball, FIXED_DT, s.players, 1)?.player).toBe(1)
  })
})

describe("11 point, win by two, best of three rules", () => {
  it("serves twice then changes, but changes every point after deuce", () => {
    expect(
      [
        [0, 0],
        [1, 0],
        [2, 0],
        [9, 10],
        [10, 10],
        [11, 10],
        [11, 11],
        [12, 11],
      ].map((pair) => serverForScore(0, pair as [number, number]))
    ).toEqual([0, 0, 1, 1, 0, 1, 0, 1])
  })
  it("does not finish at 11:10; wins at 12:10 and changes the first server and ends", () => {
    const s = createMatch({ mode: "friend" })
    s.scores = [10, 10]
    score(s, 0)
    expect(s.scores).toEqual([11, 10])
    expect(s.games).toEqual([0, 0])
    score(s, 0)
    expect(s.games).toEqual([1, 0])
    expect(s.scores).toEqual([0, 0])
    expect(s.gameFirstServer).toBe(1)
    expect(s.ends).toEqual([1, -1])
    for (let i = 0; i < 11; i++) score(s, 0)
    expect(s.phase).toBe("finished")
    expect(s.winner).toBe(0)
  })
  it("changes ends at five in the deciding game exactly once", () => {
    const s = createMatch({ mode: "friend" })
    for (let i = 0; i < 11; i++) score(s, 0)
    for (let i = 0; i < 11; i++) score(s, 1)
    expect(s.gameIndex).toBe(2)
    expect(s.ends).toEqual([-1, 1])
    for (let i = 0; i < 5; i++) score(s, 0)
    expect(s.ends).toEqual([1, -1])
    for (let i = 0; i < 5; i++) score(s, 1)
    expect(s.ends).toEqual([1, -1])
  })
  it("requires the serve to bounce on each half and awards a missed return once", () => {
    const s = createMatch({ mode: "friend" })
    applyInput(s, 0, stroke("serve"))
    const seen: number[] = []
    for (let i = 0; i < 150; i++) {
      stepMatch(s)
      if (s.events.some((e) => e.type === "bounce")) seen.push(s.serveStage)
    }
    expect(seen.slice(0, 2)).toEqual([1, 2])
    expect(s.scores).toEqual([1, 0])
    advance(s, 2)
    expect(s.scores).toEqual([1, 0])
  })
  it("replays a valid serve that grazed the net without changing the score or server", () => {
    const s = createMatch({ mode: "friend" })
    applyInput(s, 0, stroke("serve"))
    s.serveStage = 1
    s.ball.position = vec(0, -0.04, TABLE.height + TABLE.netHeight + 0.005)
    s.ball.velocity = vec(0, 4, -0.1)
    for (let i = 0; i < 100 && s.phase === "rally"; i++) stepMatch(s)
    expect(s.events.some((e) => e.type === "let")).toBe(true)
    expect(s.scores).toEqual([0, 0])
    advance(s, 1.2)
    expect(s.phase).toBe("serve")
    expect(s.server).toBe(0)
  })
  it("awards an invalid netted serve to the receiver instead of calling it a let", () => {
    const s = createMatch({ mode: "friend" })
    applyInput(s, 0, stroke("serve"))
    s.serveStage = 1
    s.ball.position = vec(0, -0.04, TABLE.height + 0.045)
    s.ball.velocity = vec(0, 4, -0.1)
    advance(s, 2)
    expect(s.scores).toEqual([0, 1])
  })
  it("rejects volleys, wrong-side bounces and double bounces", () => {
    const volley = createMatch({ mode: "friend" })
    applyInput(volley, 0, stroke("serve"))
    volley.ball.position = vec(0, PADDLE_Y - 0.05, 1.05)
    volley.ball.velocity = vec(0, 8, 0)
    applyInput(volley, 1, stroke("swing"))
    advance(volley, 0.02)
    expect(volley.pointWinner).toBe(0)
    for (const ownHalf of [false, true]) {
      const s = createMatch({ mode: "friend" })
      s.phase = "rally"
      s.ball.active = true
      s.lastHitter = 0
      s.serveStage = 2
      s.receiverBounces = 1
      s.ball.position = vec(
        0,
        ownHalf ? -0.5 : 0.5,
        TABLE.height + BALL_RADIUS + 0.01
      )
      s.ball.velocity = vec(0, 0, -3)
      stepMatch(s)
      expect(s.pointWinner).toBe(ownHalf ? 1 : 0)
    }
  })
})

describe("gameplay, inputs and determinism", () => {
  it("starts a legal human serve immediately and rejects stale/non-finite/out-of-turn input", () => {
    const s = createMatch({ mode: "friend" })
    const before = createSnapshot(s)
    expect(applyInput(s, 1, stroke("serve"))).toBe(false)
    expect(applyInput(s, 0, { ...stroke("serve"), power: Number.NaN })).toBe(
      false
    )
    expect(s).toEqual(before)
    expect(applyInput(s, 0, stroke("serve"))).toBe(true)
    expect(s.ball.active).toBe(true)
    expect(s.ball.velocity.y).toBeGreaterThan(0)
    expect(applyInput(s, 0, stroke("serve"))).toBe(false)
  })
  it("starts the serve at the real racket contact position on either end", () => {
    for (const player of [0, 1] as const) {
      const s = createMatch({ mode: "friend", firstServer: player })
      expect(s.ball.position).toEqual(s.players[player].paddle.position)
      applyInput(s, player, stroke("serve"))
      expect(s.ball.position).toEqual(s.players[player].paddle.position)
      expect(Math.sign(s.ball.velocity.y)).toBe(-s.ends[player])
      advance(s, 0.8)
      expect(s.serveStage).toBe(2)
    }
  })
  it("does not consume an input sequence when rejecting overlapping swings", () => {
    const s = createMatch({ mode: "friend" })
    applyInput(s, 0, stroke("serve"))
    applyInput(s, 1, stroke("swing"))
    const before = structuredClone(s)
    expect(applyInput(s, 1, stroke("swing", 1))).toBe(false)
    expect(s).toEqual(before)
  })
  it.each(["easy", "medium", "hard"] as const)(
    "%s AI makes real paddle contacts without teleporting the ball",
    (difficulty) => {
      const s = createMatch({ mode: "ai", difficulty, seed: 8 })
      let botHits = 0
      for (let i = 0; i < PHYSICS_HZ * 30; i++) {
        returnBall(s, 0)
        stepMatch(s)
        botHits += s.events.filter(
          (e) => e.type === "hit" && e.player === 1
        ).length
      }
      expect(botHits).toBeGreaterThan(3)
      expect(s.bestRally).toBeGreaterThan(5)
      expect(Number.isFinite(s.ball.position.z)).toBe(true)
    }
  )
  it("AI levels differ by reaction time, movement speed and aiming error", () => {
    expect(AI_LEVELS.easy.reaction).toBeGreaterThan(AI_LEVELS.medium.reaction)
    expect(AI_LEVELS.medium.reaction).toBeGreaterThan(AI_LEVELS.hard.reaction)
    expect(AI_LEVELS.easy.speed).toBeLessThan(AI_LEVELS.hard.speed)
    expect(AI_LEVELS.easy.error).toBeGreaterThan(AI_LEVELS.hard.error)
  })
  it.each([-1, 0, 1])(
    "supports long two-sided rallies with spin %s",
    (spin) => {
      const s = createMatch({ mode: "friend", seed: 42 })
      for (let i = 0; i < PHYSICS_HZ * 30; i++) {
        returnBall(s, 0, -0.45, spin)
        returnBall(s, 1, 0.45, spin)
        stepMatch(s)
      }
      expect(s.bestRally).toBeGreaterThan(12)
    }
  )
  it("resumes snapshots deterministically with the same inputs and fixed ticks", () => {
    const a = createMatch({ mode: "ai", seed: 31, difficulty: "hard" })
    applyInput(a, 0, stroke("serve"))
    advance(a, 0.35)
    const b = restoreSnapshot(createSnapshot(a))
    for (let i = 0; i < 2000; i++) {
      returnBall(a, 0, 0.3, -0.5)
      returnBall(b, 0, 0.3, -0.5)
      stepMatch(a)
      stepMatch(b)
    }
    expect(b).toEqual(a)
    b.ball.position.x += 1
    expect(b.ball.position.x).not.toBe(a.ball.position.x)
  })
  it("keeps practice going beyond a match win and starts the next drill on the human side", () => {
    const s = createMatch({ mode: "practice" })
    for (let i = 0; i < 30; i++) score(s, 0)
    expect(s.phase).toBe("serve")
    expect(s.games).toEqual([0, 0])
    expect(s.server).toBe(0)
  })
  it("applies drag and opposite vertical Magnus changes for opposite spin", () => {
    const a = createMatch().ball
    a.velocity = vec(1, 4, 2)
    a.spin = vec(60, 0, 0)
    const b = JSON.parse(JSON.stringify(a))
    b.spin.x *= -1
    accelerate(a)
    accelerate(b)
    expect(a.velocity.x).toBeLessThan(1)
    expect(a.velocity.z).toBeGreaterThan(b.velocity.z)
  })
  it("forfeits once without allowing a later point to alter the winner", () => {
    const s = createMatch()
    awardForfeit(s, 0)
    awardForfeit(s, 1)
    awardPoint(s, 0, "miss")
    expect(s.winner).toBe(1)
    expect(s.events.filter((e) => e.type === "match")).toHaveLength(1)
  })
})
