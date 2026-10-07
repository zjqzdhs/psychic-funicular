import type { MatchEvent, MatchState, PlayerId } from "../core/types"

export const GUIDE_STORAGE_KEY = "break-builder-tt-guide-v2"
export type GuideStage = "serve" | "power" | "spin" | "complete"
interface ReturnEvidence {
  serving: boolean
  power: number
  speed: number
  topspin: boolean
}

/** Lessons advance on the learner's legal landing, not a click or opponent hit. */
export class PracticeCoach {
  stage: GuideStage = "serve"
  active = false
  lightSpeed: number | null = null
  strongSpeed: number | null = null
  note = ""
  private candidate: ReturnEvidence | null = null

  start() {
    this.active = true
    this.stage = "serve"
    this.lightSpeed = this.strongSpeed = null
    this.note = ""
    this.candidate = null
  }

  skip() {
    this.active = false
    this.candidate = null
  }

  resetPoint() {
    this.candidate = null
  }

  observe(event: MatchEvent, state: MatchState, local: PlayerId): boolean {
    if (!this.active || this.stage === "complete") return false
    if (
      (event.type === "serve" || event.type === "hit") &&
      event.player === local
    ) {
      this.contact(event, state, local)
    }
    if (
      event.type === "point" ||
      event.type === "let" ||
      (event.type === "hit" && event.player !== local)
    ) {
      if (this.candidate)
        this.note =
          event.type === "let"
            ? "发球擦网，重新发球完成本步。"
            : "本次未完成目标，继续尝试当前一步。"
      this.candidate = null
      return false
    }
    if (
      event.type !== "bounce" ||
      event.player === local ||
      state.lastHitter !== local ||
      state.phase !== "rally" ||
      state.serveStage !== 2 ||
      state.receiverBounces !== 1 ||
      !this.candidate
    )
      return false
    const hit = this.candidate
    this.candidate = null
    return this.landed(hit)
  }

  private contact(event: MatchEvent, state: MatchState, local: PlayerId) {
    const stroke = state.players[local].paddle.stroke
    const velocity = state.ball.velocity
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z)
    this.candidate = {
      serving: event.type === "serve",
      power: stroke.power,
      speed,
      topspin:
        stroke.spin >= 0.3 &&
        state.ball.spin.x * velocity.y - state.ball.spin.y * velocity.x <
          -speed * 2,
    }
    this.note = "已触球，等待合法落到对台…"
  }

  private landed(hit: ReturnEvidence) {
    if (this.stage === "serve") {
      if (!hit.serving) return false
      this.stage = "power"
      this.note = "发球已依次落到双方台面。"
    } else if (this.stage === "power" && !hit.serving) {
      this.powerLanding(hit)
    } else if (this.stage === "spin" && !hit.serving) {
      if (!hit.topspin) {
        this.note = "回球已落台；向上刷或用 E，完成带实际上旋的回球。"
        return false
      }
      this.stage = "complete"
      this.note = "发球、轻重球和上旋均已成功落台。菜单里可重新练习。"
      return true
    }
    return false
  }

  private powerLanding(hit: ReturnEvidence) {
    if (hit.power <= 0.34 && this.lightSpeed === null) {
      this.lightSpeed = hit.speed
      this.note = `轻球成功 · 离拍 ${hit.speed.toFixed(1)} m/s，再试更有力的回击。`
    } else if (
      hit.power >= 0.58 &&
      this.lightSpeed !== null &&
      hit.speed > this.lightSpeed * 1.12
    ) {
      this.strongSpeed = hit.speed
      this.stage = "spin"
      this.note = `重球成功 · ${this.lightSpeed.toFixed(1)} → ${hit.speed.toFixed(1)} m/s。`
    } else {
      this.note =
        this.lightSpeed === null
          ? "先用轻点或短按 Q 完成一次轻回球。"
          : "再多蓄力一点；需要更快的离拍速度并落到对台。"
    }
  }

  get instruction() {
    if (this.stage === "serve")
      return "1 / 3 · 点“抛球发球”，让球依次落到己方和对方台面。"
    if (this.stage === "power")
      return this.lightSpeed === null
        ? "2 / 3 · 来球落台后轻点或短按 Q，先完成一次轻回球。"
        : "2 / 3 · 接下一球前短蓄力，松开左键或 W，用更快的球落到对台。"
    if (this.stage === "spin")
      return "3 / 3 · 向上刷动，或按住 E 短蓄力后松手，完成上旋回球。"
    return "引导完成 · 自由组合时机、落点、力量与旋转。"
  }
}

export function timeToPaddle(
  state: MatchState,
  local: PlayerId
): number | null {
  if (
    state.lastHitter === local ||
    Math.sign(state.ball.velocity.y) !== state.ends[local]
  )
    return null
  return (
    (state.players[local].paddle.position.y - state.ball.position.y) /
    state.ball.velocity.y
  )
}

export function missedStrokeHint(
  startTime: number | null,
  remainingTime: number | null
) {
  if (startTime !== null && startTime <= 0.045)
    return "出拍偏晚 · 球已靠近或越过拍面，下一球提前松手"
  if (remainingTime !== null && remainingTime > 0.045)
    return "出拍偏早 · 挥拍结束时球还未到拍面"
  return "挥拍未触球 · 本次拍面未碰到球，调整时机与方向"
}
