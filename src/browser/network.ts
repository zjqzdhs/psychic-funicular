import type { MatchState, PlayerId, PlayerInput } from "../core/types"
import type { PlayerProfile } from "./types"

export interface RoomUpdate {
  ready: [boolean, boolean]
  players: [PlayerProfile | null, PlayerProfile | null]
  phase: "waiting" | "active" | "paused" | "ended"
}

export interface SnapshotUpdate {
  state: MatchState
  acks: [number, number]
  paused: boolean
  disconnectUntil: number | null
}

export class MatchConnection {
  private socket: WebSocket | null = null
  private closed = false
  private reconnectTimer = 0
  private pingTimer = 0
  private attempt = 0
  private sequence = 0
  private disconnectedAt = 0
  private ended = false
  private readonly abort = new AbortController()
  player: PlayerId | null = null
  pending: PlayerInput[] = []

  constructor(
    private readonly url: string,
    private readonly callbacks: {
      onSnapshot: (snapshot: SnapshotUpdate) => void
      onRoom: (room: RoomUpdate) => void
      onStatus: (text: string, connected: boolean) => void
      onLatency: (milliseconds: number) => void
    }
  ) {
    this.connect()
  }

  private connect() {
    if (this.closed) return
    const url = new URL(this.url, window.location.href)
    url.protocol =
      url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:"
    url.searchParams.set("v", "1")
    const socket = new WebSocket(url)
    this.socket = socket
    this.callbacks.onStatus(
      this.attempt ? "正在重新连接…" : "正在连接好友房间…",
      false
    )
    socket.addEventListener("open", () => {
      if (this.closed || socket !== this.socket) return
      this.sequence = 0
      this.pending = []
      this.attempt = 0
      this.disconnectedAt = 0
      this.send({ type: "tt.hello", version: 1 })
      this.pingTimer = window.setInterval(() => {
        this.send({ type: "tt.ping", sentAt: Date.now() })
      }, 5000)
    })
    socket.addEventListener("message", (event) => {
      if (
        this.closed ||
        socket !== this.socket ||
        typeof event.data !== "string"
      )
        return
      try {
        const message = JSON.parse(event.data)
        if (message.type === "tt.error") {
          this.callbacks.onStatus(message.message || "连接暂时不可用", false)
        } else if (message.type === "tt.joined" && message.version === 1) {
          this.player = message.player
          this.alignSequence(message.state)
          this.callbacks.onSnapshot({
            state: message.state,
            acks: [-1, -1],
            paused: !message.ready?.every(Boolean),
            disconnectUntil: null,
          })
          this.callbacks.onRoom({
            ready: message.ready,
            players: message.players,
            phase: message.ready?.every(Boolean) ? "active" : "waiting",
          })
          this.callbacks.onStatus(
            this.player === null ? "正在观战" : "房间已连接",
            true
          )
        } else if (message.type === "tt.snapshot" && message.version === 1) {
          this.alignSequence(message.state, message.acks)
          this.callbacks.onSnapshot(message)
        } else if (message.type === "tt.room") {
          this.ended = message.phase === "ended"
          this.callbacks.onRoom(message)
        } else if (message.type === "tt.pong") {
          this.callbacks.onLatency(Math.max(0, Date.now() - message.sentAt))
        }
      } catch {
        this.callbacks.onStatus("收到无效的房间数据，等待下一次同步", false)
      }
    })
    socket.addEventListener("close", () => {
      if (this.closed || socket !== this.socket) return
      window.clearInterval(this.pingTimer)
      if (this.ended) return
      if (!this.disconnectedAt) this.disconnectedAt = Date.now()
      this.callbacks.onStatus("连接中断，正在重连…", false)
      const delay = Math.min(4000, 500 * 2 ** this.attempt++)
      this.reconnectTimer = window.setTimeout(() => {
        void this.reconnect()
      }, delay)
    })
    socket.addEventListener("error", () => {
      if (this.closed || socket !== this.socket) return
      this.callbacks.onStatus("网络连接异常", false)
    })
  }

  private alignSequence(state: MatchState, acks?: [number, number]) {
    if (this.player === null) return
    this.sequence = Math.max(
      this.sequence,
      state.players[this.player].lastInputSeq + 1
    )
    if (acks)
      this.pending = this.pending.filter(
        (input) => input.seq > acks[this.player!]
      )
  }

  private async reconnect() {
    if (this.closed || this.ended) return
    if (Date.now() - this.disconnectedAt > 30000) {
      this.callbacks.onStatus("重连已超时，请返回大厅重新加入", false)
      return
    }
    const roomUrl = new URL(this.url, window.location.href)
    const roomId = roomUrl.pathname.split("/").filter(Boolean).pop()
    roomUrl.protocol = roomUrl.protocol === "wss:" ? "https:" : "http:"
    roomUrl.pathname = `/api/rooms/${encodeURIComponent(roomId || "")}`
    roomUrl.search = ""
    try {
      const response = await fetch(roomUrl, {
        credentials: "include",
        signal: this.abort.signal,
      })
      if (this.closed) return
      if ([401, 403, 404, 410].includes(response.status)) {
        this.ended = true
        this.callbacks.onStatus(
          response.status === 401 || response.status === 403
            ? "登录已失效或无法进入该房间，请返回大厅"
            : "比赛房间已结束，请返回大厅",
          false
        )
        return
      }
    } catch {
      if (this.closed) return
      // A transient network failure still gets a bounded reconnect attempt.
    }
    this.connect()
  }

  private send(message: object) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false
    this.socket.send(JSON.stringify(message))
    return true
  }

  input(input: Omit<PlayerInput, "seq">): PlayerInput | null {
    if (this.player === null) return null
    const sequenced = { ...input, seq: this.sequence++ }
    if (
      !this.send({
        type: "tt.input",
        version: 1,
        seq: sequenced.seq,
        input: sequenced,
      })
    )
      return null
    this.pending.push(sequenced)
    if (this.pending.length > 64) this.pending.shift()
    return sequenced
  }

  ready(ready: boolean) {
    return this.send({ type: "tt.ready", ready })
  }

  concede() {
    this.send({ type: "tt.concede" })
  }

  dispose() {
    this.closed = true
    this.abort.abort()
    window.clearTimeout(this.reconnectTimer)
    window.clearInterval(this.pingTimer)
    this.socket?.close(1000, "Leaving table tennis")
    this.socket = null
    this.pending = []
  }
}
