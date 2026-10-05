import type { MatchEvent } from "../core/types"

/** Small synthesized impact cues keep the game self-contained and do not autoplay. */
export class GameAudio {
  private context: AudioContext | null = null
  private volume: number
  private lastTick = -1

  constructor(volume = 0.65) {
    this.volume = Math.max(0, Math.min(1, volume))
  }

  unlock() {
    if (!this.context) this.context = new AudioContext()
    if (this.context.state === "suspended") void this.context.resume()
  }

  reset() {
    this.lastTick = -1
  }

  events(events: MatchEvent[]) {
    if (!this.context || this.context.state !== "running" || !this.volume)
      return
    for (const event of events) {
      if (event.tick <= this.lastTick) continue
      if (
        event.type === "hit" ||
        event.type === "bounce" ||
        event.type === "net"
      ) {
        const oscillator = this.context.createOscillator()
        const gain = this.context.createGain()
        const now = this.context.currentTime
        oscillator.type = "triangle"
        oscillator.frequency.setValueAtTime(
          { hit: 1100, net: 260, bounce: 750 }[event.type],
          now
        )
        oscillator.frequency.exponentialRampToValueAtTime(150, now + 0.055)
        gain.gain.setValueAtTime(this.volume * 0.13, now)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065)
        oscillator.connect(gain).connect(this.context.destination)
        oscillator.start(now)
        oscillator.stop(now + 0.07)
        oscillator.onended = () => {
          oscillator.disconnect()
          gain.disconnect()
        }
      }
    }
    this.lastTick = Math.max(
      this.lastTick,
      ...events.map((event) => event.tick)
    )
  }

  dispose() {
    void this.context?.close()
    this.context = null
  }
}
