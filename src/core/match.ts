import {
  BALL_RADIUS,
  FIXED_DT,
  PADDLE_Y,
  PHYSICS_HZ,
  POINT_PAUSE_TICKS,
  SERVE_TOSS_SPEED,
  TABLE,
} from "./constants"
import {
  accelerate,
  bounceNet,
  bouncePaddle,
  bounceTable,
  clamp,
  firstContact,
  moveBall,
  vec,
} from "./physics"
import type { Contact } from "./physics"
import {
  beginSwing,
  normalizeStroke,
  resetRacket,
  STROKE_TECHNIQUES,
  updateRacket,
} from "./racket"
import type {
  Difficulty,
  MatchEvent,
  MatchOptions,
  MatchState,
  PlayerId,
  PlayerInput,
  PlayerState,
  PointReason,
  Stroke,
} from "./types"

export const otherPlayer = (player: PlayerId): PlayerId =>
  player === 0 ? 1 : 0
const defaultStroke = (): Stroke => ({
  aimX: 0,
  power: 0.5,
  spin: 0,
  technique: "drive",
  sideSpin: 0,
})
function playerState(side: number): PlayerState {
  return {
    position: vec(0, side * (PADDLE_Y + 0.36), 0),
    paddle: {
      position: vec(0, side * PADDLE_Y, 1.05),
      velocity: vec(),
      normal: vec(0, -side, 0),
      angularVelocity: vec(),
      activeFrom: -1,
      activeUntil: -1,
      swingAt: -1,
      contactAt: -1,
      stroke: defaultStroke(),
      swingOrigin: vec(0, side * PADDLE_Y, 1.05),
      swingVelocity: vec(),
      swingNormal: vec(0, -side, 0),
      hand: "forehand",
    },
    lastInputSeq: -1,
    targetX: 0,
    reactionAt: 0,
  }
}
export const AI_LEVELS: Record<
  Difficulty,
  { reaction: number; speed: number; error: number; power: number }
> = {
  easy: { reaction: 0.3, speed: 2.2, error: 0.16, power: 0.28 },
  medium: { reaction: 0.17, speed: 3.2, error: 0.085, power: 0.5 },
  hard: { reaction: 0.075, speed: 4.4, error: 0.025, power: 0.74 },
}
export function createMatch(options: MatchOptions = {}): MatchState {
  const firstServer = options.firstServer ?? 0
  const state: MatchState = {
    version: 1,
    tick: 0,
    rng: (options.seed ?? 0x50494e47) >>> 0,
    options: {
      mode: options.mode ?? "ai",
      difficulty: options.difficulty ?? "medium",
      firstServer,
    },
    phase: "serve",
    ball: { position: vec(), velocity: vec(), spin: vec(), active: false },
    players: [playerState(-1), playerState(1)],
    scores: [0, 0],
    games: [0, 0],
    server: firstServer,
    gameFirstServer: firstServer,
    gameIndex: 0,
    ends: [-1, 1],
    decidingEndsChanged: false,
    lastHitter: firstServer,
    receiverBounces: 0,
    serveStage: 0,
    serveNetTouched: false,
    serveMotion: {
      stage: "held",
      hand: vec(),
      tossAt: -1,
      contactAt: -1,
      releaseHeight: 1.09,
      peakHeight: 1.09,
    },
    rallyHits: 0,
    bestRally: 0,
    nextPointAt: 0,
    events: [],
  }
  resetBallForServe(state)
  return state
}

