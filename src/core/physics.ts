import {
  AIR_DRAG,
  BALL_RADIUS,
  FIXED_DT,
  GRAVITY,
  PADDLE_HALF_HEIGHT,
  PADDLE_HALF_WIDTH,
  TABLE,
} from "./constants"
import type {
  BallState,
  PaddleState,
  PlayerId,
  PlayerState,
  Vec3,
} from "./types"

export const vec = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })
export const clamp = (n: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, n))
export const dot = (a: Vec3, b: Vec3): number =>
  a.x * b.x + a.y * b.y + a.z * b.z
export const cross = (a: Vec3, b: Vec3): Vec3 =>
  vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
export const add = (a: Vec3, b: Vec3): Vec3 =>
  vec(a.x + b.x, a.y + b.y, a.z + b.z)
export const scale = (a: Vec3, amount: number): Vec3 =>
  vec(a.x * amount, a.y * amount, a.z * amount)
export const subtract = (a: Vec3, b: Vec3): Vec3 => add(a, scale(b, -1))
export const unit = (a: Vec3): Vec3 =>
  scale(a, 1 / (Math.hypot(a.x, a.y, a.z) || 1))
export interface Contact {
  kind: "table" | "net" | "paddle" | "floor"
  fraction: number
  position: Vec3
  player?: PlayerId
  normal?: Vec3
  surfaceVelocity?: Vec3
}

function faceContact(
  ball: BallState,
  paddle: PaddleState,
  player: PlayerId,
  fraction: number,
  at: { centre: Vec3; normal: Vec3; position: Vec3 }
): Contact | undefined {
  const right = unit(cross(at.normal, vec(0, 0, 1)))
  const up = unit(cross(right, at.normal))
  const offset = subtract(
    at.position,
    add(at.centre, scale(at.normal, BALL_RADIUS))
  )
  const x = dot(offset, right) / (PADDLE_HALF_WIDTH + BALL_RADIUS)
  const z = dot(offset, up) / (PADDLE_HALF_HEIGHT + BALL_RADIUS)
  if (x * x + z * z > 1) return undefined
  const surfaceVelocity = add(
    paddle.velocity,
    cross(paddle.angularVelocity, offset)
  )
  if (dot(subtract(ball.velocity, surfaceVelocity), at.normal) >= 0)
    return undefined
  return {
    kind: "paddle",
    fraction,
    position: at.position,
    player,
    normal: at.normal,
    surfaceVelocity,
  }
}

function sweptPaddle(
  ball: BallState,
  dt: number,
  paddle: PaddleState,
  player: PlayerId
): Contact | undefined {
  const pose = (fraction: number) => {
    const rewind = dt * (1 - fraction)
    const centre = subtract(paddle.position, scale(paddle.velocity, rewind))
    const normal = unit(
      subtract(
        paddle.normal,
        scale(cross(paddle.angularVelocity, paddle.normal), rewind)
      )
    )
    const position = add(ball.position, scale(ball.velocity, dt * fraction))
    return {
      centre,
      normal,
      position,
      distance: dot(subtract(position, centre), normal) - BALL_RADIUS,
    }
  }
  // Rotating faces need a bounded sweep as well as translating planes. Bisection
  // finds the first front-face crossing instead of checking an end-frame overlap.
  let previous = pose(0)
  for (let sample = 1; sample <= 8; sample++) {
    const current = pose(sample / 8)
    if (previous.distance >= -1e-7 && current.distance <= 0) {
      let low = (sample - 1) / 8
      let high = sample / 8
      for (let i = 0; i < 14; i++) {
        const middle = (low + high) / 2
        if (pose(middle).distance > 0) low = middle
        else high = middle
      }
      const fraction = (low + high) / 2
      const hit = faceContact(ball, paddle, player, fraction, pose(fraction))
      if (hit) return hit
    }
    previous = current
  }
  return undefined
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
  }
  players.forEach((player, id) => {
    const paddle = player.paddle
    if (tick < paddle.activeFrom || tick > paddle.activeUntil) return
    const hit = sweptPaddle(ball, dt, paddle, id as PlayerId)
    if (hit && (!contact || hit.fraction < contact.fraction)) contact = hit
  })
  return contact
}

/** Infinite-mass moving racket; normal restitution and bounded rubber friction.
 * This never receives a desired landing point or replaces a miss with a trajectory.
 */
export function bouncePaddle(
  ball: BallState,
  paddle: PaddleState,
  contact: Contact
): void {
  const normal = contact.normal || paddle.normal
  const surface = contact.surfaceVelocity || paddle.velocity
  const relative = subtract(ball.velocity, surface)
  const normalSpeed = dot(relative, normal)
  if (normalSpeed >= 0) return
  const restitution = paddle.stroke.technique === "push" ? 0.38 : 0.68
  const normalImpulse = -(1 + restitution) * normalSpeed
  const slip = subtract(relative, scale(cross(ball.spin, normal), BALL_RADIUS))
  const tangent = subtract(slip, scale(normal, dot(slip, normal)))
  const speed = Math.hypot(tangent.x, tangent.y, tangent.z)
  const friction = scale(
    tangent,
    -Math.min(1 / 3.5, (0.62 * normalImpulse) / Math.max(speed, 1e-8))
  )
  ball.velocity = add(
    ball.velocity,
    add(scale(normal, normalImpulse), friction)
  )
  ball.spin = subtract(
    ball.spin,
    scale(cross(normal, friction), 2.5 / BALL_RADIUS)
  )
  // Resolve only numerical penetration, not a render-driven relocation.
  ball.position = add(ball.position, scale(normal, 1e-5))
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
