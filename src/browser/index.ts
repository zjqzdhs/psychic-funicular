import {
  applyInput,
  createMatch,
  FIXED_DT,
  restoreSnapshot,
  stepMatch,
} from "../core/index"
import type { PlayerId } from "../core/types"
import { GameAudio } from "./audio"
import { GameHud } from "./hud"
import { mountGlassOverlay } from "./glass"
import { SwipeInput } from "./input"
import { MatchConnection, type RoomUpdate } from "./network"
import { GameScene } from "./scene"
import type {
  StrokeGesture,
  TableTennisLifecycle,
  TableTennisOptions,
} from "./types"

export type {
  TableTennisLifecycle,
  TableTennisOptions,
  Difficulty,
  Environment,
  GameMode,
} from "./types"

/** Owns all listeners, WebGL resources and network state beneath its container. */
export async function mountTableTennis(
  options: TableTennisOptions
): Promise<TableTennisLifecycle> {
  const mode = options.mode || "ai"
  const difficulty = options.difficulty || "medium"
  let state = createMatch({
    mode: mode === "online" ? "friend" : mode,
    difficulty,
  })
  let localPlayer: PlayerId = 0
  let scene: GameScene | null = null
  let connection: MatchConnection | null = null
  let room: RoomUpdate | null = null
  let disposed = false
  let loaded = false
  let paused = false
  let menuOpen = false
  let networkPaused = mode === "online"
  let raf = 0
  let lastFrame = 0
  let lastRendered = 0
  let renderBudget = 1 / 60
  let accumulator = 0
  let sequence = 0
  let aim = 0
  let reportedResult = false
  let authoritativeTick = 0
  let authoritativeFinished = false
  let generation = 0
  const abort = new AbortController()
  const audio = new GameAudio(options.preferences?.masterVolume)

  const exit = () => {
    if (mode === "online" && !authoritativeFinished) connection?.concede()
    dispose()
    options.onExit?.()
  }
  const resume = () => {
    if (!loaded || state.phase === "finished") return
    menuOpen = false
    paused = false
    lastFrame = 0
    accumulator = 0
    hud.dismiss()
    audio.unlock()
    updateInput()
  }
  const openMenu = () => {
    if (!loaded || state.phase === "finished") return
    if (menuOpen) {
      resume()
      return
    }
    menuOpen = true
    if (mode !== "online") paused = true
    hud.pause(mode === "online", resume, mode, restart)
    updateInput()
  }
  const action = () => {
    audio.unlock()
    if (
      mode === "online" &&
      (room?.phase === "waiting" || room?.phase === "paused")
    ) {
      connection?.ready(true)
      return
    }
    stroke({ aim, ...hud.strokeSettings() })
    hud.canvas.focus({ preventScroll: true })
  }
  const hud = new GameHud(options.container, { exit, pause: openMenu, action })
  hud.loading()
  const aiName = {
    easy: "SPARK · 入门",
    medium: "SPARK · 进阶",
    hard: "SPARK · 挑战",
  }[difficulty]
  hud.names(
    options.session?.displayName || "你",
    mode === "online" ? "等待好友" : aiName
  )
  const input = new SwipeInput(
    hud.canvas,
    stroke,
    (value) => {
      aim = value
    },
    (active, power, gesture) => hud.gesture(active, power, gesture),
    () => hud.strokeSettings()
  )
  input.setEnabled(false)
  const glass = mountGlassOverlay(hud.root, hud.canvas, {
    quality: options.preferences?.quality,
    reducedMotion: options.preferences?.reducedMotion,
    inGame: true,
  })

  function updateInput() {
    input.setEnabled(
      loaded &&
        !paused &&
        !menuOpen &&
        !networkPaused &&
        state.phase !== "finished" &&
        (mode !== "online" || connection?.player !== null)
    )
  }

  function stroke(gesture: StrokeGesture) {
    if (
      !loaded ||
      paused ||
      menuOpen ||
      networkPaused ||
      state.phase === "finished"
    )
      return
    audio.unlock()
    const command = {
      kind: state.phase === "serve" ? ("serve" as const) : ("swing" as const),
      aimX: gesture.aim * -state.ends[localPlayer],
      power: gesture.power,
      spin: gesture.spin,
      sideSpin: gesture.sideSpin,
      technique: gesture.technique,
    }
    const next =
      mode === "online"
        ? connection?.input(command)
        : { ...command, seq: sequence++ }
    if (next) {
      if (applyInput(state, localPlayer, next))
        hud.attempted(state, localPlayer)
      audio.events(state.events)
      hud.events(state, localPlayer)
    }
  }

  function connect() {
    if (!options.session?.websocketUrl) {
      hud.error("好友房间缺少连接地址，请从大厅重新进入。", exit)
      return
    }
    connection = new MatchConnection(options.session.websocketUrl, {
      onSnapshot(snapshot) {
        if (disposed) return
        try {
          state = restoreSnapshot(snapshot.state)
          authoritativeTick = state.tick
          authoritativeFinished = state.phase === "finished"
          networkPaused = snapshot.paused
          if (connection?.player !== null && connection?.player !== undefined) {
            localPlayer = connection.player
            scene?.setPlayer(localPlayer)
            // Reapply only inputs not yet acknowledged by the authority.
            for (const pending of connection.pending)
              applyInput(state, localPlayer, pending)
          }
          if (snapshot.disconnectUntil)
            hud.connection(
              `对手断线，保留席位 ${Math.max(0, Math.ceil((snapshot.disconnectUntil - Date.now()) / 1000))} 秒`
            )
          else if (!snapshot.paused) hud.connection(null)
          hud.events(state, localPlayer)
          updateInput()
        } catch {
          hud.connection("比赛状态暂时无法同步，等待重连")
          networkPaused = true
          updateInput()
        }
      },
      onRoom(update) {
        room = update
        networkPaused = update.phase !== "active" && update.phase !== "ended"
        const me = update.players[localPlayer]
        const opponent = update.players[1 - localPlayer]
        hud.names(
          me?.displayName || options.session?.displayName || "你",
          opponent?.displayName || "等待好友"
        )
        let roomStatus: string | null = null
        if (update.phase === "waiting")
          roomStatus = opponent ? "双方准备后开始比赛" : "邀请好友加入这张球台"
        if (update.phase === "paused") roomStatus = "比赛已暂停，就绪后继续"
        hud.connection(roomStatus)
        updateInput()
      },
      onStatus(text, connected) {
        options.onStatus?.(text)
        if (!connected) {
          networkPaused = true
          hud.connection(text)
          updateInput()
        }
      },
      onLatency(ms) {
        hud.latency(ms)
      },
    })
  }

  function restart() {
    if (mode === "online") return
    state = createMatch({
      mode,
      difficulty,
      seed: Date.now() >>> 0,
    })
    sequence = 0
    reportedResult = false
    audio.reset()
    hud.resetFeedback()
    resume()
  }

  function checkResult() {
    if (
      state.phase !== "finished" ||
      state.winner === undefined ||
      reportedResult
    )
      return
    if (mode === "online" && !authoritativeFinished) return
    reportedResult = true
    input.setEnabled(false)
    hud.result(state, localPlayer, restart, mode === "online")
    const result = {
      winner: state.winner,
      points: state.scores,
      games: state.games,
      mode,
    }
    if (mode !== "online") {
      try {
        const key = "break-builder.table-tennis.results.v1"
        const records = JSON.parse(localStorage.getItem(key) || "[]")
        const history = Array.isArray(records) ? records.slice(-19) : []
        localStorage.setItem(
          key,
          JSON.stringify([
            ...history,
            {
              ...result,
              difficulty,
              bestRally: state.bestRally,
              playedAt: new Date().toISOString(),
            },
          ])
        )
      } catch {
        /* Browser storage may be unavailable; gameplay remains usable. */
      }
    }
    options.onResult?.(result)
  }

  function frame(time: number) {
    if (disposed) return
    raf = requestAnimationFrame(frame)
    const elapsed = lastFrame ? Math.min(0.1, (time - lastFrame) / 1000) : 0
    lastFrame = time
    if (!loaded || document.hidden) return
    input.update(time)
    if (!paused && !networkPaused) {
      accumulator += elapsed
      let steps = 0
      while (accumulator >= FIXED_DT && steps++ < 12) {
        // Bound prediction to 200 ms; stale networking must not invent a match outcome.
        if (mode !== "online" || state.tick < authoritativeTick + 24) {
          stepMatch(state)
          audio.events(state.events)
          hud.events(state, localPlayer)
        }
        accumulator -= FIXED_DT
      }
    }
    renderBudget += elapsed
    if (renderBudget < 1 / 60 - 0.0005) return
    renderBudget %= 1 / 60
    const renderElapsed = Math.min(0.1, (time - lastRendered) / 1000)
    lastRendered = time
    scene?.setPlayer(localPlayer)
    scene?.update(state, paused ? 0 : renderElapsed)
    scene?.render()
    glass.render(time)
    const ready =
      mode === "online" &&
      (room?.phase === "waiting" || room?.phase === "paused")
        ? room.ready[localPlayer]
        : null
    hud.update(state, localPlayer, mode, ready)
    checkResult()
  }

  function resize() {
    const bounds = options.container.getBoundingClientRect()
    scene?.resize(bounds.width, bounds.height)
    lastRendered = 0
    renderBudget = 1 / 60
  }
  const observer = new ResizeObserver(resize)
  observer.observe(options.container)
  window.addEventListener("resize", resize, { signal: abort.signal })
  document.addEventListener(
    "visibilitychange",
    () => {
      lastFrame = 0
      accumulator = 0
      if (
        document.hidden &&
        mode !== "online" &&
        loaded &&
        state.phase !== "finished"
      ) {
        menuOpen = true
        paused = true
        hud.pause(false, resume, mode, restart)
        updateInput()
      }
    },
    { signal: abort.signal }
  )
  hud.canvas.addEventListener(
    "webglcontextlost",
    (event) => {
      event.preventDefault()
      if (disposed || !loaded) return
      loaded = false
      updateInput()
      hud.error("图形设备连接中断，请重新加载球场。", () => {
        void load()
      })
    },
    { signal: abort.signal }
  )

  async function load() {
    const current = ++generation
    loaded = false
    updateInput()
    hud.loading()
    scene?.dispose(false)
    scene = null
    try {
      const next = new GameScene(hud.canvas, options)
      scene = next
      await next.load(
        options.assetBaseUrl || "/models/table-tennis/",
        options.environment || "cyber-arena"
      )
      if (disposed || current !== generation) {
        next.dispose()
        return
      }
      loaded = true
      resize()
      next.update(state, FIXED_DT, true)
      hud.dismiss()
      if (mode === "practice") hud.practiceGuide()
      if (mode === "online" && !connection) connect()
      updateInput()
      options.onStatus?.("球场已就绪")
    } catch (error) {
      if (disposed || current !== generation) return
      scene?.dispose(false)
      const message =
        error instanceof Error ? error.message : "模型资源暂时不可用"
      hud.error(message, () => {
        void load()
      })
      options.onStatus?.(`加载失败：${message}`)
    }
  }

  function dispose() {
    if (disposed) return
    disposed = true
    generation++
    cancelAnimationFrame(raf)
    observer.disconnect()
    abort.abort()
    input.dispose()
    connection?.dispose()
    audio.dispose()
    glass.dispose()
    scene?.dispose()
    hud.dispose()
  }

  raf = requestAnimationFrame(frame)
  await load()
  return {
    resize,
    pause() {
      if (mode !== "online") paused = true
      input.setEnabled(false)
    },
    resume,
    dispose,
  }
}