function random(state: MatchState): number {
  state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0
  return state.rng / 0x100000000
}
function event(
  state: MatchState,
  type: MatchEvent["type"],
  player?: PlayerId,
  reason?: PointReason
): void {
  state.events.push({ type, tick: state.tick, player, reason })
}
function resetBallForServe(state: MatchState): void {
  const side = state.ends[state.server]
  const server = state.players[state.server]
  const x = clamp(server.position.x, -0.5, 0.5)
  server.position.x = x
  server.paddle.position = vec(x, side * PADDLE_Y, 1.05)
  state.serveMotion = {
    stage: "held",
    hand: vec(x + side * 0.24, side * (PADDLE_Y - 0.015), 1.07),
    tossAt: -1,
    contactAt: -1,
    releaseHeight: 1.09,
    peakHeight: 1.09,
  }
  state.ball = {
    position: { ...state.serveMotion.hand, z: state.serveMotion.releaseHeight },
    velocity: vec(),
    spin: vec(),
    active: false,
  }
  state.serveStage = 0
  state.serveNetTouched = false
  state.receiverBounces = 0
  state.lastHitter = state.server
  state.rallyHits = 0
  state.players.forEach((player, id) =>
    resetRacket(player.paddle, state.ends[id])
  )
}
export function serverForScore(
  firstServer: PlayerId,
  scores: readonly [number, number]
): PlayerId {
  const total = scores[0] + scores[1]
  const swaps =
    scores[0] >= 10 && scores[1] >= 10 ? total - 20 : Math.floor(total / 2)
  return swaps % 2 ? otherPlayer(firstServer) : firstServer
}

function switchEnds(state: MatchState): void {
  state.ends = [state.ends[1], state.ends[0]]
  state.players.forEach((player, index) => {
    const side = state.ends[index]
    player.position.y = side * (PADDLE_Y + 0.36)
    player.paddle.position.y = side * PADDLE_Y
  })
}

export function awardPoint(
  state: MatchState,
  winner: PlayerId,
  reason: PointReason
): void {
  if (
    state.phase !== "rally" &&
    !(state.phase === "serve" && state.ball.active)
  )
    return
  state.pointWinner = winner
  state.pointReason = reason
  // Keep the loose ball moving during the score pause, especially after a volley
  // at the racket face. Point state stops scoring, not physical separation.
  state.scores[winner] += 1
  state.bestRally = Math.max(state.bestRally, state.rallyHits)
  event(state, "point", winner, reason)
  state.phase = "point"
  state.nextPointAt = state.tick + POINT_PAUSE_TICKS
  if (state.options.mode === "practice") {
    state.server = 0
    return
  }
  if (
    state.scores[winner] >= 11 &&
    state.scores[winner] - state.scores[otherPlayer(winner)] >= 2
  ) {
    state.games[winner] += 1
    event(state, "game", winner)
    if (state.games[winner] >= 2) {
      state.phase = "finished"
      state.winner = winner
      event(state, "match", winner)
      return
    }
    // Keep the final game score visible during the inter-point pause; reset in nextServe.
  } else {
    state.server = serverForScore(state.gameFirstServer, state.scores)
    if (
      state.gameIndex === 2 &&
      !state.decidingEndsChanged &&
      state.scores[winner] === 5
    ) {
      switchEnds(state)
      state.decidingEndsChanged = true
    }
  }
}
function nextServe(state: MatchState): void {
  const winner = state.pointWinner
  if (
    state.options.mode !== "practice" &&
    winner !== undefined &&
    state.scores[winner] >= 11 &&
    state.scores[winner] - state.scores[otherPlayer(winner)] >= 2
  ) {
    state.scores = [0, 0]
    state.gameIndex += 1
    state.gameFirstServer = otherPlayer(state.gameFirstServer)
    state.server = state.gameFirstServer
    switchEnds(state)
  }
  state.pointWinner = undefined
  state.pointReason = undefined
  state.phase = "serve"
  state.nextPointAt = state.tick + PHYSICS_HZ * 0.7
  resetBallForServe(state)
}

