import {
  AIR_DRAG,
  BALL_RADIUS,
  FIXED_DT,
  GRAVITY,
  PADDLE_HALF_HEIGHT,
  PADDLE_HALF_WIDTH,
  TABLE,
} from "./constants"
import type { BallState, PlayerId, PlayerState, Vec3 } from "./types"

export const vec = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })
export const clamp = (n: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, n))
export interface Contact {
  kind: "table" | "net" | "paddle" | "floor"
  fraction: number
  position: Vec3
  player?: PlayerId
}

/** Swept sphere against table/net planes and the moving paddle's finite face. */
export function firstContact(
  ball: BallState,
  dt: number,
  players: readonly PlayerState[],
  tick: number
): Contact | undefined {
  const p = ball.position
  const v = ball.velocity
  let contact: Contact | undefined
  const consider = (
    kind: Contact["kind"],
    fraction: number,
    check: (at: Vec3) => boolean,
    player?: PlayerId
  ) => {
    if (fraction < -1e-8 || fraction > 1 || !Number.isFinite(fraction)) return
    const f = Math.max(0, fraction)
    const position = vec(
      p.x + v.x * dt * f,
      p.y + v.y * dt * f,
      p.z + v.z * dt * f
    )
    if (check(position) && (!contact || f < contact.fraction))
      contact = { kind, fraction: f, position, player }
  }
  if (v.z < 0) {
    consider(
      "table",
      (TABLE.height + BALL_RADIUS - p.z) / (v.z * dt),
      (at) =>
        Math.abs(at.x) <= TABLE.width / 2 + BALL_RADIUS * 0.6 &&
        Math.abs(at.y) <= TABLE.length / 2 + BALL_RADIUS * 0.6
    )
    consider("floor", (BALL_RADIUS - p.z) / (v.z * dt), () => true)
  }
  if (Math.abs(v.y) > 1e-7) {
    const netFace = -Math.sign(v.y) * (TABLE.netHalfThickness + BALL_RADIUS)
    consider(
      "net",
      (netFace - p.y) / (v.y * dt),
      (at) =>
        Math.abs(at.x) <= TABLE.width / 2 + 0.12 &&
        at.z >= TABLE.height - BALL_RADIUS &&
        at.z <= TABLE.height + TABLE.netHeight + BALL_RADIUS
    )
    players.forEach((player, id) => {
      const paddle = player.paddle
      const side = Math.sign(paddle.position.y)
      if (Math.sign(v.y) !== side || tick > paddle.activeUntil) return
      const face = paddle.position.y - side * BALL_RADIUS
      const fraction = (face - p.y) / (v.y * dt)
      consider(
        "paddle",
        fraction,
        (at) => {
          // updatePlayers has advanced the paddle to the end of this tick.
          // Rewind to time of contact so a fast lateral sweep cannot tunnel.
          const x = paddle.position.x - paddle.velocity.x * dt * (1 - fraction)
          const z = paddle.position.z - paddle.velocity.z * dt * (1 - fraction)
          const dx = (at.x - x) / (PADDLE_HALF_WIDTH + BALL_RADIUS)
          const dz = (at.z - z) / (PADDLE_HALF_HEIGHT + BALL_RADIUS)
          return dx * dx + dz * dz <= 1
        },
        id as PlayerId
      )
    })
  }
  return contact
}

export function accelerate(ball: BallState, dt = FIXED_DT): void {
  const v = ball.velocity
  const s = ball.spin
  // Restricted Magnus effect makes topspin/backspin visible without unstable energy growth.
  const mx = clamp((s.y * v.z - s.z * v.y) * 0.0018, -2.5, 2.5)
  const my = clamp((s.z * v.x - s.x * v.z) * 0.0018, -2.5, 2.5)
  const mz = clamp((s.x * v.y - s.y * v.x) * 0.0018, -2.5, 2.5)
  v.x += (mx - AIR_DRAG * v.x) * dt
  v.y += (my - AIR_DRAG * v.y) * dt
  v.z += (-GRAVITY + mz - AIR_DRAG * v.z) * dt
  const decay = Math.exp(-0.25 * dt)
  s.x *= decay
  s.y *= decay
  s.z *= decay
}

export function moveBall(ball: BallState, dt: number): void {
  ball.position.x += ball.velocity.x * dt
  ball.position.y += ball.velocity.y * dt
  ball.position.z += ball.velocity.z * dt
}

export function bounceTable(ball: BallState): void {
  ball.position.z = TABLE.height + BALL_RADIUS + 1e-5
  ball.velocity.z = Math.abs(ball.velocity.z) * 0.88
  ball.velocity.x = ball.velocity.x * 0.98 + ball.spin.y * BALL_RADIUS * 0.025
  ball.velocity.y = ball.velocity.y * 0.98 - ball.spin.x * BALL_RADIUS * 0.025
  ball.spin.x *= 0.78
  ball.spin.y *= 0.78
}

export function bounceNet(ball: BallState): void {
  if (ball.position.z > TABLE.height + TABLE.netHeight - BALL_RADIUS * 0.3) {
    // A top-cord graze may continue into a legal service let.
    ball.position.y =
      Math.sign(ball.velocity.y) * (TABLE.netHalfThickness + BALL_RADIUS + 1e-5)
    ball.velocity.y *= 0.72
    ball.velocity.z = Math.max(0.7, ball.velocity.z * 0.5)
  } else {
    ball.velocity.y *= -0.22
    ball.velocity.x *= 0.72
    ball.velocity.z *= 0.65
    ball.position.y += Math.sign(ball.velocity.y) * 1e-5
  }
}
