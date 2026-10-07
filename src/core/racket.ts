import {
  FIXED_DT,
  GRAVITY,
  PHYSICS_HZ,
  PADDLE_Y,
  SWING_TICKS,
  TABLE,
} from "./constants"
import { add, clamp, cross, scale, subtract, unit, vec } from "./physics"
import type {
  MatchState,
  PaddleState,
  PlayerId,
  Stroke,
  StrokeTechnique,
} from "./types"

export const STROKE_TECHNIQUES: readonly StrokeTechnique[] = [
  "push",
  "drive",
  "topspin",
  "smash",
]

export function normalizeStroke(stroke: Stroke): Stroke {
  return {
    aimX: clamp(stroke.aimX, -1, 1),
    power: clamp(stroke.power, 0, 1),
    spin: clamp(stroke.spin, -1, 1),
    technique: stroke.technique || "drive",
    sideSpin: clamp(stroke.sideSpin || 0, -1, 1),
  }
}

export function beginSwing(
  state: MatchState,
  id: PlayerId,
  input: Stroke,
  serving = false
): void {
  const player = state.players[id]
  const paddle = player.paddle
  const stroke = normalizeStroke(input)
  const side = state.ends[id]
  const power = stroke.power
  const profiles = {
    push: { forward: 0.75 + power * 1.2, tilt: 0.52, brush: 0.3 },
    drive: { forward: 0.75 + power * 1.65, tilt: 0.4, brush: 0.6 },
    topspin: { forward: 0.8 + power * 2.15, tilt: 0.3, brush: 2.2 },
    smash: { forward: 2 + power * 3.5, tilt: -0.1, brush: -0.3 },
  }
  const profile = profiles[stroke.technique!]
  paddle.stroke = stroke
  paddle.hand =
    (state.ball.position.x - player.position.x) * -side < -0.025
      ? "backhand"
      : "forehand"
  paddle.swingAt = state.tick
  paddle.activeFrom = state.tick + Math.round(0.055 * PHYSICS_HZ)
  paddle.activeUntil = state.tick + SWING_TICKS
  paddle.swingOrigin = { ...paddle.position }
  const yaw = stroke.aimX * 0.2 - player.position.x * 0.1
  // Assisted preparation opens the face for a descending ball. It changes the
  // actual racket before contact; it does not prescribe the departing ball path.
  const descending = clamp(-(state.ball.velocity.z - GRAVITY * 0.11), -3, 3)
  const tilt =
    profile.tilt +
    (stroke.technique === "smash"
      ? 0
      : descending * 0.12 - Math.max(0, state.ball.position.z - 1.05) * 0.3)
  paddle.swingNormal = unit(vec(yaw, -side, serving ? -0.25 : tilt))
  paddle.swingVelocity = vec(
    -side * (stroke.sideSpin || 0) * 2.5,
    -side * (serving ? 1.85 + power * 0.9 : profile.forward),
    serving ? -0.12 + stroke.spin * 1.2 : profile.brush + stroke.spin * 2.4
  )
}

function advanceSwing(state: MatchState, id: PlayerId, age: number): void {
  const paddle = state.players[id].paddle
  if (age < 0.055 && state.phase === "rally") {
    // The arm can prepare for a just-bounced ball during the backswing. Once
    // the forward stroke begins its path is committed, so late gestures miss.
    const time = Math.max(0.025, 0.11 - age)
    const height = clamp(
      state.ball.position.z +
        state.ball.velocity.z * time -
        (GRAVITY * time * time) / 2 -
        paddle.swingVelocity.z * 0.025,
      TABLE.height + 0.07,
      1.85
    )
    paddle.swingOrigin.z += clamp(
      height - paddle.swingOrigin.z,
      -5 * FIXED_DT,
      5 * FIXED_DT
    )
  }
  // Draw back, accelerate through the ball, follow through, then recover.
  let travel: number
  if (age < 0.055) travel = -0.035 * Math.sin(((age / 0.055) * Math.PI) / 2)
  else if (age < 0.18) travel = age - 0.09
  else travel = 0.09 * (1 - clamp((age - 0.18) / 0.16, 0, 1))
  paddle.position = add(paddle.swingOrigin, scale(paddle.swingVelocity, travel))
  const faceBlend = clamp(age / 0.05, 0, 1)
  paddle.normal = unit(
    add(
      scale(vec(0, -state.ends[id], 0), 1 - faceBlend),
      scale(paddle.swingNormal, faceBlend)
    )
  )
}

function prepareRacket(state: MatchState, id: PlayerId): void {
  const player = state.players[id]
  const paddle = player.paddle
  const serving = state.phase === "serve" && state.server === id
  const tossing = serving && state.serveMotion.stage !== "held"
  const targetX = tossing ? state.serveMotion.hand.x : player.position.x
  paddle.position.x += clamp(
    targetX - paddle.position.x,
    -5.5 * FIXED_DT,
    5.5 * FIXED_DT
  )
  const targetY = state.ends[id] * (PADDLE_Y + (tossing ? 0.11 : 0))
  paddle.position.y += clamp(
    targetY - paddle.position.y,
    -3 * FIXED_DT,
    3 * FIXED_DT
  )
  let targetZ = tossing ? 1.22 : 1.03
  if (state.ball.active && !serving) {
    const time = clamp(
      (targetY - state.ball.position.y) / state.ball.velocity.y,
      0,
      0.12
    )
    targetZ = clamp(
      state.ball.position.z +
        state.ball.velocity.z * time -
        4.905 * time * time,
      TABLE.height + 0.07,
      1.85
    )
  }
  paddle.position.z += clamp(
    targetZ - paddle.position.z,
    -5 * FIXED_DT,
    5 * FIXED_DT
  )
  paddle.normal = unit(
    add(scale(paddle.normal, 0.88), scale(vec(0, -state.ends[id], 0), 0.12))
  )
}

/** Authoritative kinematic arm path. The visual racket must use this exact pose. */
export function updateRacket(state: MatchState, id: PlayerId): void {
  const paddle = state.players[id].paddle
  const old = { ...paddle.position }
  const oldNormal = { ...paddle.normal }
  const age = (state.tick - paddle.swingAt) / PHYSICS_HZ
  if (paddle.swingAt >= 0 && age <= 0.34) advanceSwing(state, id, age)
  else prepareRacket(state, id)
  paddle.velocity = scale(subtract(paddle.position, old), 1 / FIXED_DT)
  paddle.angularVelocity = scale(cross(oldNormal, paddle.normal), 1 / FIXED_DT)
}

export function resetRacket(paddle: PaddleState, side: number): void {
  paddle.normal = vec(0, -side, 0)
  paddle.angularVelocity = vec()
  paddle.velocity = vec()
  paddle.activeFrom = -1
  paddle.activeUntil = -1
  paddle.swingAt = -1
  paddle.contactAt = -1
  paddle.swingOrigin = { ...paddle.position }
  paddle.swingVelocity = vec()
  paddle.swingNormal = { ...paddle.normal }
  paddle.hand = "forehand"
}
