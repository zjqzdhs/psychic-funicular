import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyInput, createMatch, createSnapshot } from "../src/core/index"
import { MatchConnection } from "../src/browser/network"

class SocketStub extends EventTarget {
  static OPEN = 1
  static sockets: SocketStub[] = []
  readyState = 1
  sent: unknown[] = []
  constructor(public url: URL) {
    super()
    SocketStub.sockets.push(this)
  }
  send(value: string) {
    this.sent.push(JSON.parse(value))
  }
  close() {
    this.readyState = 3
    this.dispatchEvent(new Event("close"))
  }
  message(value: unknown) {
    const event = new Event("message")
    Object.assign(event, { data: JSON.stringify(value) })
    this.dispatchEvent(event)
  }
}

const callbacks = () => ({
  onSnapshot: vi.fn(),
  onRoom: vi.fn(),
  onStatus: vi.fn(),
  onLatency: vi.fn(),
})

describe("friend match connection", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    SocketStub.sockets = []
    vi.stubGlobal("WebSocket", SocketStub)
    vi.stubGlobal("window", {
      location: { href: "https://play.example.test/" },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("resumes monotonic input sequencing and removes acknowledged prediction", () => {
    const connection = new MatchConnection("/ws/game/test-room", callbacks())
    const socket = SocketStub.sockets[0]
    socket.dispatchEvent(new Event("open"))
    const state = createMatch({ mode: "friend" })
    state.players[0].lastInputSeq = 8
    socket.message({
      type: "tt.joined",
      version: 1,
      player: 0,
      state,
      ready: [true, true],
      players: [null, null],
    })
    const command = connection.input({
      kind: "serve",
      aimX: 0,
      power: 0.4,
      spin: 0,
    })
    expect(command?.seq).toBe(9)
    expect(connection.pending).toHaveLength(1)
    socket.message({
      type: "tt.snapshot",
      version: 1,
      state,
      acks: [9, -1],
      paused: false,
    })
    expect(connection.pending).toHaveLength(0)
    connection.dispose()
  })

  it("stops reconnecting when room lookup reports a closed room", async () => {
    const status = callbacks()
    const fetch = vi.fn().mockResolvedValue({ status: 410 })
    vi.stubGlobal("fetch", fetch)
    const connection = new MatchConnection(
      "wss://play.example.test/ws/game/ended-room",
      status
    )
    const socket = SocketStub.sockets[0]
    socket.close()
    await vi.advanceTimersByTimeAsync(500)
    expect(fetch.mock.calls[0][0].href).toBe(
      "https://play.example.test/api/rooms/ended-room"
    )
    expect(SocketStub.sockets).toHaveLength(1)
    expect(status.onStatus).toHaveBeenLastCalledWith(
      "比赛房间已结束，请返回大厅",
      false
    )
    connection.dispose()
  })

  it("does not reconnect after a server-confirmed end or dispose", async () => {
    const connection = new MatchConnection("/ws/game/test", callbacks())
    const socket = SocketStub.sockets[0]
    socket.message({
      type: "tt.room",
      ready: [true, true],
      players: [null, null],
      phase: "ended",
    })
    socket.close()
    await vi.advanceTimersByTimeAsync(5000)
    expect(SocketStub.sockets).toHaveLength(1)
    connection.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([50, 100, 150])(
    "keeps the predicted input until the authoritative ACK at %i ms RTT",
    async (rtt) => {
      const status = callbacks()
      const connection = new MatchConnection("/ws/game/latency-room", status)
      const socket = SocketStub.sockets[0]
      socket.dispatchEvent(new Event("open"))
      const state = createMatch({ mode: "friend" })
      socket.message({
        type: "tt.joined",
        version: 1,
        player: 0,
        state: createSnapshot(state),
        ready: [true, true],
        players: [null, null],
      })
      const command = connection.input({
        kind: "serve",
        aimX: 0.15,
        power: 0.45,
        spin: 0.1,
      })!
      setTimeout(() => {
        expect(applyInput(state, 0, command)).toBe(true)
        setTimeout(
          () =>
            socket.message({
              type: "tt.snapshot",
              version: 1,
              state: createSnapshot(state),
              acks: [command.seq, -1],
              paused: false,
            }),
          rtt / 2
        )
      }, rtt / 2)
      await vi.advanceTimersByTimeAsync(rtt - 1)
      expect(connection.pending).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(connection.pending).toHaveLength(0)
      expect(status.onSnapshot.mock.lastCall?.[0].state.phase).toBe("rally")
      connection.dispose()
    }
  )
})
