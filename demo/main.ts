import { mountTableTennis } from "../src/browser/index"
import type {
  Difficulty,
  Environment,
  GameMode,
  TableTennisLifecycle,
} from "../src/browser/types"

const launcher = document.querySelector<HTMLElement>("#launcher")!
const container = document.querySelector<HTMLElement>("#game")!
const form = document.querySelector<HTMLFormElement>("#setup")!
let game: TableTennisLifecycle | null = null
let launchId = 0

function leave() {
  launchId++
  game?.dispose()
  game = null
  container.replaceChildren()
  container.hidden = true
  launcher.hidden = false
  form.querySelector<HTMLButtonElement>("button")!.focus()
}

form.addEventListener("submit", async (event) => {
  event.preventDefault()
  const id = ++launchId
  const values = new FormData(form)
  launcher.hidden = true
  container.hidden = false
  const next = await mountTableTennis({
    container,
    mode: values.get("mode") as GameMode,
    difficulty: values.get("difficulty") as Difficulty,
    environment: values.get("environment") as Environment,
    assetBaseUrl: "/models/table-tennis/",
    session: { localPlayerId: "local-player", displayName: "你" },
    preferences: { quality: "balanced", masterVolume: 0.55 },
    onExit: leave,
  })
  if (id !== launchId) next.dispose()
  else game = next
})

window.addEventListener("pagehide", () => game?.dispose())
