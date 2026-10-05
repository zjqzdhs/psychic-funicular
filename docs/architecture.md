# Core and platform boundaries

The portable core contains no browser, renderer, network, database or Cloudflare imports. All persistent state is a JSON-compatible `MatchState`; a seeded integer RNG is advanced only for gameplay decisions. `stepMatch` advances exactly one 120 Hz tick, irrespective of display refresh rate. The browser uses an accumulator, while an active server room may run two steps per 60 Hz scheduling interval and broadcast at 30 Hz.

## Physics and rules

The ball is a swept sphere. Each fixed step integrates gravity, drag and bounded Magnus acceleration, finds the earliest table, net, floor or active paddle contact, consumes the remaining time and resolves subsequent contacts. A finite tabletop test distinguishes a table bounce from a ball already outside the playing surface. Paddle contact depends on finite face size, actual ball arrival, a bounded swing window and assisted body position. Issuing a swing does not teleport the ball or guarantee a return.

The core first enforces two-bounce service order, then requires one receiver-side bounce before a return. It records a net touch separately so only an otherwise legal serve becomes a let. A point transitions through an inter-point pause, preserving the completed score on screen. Games require at least 11 points and a lead of 2; the match requires 2 games. Service order and end changes are independent of fixed player identity.

For a playable casual control scheme, a successful racket contact computes a ballistic trajectory toward the selected landing lane. Spin and air resistance act during flight; the game does not attempt a detailed elastic paddle/rubber contact solver or official serve-toss judging. AI produces ordinary inputs and uses the same collision path as a human.

## Network contract

The browser and server share the core types. The host owns the `tt.*` WebSocket envelope, authentication, membership, ready state, rate limits, 30-second reconnect grace and durable persistence. Clients send sequence-numbered actions; they never choose the score, ball state or winner. The host validates strictly increasing wire sequences for each connection, acknowledges them, and maps accepted actions to the core player's next sequence. A fresh connection therefore does not inherit stale wire sequence numbers from a previous socket. Server-side checkpoints are made at completed points; an interrupted unfinished rally may be replayed after reconnect.

Browser prediction is presentation assistance only. Snapshots correct it; authoritative results are saved by the host. Stopping the browser renderer does not pause an opponent's authoritative match. Disconnection behavior and room lifecycle belong to the host, not to the physics module.

## Verification boundaries

Core tests cover swept collisions, deterministic replay, spin, service order, lets, faults, score rotation, end changes, sustained rallies and all three AI tiers. Browser acceptance must additionally cover real input timing, shader/model loading, visible contact synchronization, repeated mounting and disposal, device orientation, and low-tier mobile performance. Cross-device play at 50/100/150 ms RTT must be checked before declaring production network acceptance.