function prepareReceiver(state: MatchState, receiver: PlayerId): void {
  const player = state.players[receiver]
  const bot = receiver === 1 && state.options.mode !== "friend"
  const profile = AI_LEVELS[state.options.difficulty]
  player.reactionAt =
    state.tick + (bot ? Math.round(profile.reaction * PHYSICS_HZ) : 0)
  // One deterministic error per stroke; no frame-rate dependent random sampling.
  const predicted = predictedX(state, receiver)
  player.targetX = clamp(
    predicted + (bot ? (random(state) - 0.5) * profile.error * 2 : 0),
    -TABLE.width / 2 - 0.16,
    TABLE.width / 2 + 0.16
  )
}
function predictedX(state: MatchState, player: PlayerId): number {
  const ball = state.ball
  const time =
    (state.players[player].paddle.position.y - ball.position.y) /
    ball.velocity.y
  return ball.position.x + ball.velocity.x * clamp(time, 0, 2)
}
function serve(state: MatchState, player: PlayerId, stroke: Stroke): void {
  resetBallForServe(state)
  const p = state.players[player]
  state.ball.velocity = vec(0, 0, SERVE_TOSS_SPEED)
  state.ball.spin = vec()
  state.ball.active = true
  state.serveMotion.stage = "toss"
  state.serveMotion.tossAt = state.tick
  p.paddle.stroke = normalizeStroke(stroke)
  event(state, "toss", player)
}
/** Invalid, stale, non-finite and out-of-turn commands never mutate state. */
export function applyInput(
  state: MatchState,
  player: PlayerId,
  input: PlayerInput
): boolean {
  if (
    (player !== 0 && player !== 1) ||
    !input ||
    (input.kind !== "serve" && input.kind !== "swing")
  )
    return false
  const p = state.players[player]
  if (
    !Number.isSafeInteger(input.seq) ||
    input.seq < 0 ||
    input.seq <= p.lastInputSeq ||
    ![
      input.aimX,
      input.power,
      input.spin,
      input.sideSpin === undefined ? 0 : input.sideSpin,
    ].every(Number.isFinite) ||
    (input.technique !== undefined &&
      !STROKE_TECHNIQUES.includes(input.technique))
  )
    return false
  if (
    input.kind === "serve"
      ? state.phase !== "serve" ||
        state.server !== player ||
        state.serveMotion.stage !== "held"
      : state.phase !== "rally" || state.lastHitter === player
  )
    return false
  if (input.kind === "swing" && state.tick <= p.paddle.activeUntil) return false
  const stroke = normalizeStroke(input)
  p.lastInputSeq = input.seq
  if (input.kind === "serve") serve(state, player, stroke)
  else {
    // A new gesture may not sustain one endless collision window.
    beginSwing(state, player, stroke)
  }
  return true
}

function hitPaddle(
  state: MatchState,
  player: PlayerId,
  contact: Contact
): void {
  const paddle = state.players[player].paddle
  if (state.phase === "serve") {
    if (
      player !== state.server ||
      state.ball.velocity.z >= 0 ||
      state.serveMotion.peakHeight - state.serveMotion.releaseHeight < 0.16
    )
      return
    bouncePaddle(state.ball, paddle, contact)
    state.serveMotion.stage = "complete"
    state.serveMotion.contactAt = state.tick
    state.phase = "rally"
    state.rallyHits = 1
    paddle.activeUntil = -1
    paddle.contactAt = state.tick
    prepareReceiver(state, otherPlayer(player))
    event(state, "serve", player)
    return
  }
  if (
    state.lastHitter === player ||
    state.receiverBounces < 1 ||
    state.serveStage !== 2
  ) {
    bouncePaddle(state.ball, paddle, contact)
    paddle.activeUntil = -1
    paddle.contactAt = state.tick
    awardPoint(state, otherPlayer(player), "volley")
    return
  }
  bouncePaddle(state.ball, paddle, contact)
  state.lastHitter = player
  state.receiverBounces = 0
  state.rallyHits += 1
  state.bestRally = Math.max(state.bestRally, state.rallyHits)
  paddle.activeUntil = -1
  paddle.contactAt = state.tick
  prepareReceiver(state, otherPlayer(player))
  event(state, "hit", player)
}
function tableContact(state: MatchState): void {
  const half = Math.sign(state.ball.position.y)
  const ownHalf = half === state.ends[state.lastHitter]
  event(
    state,
    "bounce",
    ownHalf ? state.lastHitter : otherPlayer(state.lastHitter)
  )
  if (state.serveStage === 0) {
    if (!ownHalf)
      return awardPoint(state, otherPlayer(state.lastHitter), "serve-fault")
    state.serveStage = 1
  } else if (ownHalf) {
    awardPoint(
      state,
      otherPlayer(state.lastHitter),
      state.serveStage === 1 ? "serve-fault" : "wrong-side"
    )
  } else if (state.serveStage === 1) {
    if (state.serveNetTouched) {
      state.ball.active = false
      state.phase = "point"
      state.pointWinner = undefined
      state.nextPointAt = state.tick + POINT_PAUSE_TICKS
      event(state, "let", state.server)
    } else {
      state.serveStage = 2
      state.receiverBounces = 1
    }
  } else {
    state.receiverBounces += 1
    if (state.receiverBounces > 1)
      awardPoint(state, state.lastHitter, "double-bounce")
  }
  bounceTable(state.ball)
}

