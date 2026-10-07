import type { StrokeTechnique } from "../core/types"

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
  /** Hold duration or brushing speed controls power without a high minimum. */
  power: number
  spin: number
  technique?: StrokeTechnique
  sideSpin?: number
}

export interface StrokeSettings {
  technique: StrokeTechnique
  power: number
  spin: number
  sideSpin: number
}

export const DEFAULT_STROKE: StrokeSettings = {
  technique: "drive",
  power: 0.5,
  spin: 0,
  sideSpin: 0,
}

export const STROKE_PRESETS: Record<StrokeTechnique, StrokeSettings> = {
  push: { technique: "push", power: 0.28, spin: -0.35, sideSpin: 0 },
  drive: { ...DEFAULT_STROKE },
  topspin: { technique: "topspin", power: 0.6, spin: 0.65, sideSpin: 0 },
  smash: { technique: "smash", power: 0.85, spin: 0.1, sideSpin: 0 },
}
