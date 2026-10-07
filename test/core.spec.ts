import { describe, expect, it } from "vitest"
import {
  AI_LEVELS,
  BALL_RADIUS,
  FIXED_DT,
  PADDLE_Y,
  PHYSICS_HZ,
  TABLE,
  accelerate,
  bouncePaddle,
  beginSwing,
  applyInput,
  awardForfeit,
  awardPoint,
  createMatch,
  createSnapshot,
  firstContact,
  unit,
  restoreSnapshot,
  serverForScore,
  stepMatch,
  vec,
} from "../src/core/index"
import type {
  MatchState,
  PaddleState,
  PlayerId,
  PlayerInput,
  StrokeTechnique,
} from "../src/core/index"

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
      time < 0.14 &&
      Math.sign(state.ball.velocity.y) === state.ends[player]
    ) {
      applyInput(state, player, {
        ...stroke("swing", p.lastInputSeq + 1),
        power: 0.4,
        aimX,
        spin,
      })
    }
  }
}

function incomingReturn(
  technique: StrokeTechnique,
  height: number,
  arrival: number
) {
  const state = createMatch({ mode: "friend" })
  state.phase = "rally"
  state.serveStage = 2
  state.receiverBounces = 1
  state.lastHitter = 1
  state.ball.active = true
  state.ball.position = vec(0, -PADDLE_Y + 4 * arrival, height)
  state.ball.velocity = vec(0, -4, 0)
  state.players[0].paddle.position.z = height
  applyInput(state, 0, { ...stroke("swing"), technique })
  const events: string[] = []
  for (let i = 0; i < PHYSICS_HZ && state.phase === "rally"; i++) {
    stepMatch(state)
    events.push(...state.events.map((event) => event.reason || event.type))
  }
  return { state, events }
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
  it("uses an angled moving face for the sweep and collision response", () => {
    const s = createMatch()
    const paddle = s.players[0].paddle
    paddle.normal = unit(vec(0.35, 1, 0.25))
    paddle.velocity = vec(0, 2, 0)
    paddle.activeUntil = 10
    s.ball.position = vec(0, -PADDLE_Y + 0.3, 1.05)
    s.ball.velocity = vec(0, -80, 0)
    const hit = firstContact(s.ball, FIXED_DT, [s.players[0]], 1)!
    expect(hit.kind).toBe("paddle")
    expect(hit.normal!.x).toBeGreaterThan(0.3)
    bouncePaddle(s.ball, paddle, hit)
    expect(s.ball.velocity.y).toBeGreaterThan(0)
    expect(s.ball.velocity.x).toBeGreaterThan(0)
    expect(s.ball.velocity.z).toBeGreaterThan(0)
  })
  it("does not turn a weak or downward physical impact into a guaranteed legal landing", () => {
    const s = createMatch()
    const p = s.players[0].paddle
    p.normal = unit(vec(0, 1, -0.6))
    p.stroke.technique = "push"
    s.ball.velocity = vec(0, -1, 0)
    const before = { ...s.ball.position }
    bouncePaddle(s.ball, p, {
      kind: "paddle",
      fraction: 0,
      position: before,
      normal: p.normal,
      surfaceVelocity: vec(),
    })
    expect(s.ball.velocity.y).toBeLessThan(1)
    expect(s.ball.velocity.z).toBeLessThan(0)
    expect(Math.abs(s.ball.position.y - before.y)).toBeLessThan(0.001)
  })
  it("keeps side brushing independent of aim and transfers it to opposite ball spin", () => {
    const results = [-1, 1].map((sideSpin) => {
      const s = createMatch()
      s.ball.position.z = 1.3
      s.ball.velocity = vec(0, -4, -0.5)
      beginSwing(s, 0, { ...stroke("swing"), sideSpin, technique: "drive" })
      const p = s.players[0].paddle
      p.normal = { ...p.swingNormal }
      bouncePaddle(s.ball, p, {
        kind: "paddle",
        fraction: 0,
        position: s.ball.position,
        normal: p.normal,
        surfaceVelocity: p.swingVelocity,
      })
      return { spin: s.ball.spin.z, normal: p.normal }
    })
    expect(results[0].normal).toEqual(results[1].normal)
    expect(results[0].spin * results[1].spin).toBeLessThan(0)
  })
  it("expresses distinct strokes without silently replacing a chosen low smash", () => {
    const speeds = ["push", "drive", "topspin", "smash"].map((technique) => {
      const s = createMatch()
      s.ball.position.z = 1.5
      beginSwing(s, 0, {
        ...stroke("swing"),
        technique: technique as StrokeTechnique,
      })
      return s.players[0].paddle
    })
    expect(Math.abs(speeds[0].swingVelocity.y)).toBeLessThan(
      Math.abs(speeds[1].swingVelocity.y)
    )
    expect(speeds[2].swingVelocity.z).toBeGreaterThan(speeds[1].swingVelocity.z)
    expect(speeds[3].swingNormal.z).toBeLessThan(0)
    const low = createMatch()
    low.ball.position.z = TABLE.height + 0.1
    beginSwing(low, 0, { ...stroke("swing"), technique: "smash" })
    expect(low.players[0].paddle.stroke.technique).toBe("smash")
    expect(low.players[0].paddle.swingNormal.z).toBeLessThan(0)
  })
  it("requires a timed forward stroke: early and late swings miss the same incoming line", () => {
    expect(incomingReturn("drive", 1.2, 0.1).events).toContain("hit")
    expect(incomingReturn("drive", 1.2, 0.01).events).not.toContain("hit")
    expect(incomingReturn("drive", 1.2, 0.3).events).not.toContain("hit")
  })
  it("lets the same smash clear from a high ball but fail on the striker's half from a low ball", () => {
    const low = incomingReturn("smash", 0.9, 0.1)
    const high = incomingReturn("smash", 1.6, 0.1)
    expect(low.events).toContain("hit")
    expect(high.events).toContain("hit")
    expect(low.events).toContain("wrong-side")
    expect(low.state.scores).toEqual([0, 1])
    expect(high.events).not.toContain("wrong-side")
    expect(high.state.scores).toEqual([1, 0])
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
    for (let i = 0; i < 250; i++) {
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
    advance(s, 0.5)
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
    advance(s, 0.5)
    s.serveStage = 1
    s.ball.position = vec(0, -0.04, TABLE.height + 0.045)
    s.ball.velocity = vec(0, 4, -0.1)
    advance(s, 2)
    expect(s.scores).toEqual([0, 1])
  })
  it("rejects volleys, wrong-side bounces and double bounces", () => {
    const volley = createMatch({ mode: "friend" })
    applyInput(volley, 0, stroke("serve"))
    advance(volley, 0.5)
    volley.ball.position = vec(0, PADDLE_Y - 0.05, 1.05)
    volley.ball.velocity = vec(0, 8, 0)
    volley.players[1].position.x = 0
    volley.players[1].paddle.position = vec(0, PADDLE_Y, 1.05)
    volley.players[1].paddle.activeFrom = volley.tick
    volley.players[1].paddle.activeUntil = volley.tick + 10
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
  it("starts the toss immediately and rejects stale/non-finite/out-of-turn input", () => {
    const s = createMatch({ mode: "friend" })
    const before = createSnapshot(s)
    expect(applyInput(s, 1, stroke("serve"))).toBe(false)
    expect(applyInput(s, 0, { ...stroke("serve"), power: Number.NaN })).toBe(
      false
    )
    expect(s).toEqual(before)
    expect(applyInput(s, 0, stroke("serve"))).toBe(true)
    expect(s.ball.active).toBe(true)
    expect(s.ball.velocity.z).toBeGreaterThan(0)
    expect(s.ball.velocity.y).toBe(0)
    expect(s.serveMotion.stage).toBe("toss")
    expect(applyInput(s, 0, stroke("serve"))).toBe(false)
  })
  it("holds the ball off the racket, tosses at least 16 cm without spin, then contacts on descent", () => {
    for (const player of [0, 1] as const) {
      const s = createMatch({ mode: "friend", firstServer: player })
      expect(
        Math.abs(s.ball.position.x - s.players[player].paddle.position.x)
      ).toBeGreaterThan(0.2)
      expect(s.ball.position.z - s.serveMotion.hand.z).toBeCloseTo(BALL_RADIUS)
      applyInput(s, player, stroke("serve"))
      const release = { ...s.ball.position }
      let descending = false
      for (let tick = 0; tick < 100 && s.phase === "serve"; tick++) {
        descending = s.ball.velocity.z < 0
        expect(s.ball.spin).toEqual(vec())
        expect(s.ball.position.x).toBe(release.x)
        expect(s.ball.position.y).toBe(release.y)
        stepMatch(s)
      }
      expect(descending).toBe(true)
      expect(s.serveMotion.peakHeight - release.z).toBeGreaterThanOrEqual(0.16)
      expect(s.serveMotion.contactAt).toBeGreaterThan(s.serveMotion.tossAt)
      expect(s.serveMotion.stage).toBe("complete")
      expect(s.phase).toBe("rally")
      expect(Math.sign(s.ball.velocity.y)).toBe(-s.ends[player])
      advance(s, 0.8)
      expect(s.serveStage).toBe(2)
    }
  })
  it("does not consume an input sequence when rejecting overlapping swings", () => {
    const s = createMatch({ mode: "friend" })
    applyInput(s, 0, stroke("serve"))
    advance(s, 0.5)
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
      expect(botHits).toBeGreaterThan(2)
      expect(s.bestRally).toBeGreaterThan(2)
      expect(Number.isFinite(s.ball.position.z)).toBe(true)
    }
  )
  it("AI levels differ by reaction time, movement speed and aiming error", () => {
    expect(AI_LEVELS.easy.reaction).toBeGreaterThan(AI_LEVELS.medium.reaction)
    expect(AI_LEVELS.medium.reaction).toBeGreaterThan(AI_LEVELS.hard.reaction)
    expect(AI_LEVELS.easy.speed).toBeLessThan(AI_LEVELS.hard.speed)
    expect(AI_LEVELS.easy.error).toBeGreaterThan(AI_LEVELS.hard.error)
  })
  it("supports a controllable neutral two-sided rally without forcing a landing target", () => {
    const s = createMatch({ mode: "friend", seed: 42 })
    for (let i = 0; i < PHYSICS_HZ * 30; i++) {
      returnBall(s, 0)
      returnBall(s, 1)
      stepMatch(s)
    }
    expect(s.bestRally).toBeGreaterThan(12)
  })
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
  it("resumes an in-flight toss and restores older checkpoint fields without losing scores", () => {
    const a = createMatch({ mode: "friend" })
    applyInput(a, 0, { ...stroke("serve"), technique: "push", sideSpin: 0.3 })
    advance(a, 0.15)
    const b = restoreSnapshot(createSnapshot(a))
    advance(a, 0.7)
    advance(b, 0.7)
    expect(b).toEqual(a)
    const legacy = createSnapshot(a)
    delete (legacy as Partial<MatchState>).serveMotion
    delete (legacy.players[0].paddle as Partial<PaddleState>).normal
    legacy.scores = [8, 9]
    const upgraded = restoreSnapshot(legacy)
    expect(upgraded.scores).toEqual([8, 9])
    expect(upgraded.ball).toEqual(legacy.ball)
    expect(upgraded.serveMotion.stage).toBe("complete")
    expect(upgraded.players[0].paddle.normal.y).toBe(1)
  })
  it("lets the ball separate after a point instead of freezing on a racket", () => {
    const s = createMatch({ mode: "friend" })
    s.phase = "rally"
    s.ball.active = true
    s.ball.position = vec(0, -PADDLE_Y, 1.1)
    s.ball.velocity = vec(0, 3, 1)
    awardPoint(s, 1, "volley")
    const before = { ...s.ball.position }
    advance(s, 0.1)
    expect(s.phase).toBe("point")
    expect(restoreSnapshot(createSnapshot(s)).pointReason).toBe("volley")
    expect(s.ball.position.y).toBeGreaterThan(before.y + 0.2)
    expect(s.scores).toEqual([0, 1])
    advance(s, 1.1)
    expect(s.phase).toBe("serve")
    expect(s.pointReason).toBeUndefined()
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