function updatePlayers(state: MatchState): void {
  state.players.forEach((player, index) => {
    const id = index as PlayerId
    const bot = id === 1 && state.options.mode !== "friend"
    const profile = AI_LEVELS[state.options.difficulty]
    if (
      state.phase === "rally" &&
      state.lastHitter !== id &&
      state.tick >= player.reactionAt
    ) {
      if (!bot) player.targetX = clamp(predictedX(state, id), -0.92, 0.92)
      const delta = clamp(
        player.targetX - player.position.x,
        -(bot ? profile.speed : 5.5) * FIXED_DT,
        (bot ? profile.speed : 5.5) * FIXED_DT
      )
      player.position.x += delta
    }
    updateRacket(state, id)
    if (bot) updateBotInput(state, id)
  })
}

function updateBotInput(state: MatchState, id: PlayerId): void {
  const player = state.players[id]
  const paddle = player.paddle
  const profile = AI_LEVELS[state.options.difficulty]
  if (
    state.phase === "serve" &&
    state.serveMotion.stage === "held" &&
    state.server === id &&
    state.tick >= state.nextPointAt
  ) {
    applyInput(state, id, {
      kind: "serve",
      seq: player.lastInputSeq + 1,
      aimX: (random(state) - 0.5) * 0.8,
      power: profile.power,
      spin: 0,
    })
    return
  }
  if (
    state.phase !== "rally" ||
    state.lastHitter === id ||
    state.serveStage !== 2 ||
    state.tick < player.reactionAt ||
    Math.sign(state.ball.velocity.y) !== state.ends[id]
  )
    return
  const time =
    (paddle.position.y - state.ball.position.y) / state.ball.velocity.y
  if (time <= 0 || time >= 0.16 || state.tick <= paddle.activeUntil) return
  const practice = state.options.mode === "practice"
  applyInput(state, id, {
    kind: "swing",
    seq: player.lastInputSeq + 1,
    aimX: (random(state) - 0.5) * (practice ? 0.08 : 0.9),
    power: practice ? 0.35 : profile.power,
    spin: practice ? 0 : (random(state) - 0.25) * 0.45,
    technique:
      !practice &&
      state.options.difficulty === "hard" &&
      state.ball.position.z > 1.4
        ? "smash"
        : "drive",
    sideSpin: 0,
  })
}

function ballMissed(state: MatchState): void {
  awardPoint(
    state,
    state.receiverBounces ? state.lastHitter : otherPlayer(state.lastHitter),
    state.receiverBounces ? "miss" : "out"
  )
}

function advanceBall(state: MatchState): void {
  accelerate(state.ball)
  let remaining = FIXED_DT
  for (
    let iteration = 0;
    iteration < 5 && remaining > 1e-7 && state.ball.active;
    iteration++
  ) {
    const contact = firstContact(
      state.ball,
      remaining,
      state.players,
      state.tick
    )
    if (!contact) {
      moveBall(state.ball, remaining)
      break
    }
    state.ball.position = contact.position
    remaining *= 1 - contact.fraction
    switch (contact.kind) {
      case "table":
        tableContact(state)
        break
      case "paddle":
        hitPaddle(state, contact.player!, contact)
        break
      case "net":
        state.serveNetTouched ||= state.serveStage < 2
        bounceNet(state.ball)
        event(state, "net")
        break
      case "floor":
        ballMissed(state)
        break
    }
  }
}

