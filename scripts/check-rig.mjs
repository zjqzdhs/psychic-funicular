import fs from "node:fs/promises"
import process from "node:process"
import console from "node:console"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"
import { Quaternion, Scene, Vector3 } from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"

// Inspect the exported skeleton and the actual browser IK without a GPU. Only
// texture images are omitted; mesh transforms, skin weights and clips stay intact.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const server = await createServer({
  root,
  configFile: false,
  server: { middlewareMode: true }
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
    model("table-tennis-equipment")
  ])
  const view = Object.create(GameScene.prototype)
  view.scene = new Scene()
  view.roots = []
  const state = createMatch()
  const results = []
  const palms = []
  const joints = []
  for (const identity of [0, 1]) {
    const robot = view.createRobot(
      asset,
      equipment.scene.getObjectByName("Paddle"),
      identity
    )
    const data = state.players[identity]
    const end = state.ends[identity]
    robot.root.position.set(data.position.x + end * 0.1, 0, -data.position.y)
    robot.root.rotation.y = end === -1 ? Math.PI : 0
    for (const clip of ["Ready", "Serve", "Forehand", "Backhand"]) {
      view.play(robot, clip, clip !== "Ready")
      for (const time of [0.05, 0.15, 0.28]) {
        view.restorePose(robot)
        robot.mixer.setTime(time)
        view.capturePose(robot)
        for (const height of [0.86, 1.05, 1.4, 1.75]) {
          const desired = new Vector3(
            data.paddle.position.x,
            height,
            -data.paddle.position.y
          )
          for (const firstPerson of [false, true]) {
            robot.root.userData.nearSide = firstPerson
            view.restorePose(robot)
            robot.root.updateMatrixWorld(true)
            const attachedShoulder = robot.shoulder.getWorldPosition(
              new Vector3()
            )
            const desiredNormal = new Vector3(
              time - 0.15,
              (height - 1.05) * 0.35,
              end
            ).normalize()
            view.placePaddle(robot, desired, desiredNormal)
            const actual = robot.paddle.localToWorld(robot.paddleCenter.clone())
            const shoulder = robot.shoulder.getWorldPosition(new Vector3())
            const elbow = robot.elbow.getWorldPosition(new Vector3())
            const hand = robot.hand.getWorldPosition(new Vector3())
            const forearm = hand.clone().sub(elbow).normalize()
            const handAxis = new Vector3(0, 1, 0).applyQuaternion(
              robot.hand.getWorldQuaternion(new Quaternion())
            )
            joints.push({
              identity,
              firstPerson,
              clip,
              time,
              height,
              shoulderDriftMm: shoulder.distanceTo(attachedShoulder) * 1000,
              elbowDegrees:
                (shoulder.clone().sub(elbow).angleTo(forearm) * 180) / Math.PI,
              wristBendDegrees: (forearm.angleTo(handAxis) * 180) / Math.PI,
              normalErrorDegrees:
                (new Vector3(0, 0, 1)
                  .applyQuaternion(
                    robot.paddle.getWorldQuaternion(new Quaternion())
                  )
                  .angleTo(desiredNormal) *
                  180) /
                Math.PI
            })
            results.push({
              identity,
              firstPerson,
              clip,
              time,
              height,
              errorMm: Math.round(actual.distanceTo(desired) * 10000) / 10
            })
          }
        }
      }
    }
    const serve = createMatch({ firstServer: identity })
    view.restorePose(robot)
    view.play(robot, "ServeHold", false)
    robot.mixer.setTime(0.1)
    view.capturePose(robot)
    view.placeServingHand(robot, serve)
    const palm = robot.palm.getWorldPosition(new Vector3())
    const target = new Vector3(
      serve.serveMotion.hand.x,
      serve.serveMotion.hand.z,
      -serve.serveMotion.hand.y
    )
    palms.push({
      identity,
      errorMm: Math.round(palm.distanceTo(target) * 10000) / 10,
      wristBendDegrees:
        (robot.leftHand
          .getWorldPosition(new Vector3())
          .sub(robot.leftElbow.getWorldPosition(new Vector3()))
          .angleTo(
            new Vector3(0, 1, 0).applyQuaternion(
              robot.leftHand.getWorldQuaternion(new Quaternion())
            )
          ) *
          180) /
        Math.PI,
      fingersPointTowardTable:
        new Vector3(0, 1, 0).applyQuaternion(
          robot.leftHand.getWorldQuaternion(new Quaternion())
        ).z *
          end >
        0
    })
  }
  const worst = results.toSorted((a, b) => b.errorMm - a.errorMm)
  console.log(
    JSON.stringify(
      {
        samples: results.length,
        maximumErrorMm: worst[0].errorMm,
        jointExtremes: {
          maximumShoulderDriftMm: Math.max(
            ...joints.map((joint) => joint.shoulderDriftMm)
          ),
          minimumElbowDegrees: Math.min(
            ...joints.map((joint) => joint.elbowDegrees)
          ),
          maximumElbowDegrees: Math.max(
            ...joints.map((joint) => joint.elbowDegrees)
          ),
          maximumWristBendDegrees: Math.max(
            ...joints.map((joint) => joint.wristBendDegrees)
          ),
          maximumFaceNormalErrorDegrees: Math.max(
            ...joints.map((joint) => joint.normalErrorDegrees)
          ),
          worstWrists: joints
            .toSorted((a, b) => b.wristBendDegrees - a.wristBendDegrees)
            .slice(0, 4)
        },
        palms,
        worst: worst.slice(0, 12)
      },
      null,
      2
    )
  )
  if (
    worst[0].errorMm > 15 ||
    palms.some(
      (palm) =>
        palm.errorMm > 15 ||
        palm.wristBendDegrees > 70 ||
        !palm.fingersPointTowardTable
    ) ||
    joints.some(
      (joint) =>
        joint.shoulderDriftMm > 0.1 ||
        joint.wristBendDegrees > 70 ||
        joint.elbowDegrees < 25 ||
        joint.elbowDegrees > 165 ||
        joint.normalErrorDegrees > 0.1
    )
  )
    process.exitCode = 1
} finally {
  await server.close()
}
