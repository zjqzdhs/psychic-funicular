export type GameMode = "practice" | "ai" | "online"
export type Difficulty = "easy" | "medium" | "hard"
export type Environment = "cyber-arena" | "sports-hall"

export interface PlayerProfile {
  id: string
  displayName: string
  avatarUrl?: string
}

export interface TableTennisOptions {
  container: HTMLElement
  mode?: GameMode
  difficulty?: Difficulty
  environment?: Environment
  assetBaseUrl?: string
  preferences?: {
    quality?: "low" | "balanced" | "high"
    masterVolume?: number
    reducedMotion?: boolean
  }
  session?: {
    localPlayerId: string
    displayName?: string
    avatarUrl?: string
    websocketUrl?: string
  }
  onExit?: () => void
  onStatus?: (status: string) => void
  onResult?: (result: {
    winner: 0 | 1
    points: [number, number]
    games: [number, number]
    mode: GameMode
  }) => void
}

export interface TableTennisLifecycle {
  resize(): void
  pause(): void
  resume(): void
  dispose(): void
}

export interface StrokeGesture {
  /** Horizontal aim in the player's screen coordinates, -1 to 1. */
  aim: number
  /** Upward swipe speed controls power without a high minimum. */
  power: number
  spin: number
}