function advanceLooseBall(state: MatchState): void {
  if (!state.ball.active) return
  accelerate(state.ball)
  const contact = firstContact(state.ball, FIXED_DT, [], state.tick)
  if (!contact) moveBall(state.ball, FIXED_DT)
  else {
    state.ball.position = contact.position
    if (contact.kind === "table") bounceTable(state.ball)
    else if (contact.kind === "net") bounceNet(state.ball)
    else {
      state.ball.position.z = BALL_RADIUS + 1e-5
      state.ball.velocity.z = Math.abs(state.ball.velocity.z) * 0.25
      state.ball.velocity.x *= 0.8
      state.ball.velocity.y *= 0.8
    }
    moveBall(state.ball, FIXED_DT * (1 - contact.fraction))
  }
}

function updateServe(state: MatchState): void {
  const motion = state.serveMotion
  motion.peakHeight = Math.max(motion.peakHeight, state.ball.position.z)
  if (motion.stage === "toss" && state.ball.velocity.z < -0.12) {
    motion.stage = "strike"
    beginSwing(
      state,
      state.server,
      state.players[state.server].paddle.stroke,
      true
    )
  }
  if (state.tick - motion.tossAt > PHYSICS_HZ * 1.5)
    awardPoint(state, otherPlayer(state.server), "serve-fault")
}

/** Advances exactly one deterministic 120 Hz physics tick, independent of display frame rate. */
export function stepMatch(state: MatchState): void {
  state.events = []
  if (state.phase === "finished") return
  state.tick += 1
  if (state.phase === "point" && state.tick >= state.nextPointAt)
    nextServe(state)
  if (state.phase === "point") {
    updatePlayers(state)
    advanceLooseBall(state)
    return
  }
  updatePlayers(state)
  if (!state.ball.active) return
  if (state.phase === "serve") updateServe(state)
  advanceBall(state)
  const p = state.ball.position
  if (
    state.phase === "rally" &&
    (Math.abs(p.x) > 1.8 || Math.abs(p.y) > 2.4 || p.z < -0.1 || p.z > 6)
  ) {
    ballMissed(state)
  }
}
export function createSnapshot(state: MatchState): MatchState {
  return JSON.parse(JSON.stringify(state)) as MatchState
}
export function restoreSnapshot(snapshot: MatchState): MatchState {
  if (snapshot.version !== 1)
    throw new Error("Unsupported table tennis snapshot version")
  const state = createSnapshot(snapshot)
  // Additive snapshot migration for rooms checkpointed by the previous client.
  // Existing points, ends, input sequence and free-flight ball state survive.
  state.players.forEach((player, id) => {
    if (!player.paddle.normal) resetRacket(player.paddle, state.ends[id])
    player.paddle.stroke = normalizeStroke(player.paddle.stroke)
  })
  if (!state.serveMotion) {
    const side = state.ends[state.server]
    state.serveMotion = {
      stage: "complete",
      hand: vec(
        state.players[state.server].position.x + side * 0.24,
        side * (PADDLE_Y - 0.015),
        1.07
      ),
      tossAt: -1,
      contactAt: -1,
      releaseHeight: 1.09,
      peakHeight: 1.09,
    }
    if (state.phase === "serve") resetBallForServe(state)
  }
  return state
}
export function awardForfeit(state: MatchState, loser: PlayerId): void {
  if (state.phase === "finished") return
  state.phase = "finished"
  state.ball.active = false
  state.ball.velocity = vec()
  state.winner = otherPlayer(loser)
  event(state, "match", state.winner, "forfeit")
}
