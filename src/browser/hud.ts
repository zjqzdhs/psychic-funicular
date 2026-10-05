import type { MatchState, PlayerId } from "../core/types"
import type { GameMode } from "./types"
import { styles } from "./styles"

function incomingStage(state: MatchState, local: PlayerId) {
  const time =
    (state.players[local].paddle.position.y - state.ball.position.y) /
    state.ball.velocity.y
  if (
    state.phase !== "rally" ||
    state.lastHitter === local ||
    time <= 0 ||
    time >= 0.5
  )
    return null
  return time <= 0.28 ? "hit" : "prepare"
}

function matchStatus(
  state: MatchState,
  local: PlayerId,
  override: string | null
) {
  if (override) return { title: override, label: "FRIEND MATCH" }
  const label = state.rallyHits
    ? `${state.rallyHits} SHOT RALLY`
    : "READY TO RALLY"
  if (state.phase === "serve")
    return {
      title: state.server === local ? "你的发球" : "等待对手发球",
      label,
    }
  if (state.phase === "point")
    return {
      title:
        state.pointWinner === local ? "漂亮，这一分属于你" : "调整节奏，下一球",
      label,
    }
  const incoming = incomingStage(state, local)
  if (incoming)
    return {
      title:
        incoming === "hit" ? "现在滑动，回击来球" : "来球正在靠近，准备挥拍",
      label: "YOUR RETURN",
    }
  return { title: "把握节奏，准备接球", label }
}

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!
  )

export class GameHud {
  readonly root: HTMLDivElement
  readonly canvas: HTMLCanvasElement
  readonly action: HTMLButtonElement
  private readonly modal: HTMLDivElement
  private readonly signal: AbortSignal
  private readonly abort = new AbortController()
  private previousScore = ""
  private statusOverride: string | null = null
  private modalOpen = true

