/** All distances are metres. X is across the table, Y along it, Z points up. */
export interface Vec3 {
  x: number
  y: number
  z: number
}
export type PlayerId = 0 | 1
export type Difficulty = "easy" | "medium" | "hard"
export type MatchMode = "ai" | "practice" | "friend"
export type MatchPhase = "serve" | "rally" | "point" | "finished"
export interface MatchOptions {
  seed?: number
  mode?: MatchMode
  difficulty?: Difficulty
  firstServer?: PlayerId
}
export interface Stroke {
  /** Desired landing position across the table, -1 left to +1 right. */
  aimX: number
  power: number
  /** -1 backspin, +1 topspin. */
  spin: number
}
export interface PlayerInput extends Stroke {
  kind: "serve" | "swing"
  seq: number
}
export interface PaddleState {
  position: Vec3
  velocity: Vec3
  activeUntil: number
  swingAt: number
  contactAt: number
  stroke: Stroke
}
export interface PlayerState {
  position: Vec3
  paddle: PaddleState
  lastInputSeq: number
  targetX: number
  reactionAt: number
}
export interface BallState {
  position: Vec3
  velocity: Vec3
  spin: Vec3
  active: boolean
}
export type PointReason =
  | "miss"
  | "out"
  | "double-bounce"
  | "wrong-side"
  | "volley"
  | "serve-fault"
  | "forfeit"
export interface MatchEvent {
  type: "serve" | "hit" | "bounce" | "net" | "let" | "point" | "game" | "match"
  tick: number
  player?: PlayerId
  reason?: PointReason
}
/** Plain serializable state. No rendering or platform dependencies. */
export interface MatchState {
  version: 1
  tick: number
  rng: number
  options: { mode: MatchMode; difficulty: Difficulty; firstServer: PlayerId }
  phase: MatchPhase
  ball: BallState
  players: [PlayerState, PlayerState]
  scores: [number, number]
  games: [number, number]
  server: PlayerId
  gameFirstServer: PlayerId
  gameIndex: number
  /** Logical player identity stays fixed; ends change after each game / deciding game at 5. */
  ends: [1 | -1, 1 | -1]
  decidingEndsChanged: boolean
  lastHitter: PlayerId
  receiverBounces: number
  serveStage: 0 | 1 | 2
  serveNetTouched: boolean
  rallyHits: number
  bestRally: number
  pointWinner?: PlayerId
  winner?: PlayerId
  nextPointAt: number
  /** Events from the latest step. Drain/copy after every step when recording a match. */
  events: MatchEvent[]
}
