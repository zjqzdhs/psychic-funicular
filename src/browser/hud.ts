import type {
  MatchEvent,
  MatchState,
  PlayerId,
  PointReason,
  StrokeTechnique,
} from "../core/types"
import {
  DEFAULT_STROKE,
  type GameMode,
  type StrokeGesture,
  type StrokeSettings,
} from "./types"
import {
  GUIDE_STORAGE_KEY,
  PracticeCoach,
  missedStrokeHint,
  timeToPaddle,
} from "./coaching"
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
      state.server === local
        ? "你的发球 · 点击发球或按住空格后松手"
        : "对手准备发球"
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
        incoming === "hit" ? "来球将到 · 松手出拍" : "来球正在靠近，准备短蓄力",
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
  private pendingSwing: {
    tick: number
    until: number
    arrival: number | null
  } | null = null
  private readonly coach = new PracticeCoach()
  private guideText = ""

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
      <canvas class="tt-canvas" tabindex="0" aria-label="乒乓球场：指针左右瞄准，点击轻挡，按住蓄力松手出拍；上下刷动加旋；Q W E R 直接出拍，A D 侧旋"></canvas>
      <div class="tt-top"><div><div class="tt-side"><button class="tt-icon tt-exit" aria-label="离开球场"><svg viewBox="0 0 24 24"><path d="m14 6-6 6 6 6"/></svg></button><span class="tt-latency"></span></div><div class="tt-brand">BREAK BUILDER · TABLE TENNIS</div></div>
      <div class="tt-scoreboard" data-glass="optical" aria-label="比赛小分与胜局"><div class="tt-player"><div class="tt-player-name tt-name0">你</div><div class="tt-player-games tt-games0">胜局 0</div></div><div><div class="tt-points"><b class="tt-score0">0</b><span>:</span><b class="tt-score1">0</b></div><div class="tt-match-detail">小分 · 11 分制</div></div><div class="tt-player"><div class="tt-player-name tt-name1">对手</div><div class="tt-player-games tt-games1">胜局 0</div></div></div>
      <div class="tt-side tt-side--end"><button class="tt-icon tt-pause" aria-label="比赛菜单"><svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg></button></div></div>
      <div class="tt-rotate">横屏游玩，挥拍空间更舒适</div>
      <div class="tt-status" role="status" aria-live="polite"><div class="tt-status-label">准备接球</div><div class="tt-status-main">准备进入球场</div><div class="tt-status-help">轻点轻挡 · 短蓄力松手出拍 · 上下刷动加旋</div></div>
      <div class="tt-controls" data-glass="optical" aria-label="操作提示与精调"><div class="tt-control-summary"><span>Q 轻挡 · W 平击 · E 上旋 · R 扣杀</span><button class="tt-adjust" aria-expanded="false" aria-controls="tt-stroke-settings">操作 / 精调</button></div><div class="tt-stroke-settings" id="tt-stroke-settings" hidden><p class="tt-control-help">鼠标左右瞄准，点击轻挡；按住约半秒蓄力，松手出拍。上下刷动加上下旋。<br>Q / W / E / R 按住后松手直接出拍；A / D 按住加侧旋；空格使用下方默认球技。扣杀适合高球，低球可能下网。</p><div class="tt-techniques" role="group" aria-label="默认球技">${Object.entries(
        TECHNIQUES
      )
        .map(
          ([value, item]) =>
            `<button data-technique="${value}" aria-pressed="${value === "drive"}" title="${item.help}">${item.label}</button>`
        )
        .join("")}</div>
      <p class="tt-technique-help">${TECHNIQUES.drive.help}</p><label>力量灵敏度 <output data-value="power">50%</output><input aria-label="力量灵敏度" data-setting="power" type="range" min=".04" max="1" step=".01" value=".5"></label><label>默认下旋 / 上旋 <output data-value="spin">0</output><input aria-label="默认下旋或上旋" data-setting="spin" type="range" min="-1" max="1" step=".05" value="0"></label><label>默认左旋 / 右旋 <output data-value="sideSpin">0</output><input aria-label="默认侧旋" data-setting="sideSpin" type="range" min="-1" max="1" step=".05" value="0"></label><small>手势 / 按住时长决定本拍力量；精调不暂停回合。</small><button class="tt-adjust-close tt-text-button">收起并回到球场</button></div></div>
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
        this.coach.skip()
        this.element(".tt-guide").hidden = true
      },
      { signal: this.signal }
    )
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
    this.element(".tt-adjust-close").addEventListener(
      "click",
      () => {
        this.element(".tt-stroke-settings").hidden = true
        this.element(".tt-adjust").setAttribute("aria-expanded", "false")
        this.canvas.focus({ preventScroll: true })
      },
      { signal: this.signal }
    )
  }

  private settingLabel(key: "power" | "spin" | "sideSpin") {
    const value = Math.round(this.settings[key] * 100)
    this.element(`[data-value="${key}"]`).textContent =
      `${value > 0 && key !== "power" ? "+" : ""}${value}${key === "power" ? "%" : ""}`
  }

  practiceGuide(force = false) {
    if (!force) {
      try {
        if (localStorage.getItem(GUIDE_STORAGE_KEY) === "complete") return
      } catch {
        /* Storage is optional. */
      }
    }
    this.coach.start()
    this.updateGuide()
  }

  private updateGuide() {
    if (!this.coach.active) return
    const text = [this.coach.instruction, this.coach.note]
      .filter(Boolean)
      .join(" ")
    if (this.guideText !== text) {
      this.guideText = text
      this.element(".tt-guide-text").textContent = text
    }
    this.element(".tt-guide").hidden = false
    this.element(".tt-guide-skip").textContent =
      this.coach.stage === "complete" ? "收起" : "跳过引导"
  }

  attempted(state: MatchState, local: PlayerId) {
    if (state.phase !== "rally") return
    this.pendingSwing = {
      tick: state.tick,
      until: state.players[local].paddle.activeUntil,
      arrival: timeToPaddle(state, local),
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
        this.feedbackText = missedStrokeHint(
          this.pendingSwing.arrival,
          timeToPaddle(state, local)
        )
        this.feedbackUntil = state.tick + 90
      }
      this.pendingSwing = null
    }
  }

  private matchEvent(event: MatchEvent, state: MatchState, local: PlayerId) {
    if (this.coach.observe(event, state, local)) {
      try {
        localStorage.setItem(GUIDE_STORAGE_KEY, "complete")
      } catch {
        /* Storage is optional. */
      }
    }
    this.updateGuide()
    if (event.type === "point") {
      const result = event.player === local ? "你得分" : "对手得分"
      const miss =
        event.reason === "miss" &&
        this.pendingSwing &&
        state.players[local].paddle.contactAt < this.pendingSwing.tick
          ? ` · ${missedStrokeHint(this.pendingSwing.arrival, timeToPaddle(state, local))}`
          : ""
      this.feedbackText = `${result} · ${POINT_REASONS[event.reason || "miss"]}${miss}`
      this.feedbackUntil = state.tick + 150
      this.pendingSwing = null
    } else if (event.type === "hit" && event.player === local) {
      const actualTechnique =
        state.players[local].paddle.stroke.technique || "drive"
      this.feedbackText = `已触球 · ${TECHNIQUES[actualTechnique].label}`
      this.feedbackUntil = state.tick + 45
      this.pendingSwing = null
    } else if (event.type === "let") {
      this.feedbackText = "发球擦网 · 重新发球"
      this.feedbackUntil = state.tick + 120
    }
  }

  resetFeedback() {
    this.lastEventTick = -1
    this.feedbackUntil = 0
    this.pendingSwing = null
    this.previousScore = ""
    this.coach.resetPoint()
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

  pause(
    online: boolean,
    resume: () => void,
    mode: GameMode,
    restart: () => void
  ) {
    const restartLabel = mode === "practice" ? "重开练习" : "再来一场"
    const restartButton = online
      ? ""
      : `<button class="tt-text-button" data-restart>${restartLabel}</button>`
    this.show(
      `<div class="tt-kicker">TAKE A BREATH</div><h2>${online ? "比赛菜单" : "已暂停"}</h2><p>${online ? "联机比赛仍在继续；本菜单不会重置权威比赛。" : "指针左右瞄准，点击轻挡；按住短蓄力后松手击球。上下刷动加旋，Q/W/E/R 快速出对应球技，A/D 临时侧旋。"}</p><div class="tt-panel-actions"><button class="tt-primary" data-resume>继续比赛</button>${restartButton}${mode === "practice" ? '<button class="tt-text-button" data-guide>重看上手引导</button>' : ""}<button class="tt-text-button" data-exit>离开球场</button></div>`
    )
    this.modal
      .querySelector("[data-restart]")
      ?.addEventListener("click", restart, { once: true })
    this.modal.querySelector("[data-guide]")?.addEventListener(
      "click",
      () => {
        restart()
        this.practiceGuide(true)
      },
      { once: true }
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
  gesture(active: boolean, power: number, stroke?: StrokeGesture) {
    this.element(".tt-swipe-meter").dataset.active = String(active)
    this.element(".tt-meter-fill").style.width = `${Math.round(power * 100)}%`
    if (stroke)
      this.element(".tt-meter-label").textContent =
        `${TECHNIQUES[stroke.technique || "drive"].label} ${Math.round(power * 100)}% · 松手出拍`
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
      (state.phase !== "point" || /^(你|对手)得分/.test(this.feedbackText)) &&
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