  constructor(
    container: HTMLElement,
    private readonly handlers: {
      exit: () => void
      pause: () => void
      action: () => void
    }
  ) {
    this.signal = this.abort.signal
    this.root = document.createElement("div")
    this.root.className = "tt-game"
    this.root.innerHTML = `<style>${styles}</style>
      <canvas class="tt-canvas" tabindex="0" aria-label="乒乓球场：向上滑动挥拍，左右滑动控制落点，空格键挥拍"></canvas>
      <div class="tt-top"><div><div class="tt-side"><button class="tt-icon tt-exit" aria-label="离开球场"><svg viewBox="0 0 24 24"><path d="m14 6-6 6 6 6"/></svg></button><span class="tt-latency"></span></div><div class="tt-brand">BREAK BUILDER · TABLE TENNIS</div></div>
      <div class="tt-scoreboard" aria-label="比赛比分"><div class="tt-player"><div class="tt-player-name tt-name0">你</div><div class="tt-player-games tt-games0">0 局</div></div><div><div class="tt-points"><b class="tt-score0">0</b><span>:</span><b class="tt-score1">0</b></div><div class="tt-match-detail">三局两胜 · 11 分制</div></div><div class="tt-player"><div class="tt-player-name tt-name1">对手</div><div class="tt-player-games tt-games1">0 局</div></div></div>
      <div class="tt-side tt-side--end"><button class="tt-icon tt-pause" aria-label="比赛菜单"><svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg></button></div></div>
      <div class="tt-rotate">横屏游玩，挥拍空间更舒适</div>
      <div class="tt-status" role="status" aria-live="polite"><div class="tt-status-label">READY TO RALLY</div><div class="tt-status-main">准备进入球场</div><div class="tt-status-help">向上滑动挥拍 · 左右滑动控制落点</div></div>
      <div class="tt-swipe-meter" data-active="false"><div class="tt-meter-track"><div class="tt-meter-fill"></div></div><div class="tt-meter-label">松手挥拍</div></div>
      <div class="tt-actions"><button class="tt-primary tt-action" hidden>发球</button></div>
      <div class="tt-modal" role="dialog" aria-modal="true" aria-label="球场状态"></div>`
    container.appendChild(this.root)
    this.canvas = this.element<HTMLCanvasElement>(".tt-canvas")
    this.action = this.element<HTMLButtonElement>(".tt-action")
    this.modal = this.element<HTMLDivElement>(".tt-modal")
    this.element(".tt-exit").addEventListener("click", handlers.exit, {
      signal: this.signal,
    })
    this.element(".tt-pause").addEventListener("click", handlers.pause, {
      signal: this.signal,
    })
    this.action.addEventListener("click", handlers.action, {
      signal: this.signal,
    })
    this.root.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") handlers.pause()
        if (event.key !== "Tab" || !this.modalOpen) return
        const focusables = Array.from(
          this.modal.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)"
          )
        )
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (!first) {
          event.preventDefault()
          return
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      },
      { signal: this.signal }
    )
  }

  private element<T extends HTMLElement = HTMLElement>(selector: string): T {
    return this.root.querySelector<T>(selector)!
  }

  names(local: string, opponent: string) {
    this.element(".tt-name0").textContent = local
    this.element(".tt-name1").textContent = opponent
  }

  loading() {
    this.show(
      `<div class="tt-kicker">YOUR COURT IS TAKING SHAPE</div><h2>正在准备球场</h2><p>加载球场、球员和器材模型…</p><div class="tt-loading-line"></div>`
    )
  }

  error(message: string, retry: () => void) {
    this.show(
      `<div class="tt-kicker">COURT UNAVAILABLE</div><h2>球场暂时未能加载</h2><p>${escape(message)}</p><div class="tt-panel-actions"><button class="tt-primary" data-retry>重新加载</button><button class="tt-text-button" data-exit>返回</button></div>`
    )
    this.modal
      .querySelector("[data-retry]")!
      .addEventListener("click", retry, { once: true })
    this.modal
      .querySelector("[data-exit]")!
      .addEventListener("click", this.handlers.exit, { once: true })
  }

  pause(online: boolean, resume: () => void) {
    this.show(
      `<div class="tt-kicker">TAKE A BREATH</div><h2>${online ? "比赛菜单" : "已暂停"}</h2><p>${online ? "联机比赛仍在继续。返回球场继续接球，或离开本场比赛。" : "向上滑动决定力量，斜向挥动改变落点。接球时球员会辅助移动；键盘也可使用空格挥拍。"}</p><div class="tt-panel-actions"><button class="tt-primary" data-resume>继续比赛</button><button class="tt-text-button" data-exit>离开球场</button></div>`
    )
    this.modal
      .querySelector("[data-resume]")!
      .addEventListener("click", resume, { once: true })
    this.modal
      .querySelector("[data-exit]")!
      .addEventListener("click", this.handlers.exit, { once: true })
  }

  result(
    state: MatchState,
    local: PlayerId,
    restart: () => void,
    online: boolean
  ) {
    this.show(
      `<div class="tt-kicker">MATCH COMPLETE</div><h2>${state.winner === local ? "赢下这场比赛" : "下场继续挑战"}</h2><div class="tt-result-score">${state.games[local]} : ${state.games[1 - local]}</div><p>最长回合 ${state.bestRally} 拍 · 三局两胜</p><div class="tt-panel-actions">${online ? "" : '<button class="tt-primary" data-restart>再来一场</button>'}<button class="tt-text-button" data-exit>返回大厅</button></div>`
    )
    this.modal
      .querySelector("[data-restart]")
      ?.addEventListener("click", restart, { once: true })
    this.modal
      .querySelector("[data-exit]")!
      .addEventListener("click", this.handlers.exit, { once: true })
  }

  private show(content: string) {
    this.modalOpen = true
    this.modal.hidden = false
    this.modal.innerHTML = `<div class="tt-panel">${content}</div>`
    this.element(".tt-top").inert = true
    this.element(".tt-actions").inert = true
    this.canvas.tabIndex = -1
    this.modal.querySelector<HTMLButtonElement>("button")?.focus()
  }

  dismiss() {
    this.modalOpen = false
    this.modal.hidden = true
    this.modal.replaceChildren()
    this.element(".tt-top").inert = false
    this.element(".tt-actions").inert = false
    this.canvas.tabIndex = 0
    this.canvas.focus({ preventScroll: true })
  }

  connection(text: string | null) {
    this.statusOverride = text
  }
  latency(ms: number) {
    this.element(".tt-latency").textContent = `${Math.round(ms)} ms`
  }
  gesture(active: boolean, power: number) {
    this.element(".tt-swipe-meter").dataset.active = String(active)
    this.element(".tt-meter-fill").style.width = `${Math.round(power * 100)}%`
  }

  update(
    state: MatchState,
    local: PlayerId,
    mode: GameMode,
    ready: boolean | null
  ) {
    const opponent = 1 - local
    const incoming = incomingStage(state, local)
    const scoreKey = [
      state.scores[local],
      state.scores[opponent],
      ...state.games,
      state.server,
      state.rallyHits,
      state.phase,
      this.statusOverride,
      ready,
      incoming,
    ].join(":")
    if (scoreKey === this.previousScore) return
    this.previousScore = scoreKey
    this.element(".tt-score0").textContent = String(state.scores[local])
    this.element(".tt-score1").textContent = String(state.scores[opponent])
    this.element(".tt-games0").textContent = `${state.games[local]} 局`
    this.element(".tt-games1").textContent = `${state.games[opponent]} 局`
    this.element(".tt-name0").classList.toggle(
      "tt-serving",
      state.server === local
    )
    this.element(".tt-name1").classList.toggle(
      "tt-serving",
      state.server !== local
    )
    this.element(".tt-match-detail").textContent =
      mode === "practice"
        ? "练习 · 连续回球"
        : `第 ${state.gameIndex + 1} 局 · 三局两胜`
    const { title, label } = matchStatus(state, local, this.statusOverride)
    this.element(".tt-status-label").textContent = label
    this.element(".tt-status-main").textContent = title
    this.action.hidden =
      ready === null && !(state.phase === "serve" && state.server === local)
    this.action.disabled = ready === true
    const readyLabel = ready ? "等待对手准备" : "准备比赛"
    this.action.textContent = ready === null ? "发球" : readyLabel
  }

  dispose() {
    this.abort.abort()
    this.root.remove()
  }
}
