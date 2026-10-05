import fs from "node:fs/promises"
import process from "node:process"
import console from "node:console"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"
import { Scene, Vector3 } from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"

// Inspect the exported skeleton and the actual browser IK without a GPU. Only
// texture images are omitted; mesh transforms, skin weights and clips stay intact.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const server = await createServer({
  root,
  configFile: false,
  server: { middlewareMode: true },
})

async function model(name) {
  const bytes = await fs.readFile(
    path.join(root, "assets/models", `${name}.glb`)
  )
  const jsonLength = bytes.readUInt32LE(12)
  const data = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength))
  const binaryOffset = 28 + jsonLength
  data.buffers[0].uri = `data:application/octet-stream;base64,${bytes.subarray(binaryOffset).toString("base64")}`
  data.images = []
  data.textures = []
  data.samplers = []
  data.materials = (data.materials || []).map(({ name }) => ({ name }))
  return new GLTFLoader().parseAsync(JSON.stringify(data), "")
}

// FileLoader uses ProgressEvent for the embedded geometry buffer on Node.
globalThis.ProgressEvent ??= class ProgressEvent extends globalThis.Event {
  constructor(type, properties) {
    super(type)
    Object.assign(this, properties)
  }
}

try {
  const { GameScene } = await server.ssrLoadModule("/src/browser/scene.ts")
  const { createMatch } = await server.ssrLoadModule("/src/core/index.ts")
  const [asset, equipment] = await Promise.all([
    model("robot-player"),
    model("table-tennis-equipment"),
  ])
  const view = Object.create(GameScene.prototype)
  view.scene = new Scene()
  view.roots = []
  const state = createMatch()
  const results = []
  for (const identity of [0, 1]) {
    const robot = view.createRobot(
      asset,
      equipment.scene.getObjectByName("Paddle"),
      identity
    )
    const data = state.players[identity]
    const end = state.ends[identity]
    robot.root.position.set(
      data.position.x + end * 0.2,
      0,
      -data.position.y + end * 0.22
    )
    robot.root.rotation.y = end === -1 ? Math.PI : 0
    for (const clip of ["Ready", "Serve", "Forehand", "Backhand"]) {
      view.play(robot, clip, clip !== "Ready")
      for (const time of [0.05, 0.15, 0.28]) {
        robot.mixer.setTime(time)
        for (const height of [0.86, 1.05, 1.4, 1.75]) {
          const desired = new Vector3(
            data.paddle.position.x,
            height,
            -data.paddle.position.y
          )
          for (const firstPerson of [false, true]) {
            robot.root.userData.nearSide = firstPerson
            view.placePaddle(robot, desired)
            const actual = robot.paddle.localToWorld(robot.paddleCenter.clone())
            results.push({
              identity,
              firstPerson,
              clip,
              time,
              height,
              errorMm: Math.round(actual.distanceTo(desired) * 10000) / 10,
            })
          }
        }
      }
    }
  }
  const worst = results.toSorted((a, b) => b.errorMm - a.errorMm)
  console.log(
    JSON.stringify(
      {
        samples: results.length,
        maximumErrorMm: worst[0].errorMm,
        worst: worst.slice(0, 12),
      },
      null,
      2
    )
  )
  if (worst[0].errorMm > 15) process.exitCode = 1
} finally {
  await server.close()
}
