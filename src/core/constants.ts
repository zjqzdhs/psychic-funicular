export const PHYSICS_HZ = 120
export const FIXED_DT = 1 / PHYSICS_HZ
export const TABLE = {
  width: 1.525,
  length: 2.74,
  height: 0.76,
  netHeight: 0.1525,
  netHalfThickness: 0.006,
} as const
export const BALL_RADIUS = 0.02
export const GRAVITY = 9.81
export const AIR_DRAG = 0.16
export const PADDLE_Y = TABLE.length / 2 + 0.2
export const PADDLE_HALF_WIDTH = 0.077
export const PADDLE_HALF_HEIGHT = 0.086
export const SWING_TICKS = Math.round(PHYSICS_HZ * 0.24)
export const POINT_PAUSE_TICKS = Math.round(PHYSICS_HZ * 1.1)
