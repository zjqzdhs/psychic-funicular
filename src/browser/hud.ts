import type {
  MatchEvent,
  MatchState,
  PlayerId,
  PointReason,
  StrokeTechnique,
} from "../core/types"
import { DEFAULT_STROKE, type GameMode, type StrokeSettings } from "./types"
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
  if (state.phase === "serve") {
    const heldTitle =
      state.server === local ? "你的发球 · 点击发球或按空格" : "对手准备发球"
    return {
      title:
        state.serveMotion.stage === "held"
          ? heldTitle
          : "抛球后下降触拍，准备接球",
      label,
    }
  }
  if (state.phase === "point") {
    const reason = state.pointReason
      ? ` · ${POINT_REASONS[state.pointReason]}`
      : ""
    return {
      title: `${state.pointWinner === local ? "你得分" : "对手得分"}${reason}`,
      label,
    }
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

const TECHNIQUES: Record<
  StrokeTechnique,
  { label: string; help: string; power: number; spin: number }
> = {
  push: {
    label: "轻挡",
    help: "柔和挡回 · 适合近台控球",
    power: 0.28,
    spin: -0.35,
  },
  drive: {
    label: "平击",
    help: "直接回击 · 力量与旋转可单独调整",
    power: 0.5,
    spin: 0,
  },
  topspin: {
    label: "上旋",
    help: "向上摩擦 · 弧线过网后下坠",
    power: 0.6,
    spin: 0.65,
  },
  smash: {
    label: "扣杀",
    help: "进攻高球 · 低球扣杀容易下网",
    power: 0.85,
    spin: 0.1,
  },
}
const POINT_REASONS: Record<PointReason, string> = {
  miss: "未接到来球",
  out: "回球出界",
  "double-bounce": "球在同侧落台两次",
  "wrong-side": "回球先落在己方台面",
  volley: "球未落台就被截击",
  "serve-fault": "发球未依次落在双方台面",
  forfeit: "对方退出比赛",
}

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
  private settings: StrokeSettings = { ...DEFAULT_STROKE }
  private feedbackText = ""
  private feedbackUntil = 0
  private lastEventTick = -1
  private pendingSwing: { tick: number; until: number } | null = null
  private guideStep = 0

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
      <canvas class="tt-canvas" tabindex="0" aria-label="乒乓球场：拖动或滑动挥拍，左右方向控制落点；空格使用当前球技、力量和旋转"></canvas>
      <div class="tt-top"><div><div class="tt-side"><button class="tt-icon tt-exit" aria-label="离开球场"><svg viewBox="0 0 24 24"><path d="m14 6-6 6 6 6"/></svg></button><span class="tt-latency"></span></div><div class="tt-brand">BREAK BUILDER · TABLE TENNIS</div></div>
      <div class="tt-scoreboard" data-glass="optical" aria-label="比赛小分与胜局"><div class="tt-player"><div class="tt-player-name tt-name0">你</div><div class="tt-player-games tt-games0">胜局 0</div></div><div><div class="tt-points"><b class="tt-score0">0</b><span>:</span><b class="tt-score1">0</b></div><div class="tt-match-detail">小分 · 11 分制</div></div><div class="tt-player"><div class="tt-player-name tt-name1">对手</div><div class="tt-player-games tt-games1">胜局 0</div></div></div>
      <div class="tt-side tt-side--end"><button class="tt-icon tt-pause" aria-label="比赛菜单"><svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg></button></div></div>
      <div class="tt-rotate">横屏游玩，挥拍空间更舒适</div>
      <div class="tt-status" role="status" aria-live="polite"><div class="tt-status-label">准备接球</div><div class="tt-status-main">准备进入球场</div><div class="tt-status-help">拖动 / 滑动挥拍 · 空格使用当前配置</div></div>
      <div class="tt-controls" data-glass="optical" aria-label="球技与旋转"><div class="tt-techniques" role="group" aria-label="选择球技">${Object.entries(
        TECHNIQUES
      )
        .map(
          ([value, item]) =>
            `<button data-technique="${value}" aria-pressed="${value === "drive"}" title="${item.help}">${item.label}</button>`
        )
        .join(
          ""
        )}<button class="tt-adjust" aria-expanded="false" aria-controls="tt-stroke-settings">调节</button></div>
      <div class="tt-stroke-settings" id="tt-stroke-settings" hidden><p class="tt-technique-help">${TECHNIQUES.drive.help}</p><label>力量 <output data-value="power">50%</output><input aria-label="击球力量" data-setting="power" type="range" min=".04" max="1" step=".01" value=".5"></label><label>下旋 / 上旋 <output data-value="spin">0</output><input aria-label="下旋或上旋" data-setting="spin" type="range" min="-1" max="1" step=".05" value="0"></label><label>左旋 / 右旋 <output data-value="sideSpin">0</output><input aria-label="侧旋" data-setting="sideSpin" type="range" min="-1" max="1" step=".05" value="0"></label><small>滑动快慢决定力量；空格按此配置出拍</small></div></div>
      <div class="tt-guide" data-glass="ambient" hidden><span class="tt-guide-text"></span><button class="tt-guide-skip">跳过提示</button></div>
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
    this.bindStrokeControls()
    this.element(".tt-guide-skip").addEventListener(
      "click",
      () => {
        this.element(".tt-guide").hidden = true
        this.guideStep = 3
      },
      { signal: this.signal }
    )
    this.root.addEventListener(
      "keydown",
      (event) => {
        if (
          event.code === "Space" &&
          !event.repeat &&
          !this.modalOpen &&
          event.target instanceof HTMLInputElement &&
          event.target.type === "range"
        ) {
          event.preventDefault()
          handlers.action()
        }
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

  strokeSettings(): StrokeSettings {
    return { ...this.settings }
  }

  private bindStrokeControls() {
    this.root
      .querySelectorAll<HTMLButtonElement>("[data-technique]")
      .forEach((button) => {
        button.addEventListener(
          "click",
          () => {
            const technique = button.dataset.technique as StrokeTechnique
            this.settings = {
              ...this.settings,
              technique,
              power: TECHNIQUES[technique].power,
              spin: TECHNIQUES[technique].spin,
            }
            this.root
              .querySelectorAll<HTMLButtonElement>("[data-technique]")
              .forEach((item) =>
                item.setAttribute("aria-pressed", String(item === button))
              )
            this.element(".tt-technique-help").textContent =
              TECHNIQUES[technique].help
            for (const key of ["power", "spin", "sideSpin"] as const) {
              this.element<HTMLInputElement>(`[data-setting="${key}"]`).value =
                String(this.settings[key])
              this.settingLabel(key)
            }
            this.canvas.focus({ preventScroll: true })
          },
          { signal: this.signal }
        )
      })
    this.root
      .querySelectorAll<HTMLInputElement>("[data-setting]")
      .forEach((input) => {
        input.addEventListener(
          "input",
          () => {
            const key = input.dataset.setting as "power" | "spin" | "sideSpin"
            this.settings[key] = Number(input.value)
            this.settingLabel(key)
          },
          { signal: this.signal }
        )
      })
    this.element(".tt-adjust").addEventListener(
      "click",
      () => {
        const panel = this.element(".tt-stroke-settings")
        panel.hidden = !panel.hidden
        this.element(".tt-adjust").setAttribute(
          "aria-expanded",
          String(!panel.hidden)
        )
      },
      { signal: this.signal }
    )
  }

  private settingLabel(key: "power" | "spin" | "sideSpin") {
    const value = Math.round(this.settings[key] * 100)
    this.element(`[data-value="${key}"]`).textContent =
      `${value > 0 && key !== "power" ? "+" : ""}${value}${key === "power" ? "%" : ""}`
  }

  practiceGuide() {
    this.guideStep = 0
    this.element(".tt-guide").hidden = false
    this.element(".tt-guide-text").textContent =
      "1 / 3 · 点击发球，观察托球、抛球和下降触拍。"
  }

  attempted(state: MatchState, local: PlayerId) {
    if (state.phase !== "rally") return
    this.pendingSwing = {
      tick: state.tick,
      until: state.players[local].paddle.activeUntil,
    }
  }

  events(state: MatchState, local: PlayerId) {
    for (const event of state.events) {
      if (event.tick <= this.lastEventTick) continue
      this.matchEvent(event, state, local)
    }
    this.lastEventTick = Math.max(
      this.lastEventTick,
      ...state.events.map((event) => event.tick)
    )
    if (this.pendingSwing && state.tick > this.pendingSwing.until) {
      if (state.players[local].paddle.contactAt < this.pendingSwing.tick) {
        this.feedbackText = "挥拍未触球 · 等球靠近后再出拍"
        this.feedbackUntil = state.tick + 90
      }
      this.pendingSwing = null
    }
  }

  private matchEvent(event: MatchEvent, state: MatchState, local: PlayerId) {
    if (event.type === "point") {
      const result = event.player === local ? "你得分" : "对手得分"
      this.feedbackText = `${result} · ${POINT_REASONS[event.reason || "miss"]}`
      this.feedbackUntil = state.tick + 150
      this.pendingSwing = null
    } else if (event.type === "hit" && event.player === local) {
      const actualTechnique =
        state.players[local].paddle.stroke.technique || "drive"
      this.feedbackText = `已触球 · ${TECHNIQUES[actualTechnique].label}`
      this.feedbackUntil = state.tick + 45
      this.pendingSwing = null
      if (this.guideStep < 3) this.advanceGuide(2)
    } else if (
      event.type === "serve" &&
      event.player === local &&
      this.guideStep < 2
    )
      this.advanceGuide(1)
    else if (event.type === "let") {
      this.feedbackText = "发球擦网 · 重新发球"
      this.feedbackUntil = state.tick + 120
    }
  }

  private advanceGuide(step: number) {
    this.guideStep = step
    this.element(".tt-guide-text").textContent =
      step === 1
        ? "2 / 3 · 等球落台靠近你，再拖动或滑动出拍；也可按空格。"
        : "3 / 3 · 已完成回球！试试下方球技，调节里可独立改变旋转。"
  }

  resetFeedback() {
    this.lastEventTick = -1
    this.feedbackUntil = 0
    this.pendingSwing = null
    this.previousScore = ""
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
    this.element(".tt-controls").inert = true
    this.canvas.tabIndex = -1
    this.modal.querySelector<HTMLButtonElement>("button")?.focus()
  }

  dismiss() {
    this.modalOpen = false
    this.modal.hidden = true
    this.modal.replaceChildren()
    this.element(".tt-top").inert = false
    this.element(".tt-actions").inert = false
    this.element(".tt-controls").inert = false
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
      state.pointReason,
      state.serveMotion.stage,
      state.tick <= this.feedbackUntil ? this.feedbackText : "",
      this.statusOverride,
      ready,
      incoming,
    ].join(":")
    if (scoreKey === this.previousScore) return
    this.previousScore = scoreKey
    this.element(".tt-score0").textContent = String(state.scores[local])
    this.element(".tt-score1").textContent = String(state.scores[opponent])
    this.element(".tt-games0").textContent = `胜局 ${state.games[local]}`
    this.element(".tt-games1").textContent = `胜局 ${state.games[opponent]}`
    this.element(".tt-name0").classList.toggle(
      "tt-serving",
      state.server === local
    )
    this.element(".tt-name1").classList.toggle(
      "tt-serving",
      state.server !== local
    )
    const serverName = state.server === local ? "你" : "对手"
    this.element(".tt-match-detail").textContent =
      mode === "practice"
        ? "练习 · 连续回球"
        : `小分 · 第 ${state.gameIndex + 1} 局 · ${serverName}发球`
    const { title, label } = matchStatus(state, local, this.statusOverride)
    this.element(".tt-status-label").textContent = label
    this.element(".tt-status-main").textContent =
      !this.statusOverride &&
      state.phase !== "point" &&
      state.tick <= this.feedbackUntil &&
      this.feedbackText
        ? this.feedbackText
        : title
    this.action.hidden =
      ready === null && !(state.phase === "serve" && state.server === local)
    this.action.disabled =
      ready === true || (ready === null && state.serveMotion.stage !== "held")
    const readyLabel = ready ? "等待对手准备" : "准备比赛"
    this.action.textContent = ready === null ? "抛球发球" : readyLabel
  }

  dispose() {
    this.abort.abort()
    this.root.remove()
  }
}
