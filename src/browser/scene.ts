import {
  ACESFilmicToneMapping,
  AnimationAction,
  AnimationMixer,
  Box3,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  LoopOnce,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Quaternion,
  Scene,
  Texture,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three"
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js"
import { clone as cloneRig } from "three/examples/jsm/utils/SkeletonUtils.js"
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js"
import type { MatchState, PlayerId } from "../core/types"
import type { Environment, TableTennisOptions } from "./types"

interface RobotView {
  root: Object3D
  mixer: AnimationMixer
  clips: Map<string, AnimationAction>
  current: AnimationAction | null
  lastSwing: number
  lastContact: number
  strokeTravel: number
  paddle: Object3D
  paddleCenter: Vector3
  shoulder: Object3D | undefined
  shoulderRest: Vector3
  elbow: Object3D | undefined
  hand: Object3D | undefined
  grip: Object3D
}

export class GameScene {
  readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new PerspectiveCamera(43, 1, 0.035, 100)
  private readonly loader = new GLTFLoader()
  private readonly abort = new AbortController()
  private readonly roots: Object3D[] = []
  private readonly assets = new Map<string, GLTF>()
  private readonly lightTarget = new Object3D()
  private robots: [RobotView, RobotView] | null = null
  private ball: Object3D | null = null
  private player: PlayerId = 0
  private cameraEnd = -1
  private disposed = false
  private readonly cameraLook = new Vector3(0, 0.87, -0.3)
  private readonly cameraGoal = new Vector3()
  private readonly ballGoal = new Vector3()
  private readonly quality: "low" | "balanced" | "high"
  private readonly reducedMotion: boolean
  private environmentTarget: WebGLRenderTarget | null = null

  constructor(canvas: HTMLCanvasElement, options: TableTennisOptions) {
    this.quality = options.preferences?.quality || "balanced"
    this.reducedMotion =
      options.preferences?.reducedMotion ??
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: this.quality !== "low",
      alpha: false,
      powerPreference: "high-performance",
    })
    this.renderer.setPixelRatio(
      Math.min(
        window.devicePixelRatio || 1,
        { high: 2, balanced: 1.5, low: 1 }[this.quality]
      )
    )
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.88
    this.renderer.shadowMap.enabled = this.quality !== "low"
    this.renderer.shadowMap.type = PCFSoftShadowMap
    const studio = new RoomEnvironment()
    const pmrem = new PMREMGenerator(this.renderer)
    this.environmentTarget = pmrem.fromScene(studio, 0.04)
    this.scene.environment = this.environmentTarget.texture
    studio.dispose()
    pmrem.dispose()
    this.scene.add(new HemisphereLight(0xc5eafa, 0x1c2930, 1.2))
    const key = new DirectionalLight(0xf2f5ff, 2.3)
    key.position.set(2.8, 6, 2)
    key.castShadow = this.quality !== "low"
    key.shadow.mapSize.setScalar(this.quality === "high" ? 2048 : 1024)
    key.shadow.camera.left = -4
    key.shadow.camera.right = 4
    key.shadow.camera.top = 4
    key.shadow.camera.bottom = -4
    key.shadow.camera.near = 0.1
    key.shadow.camera.far = 20
    key.shadow.normalBias = 0.025
    key.shadow.bias = -0.0005
    key.target = this.lightTarget
    this.lightTarget.position.set(0, 0.6, 0)
    this.scene.add(key, this.lightTarget)
    const rim = new DirectionalLight(0x80deed, 1.6)
    rim.position.set(-3, 3, -4)
    this.scene.add(rim)
    this.camera.position.set(0, 2.2, 3.65)
    this.camera.lookAt(this.cameraLook)
  }

  async load(baseUrl: string, environment: Environment) {
    const base = new URL(
      baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
      window.location.href
    )
    const manifestResponse = await fetch(new URL("manifest.json", base), {
      signal: this.abort.signal,
      cache: "no-cache",
    })
    if (!manifestResponse.ok)
      throw new Error("球场资源目录暂时不可用，请稍后重试。")
    const manifest = await manifestResponse.json()
    if (
      typeof manifest.version !== "string" ||
      !/^[a-f0-9]{16}$/.test(manifest.version)
    )
      throw new Error("球场资源版本无效，请重新部署模型。")
    const versionBase = new URL(`${manifest.version}/`, base)
    const names = [environment, "table-tennis-equipment", "robot-player"]
    const results = await Promise.allSettled(
      names.map(async (name) => {
        if (manifest.models?.[name] !== `${name}.glb`)
          throw new Error(`资源目录缺少模型 ${name}`)
        const url = new URL(manifest.models[name], versionBase).href
        const response = await fetch(url, { signal: this.abort.signal })
        if (!response.ok)
          throw new Error(`模型 ${name} 加载失败（HTTP ${response.status}）`)
        const bytes = await response.arrayBuffer()
        if (
          bytes.byteLength < 12 ||
          new DataView(bytes).getUint32(0, true) !== 0x46546c67
        )
          throw new Error(`模型 ${name} 尚未正确部署，请稍后重试。`)
        const gltf = await this.loader.parseAsync(bytes, versionBase.href)
        // Parsing may finish after an exit or retry has already disposed this view.
        if (this.disposed) disposeObjectResources([gltf.scene])
        else {
          this.assets.set(name, gltf)
          this.roots.push(gltf.scene)
        }
        return gltf
      })
    )
    if (this.disposed) return
    const failed = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    )
    if (failed) throw failed.reason
    const equipment = this.assets.get("table-tennis-equipment")!.scene
    const env = this.assets.get(environment)!.scene
    const robot = this.assets.get("robot-player")!
    for (const name of ["Table", "Net", "Ball", "Paddle"])
      if (!equipment.getObjectByName(name))
        throw new Error(`器材模型缺少 ${name} 节点`)
    if (!robot.scene.getObjectByName("GripR"))
      throw new Error("球员模型缺少握拍节点 GripR")
    const originalBall = equipment.getObjectByName("Ball")!
    const originalPaddle = equipment.getObjectByName("Paddle")!
    this.ball = originalBall.clone(true)
    this.ball.visible = true
    originalBall.visible = false
    originalPaddle.visible = false
    this.scene.add(equipment, env, this.ball)
    this.roots.push(this.ball)
    this.robots = [
      this.createRobot(robot, originalPaddle, 0),
      this.createRobot(robot, originalPaddle, 1),
    ]
    this.scene.background = new Color(
      environment === "cyber-arena" ? 0x07141d : 0x8ba3ae
    )
    this.scene.fog = new Fog(
      environment === "cyber-arena" ? 0x07141d : 0x9aadb3,
      14,
      40
    )
    this.scene.traverse((node) => {
      if (!(node instanceof Mesh)) return
      node.castShadow = true
      node.receiveShadow = true
      if (
        node.material instanceof MeshStandardMaterial &&
        node.material.metalness > 0.6
      )
        node.material.envMapIntensity = 1.3
    })
  }

  private createRobot(
    asset: GLTF,
    paddleSource: Object3D,
    identity: PlayerId
  ): RobotView {
    const root = cloneRig(asset.scene)
    root.name = `Player${identity}`
    root.traverse((node) => {
      if (!(node instanceof Mesh)) return
      const source = Array.isArray(node.material)
        ? node.material
        : [node.material]
      const materials = source.map((material) => {
        const copy = material.clone()
        if (
          copy instanceof MeshStandardMaterial &&
          copy.emissive.getHex() !== 0
        )
          copy.emissive.setHex(identity === 0 ? 0x42cce8 : 0xff963e)
        return copy
      })
      node.material = Array.isArray(node.material) ? materials : materials[0]
    })
    const paddle = paddleSource.clone(true)
    paddle.visible = true
    paddle.position.set(0, 0, 0)
    // The grip's bone axis points toward the fingertips; the blade points back up.
    paddle.rotation.set(0, 0, Math.PI)
    const grip = root.getObjectByName("GripR")!
    grip.add(paddle)
    root.updateMatrixWorld(true)
    const contact = paddle.getObjectByName("PaddleContact")
    const paddleCenter = paddle.worldToLocal(
      contact
        ? contact.getWorldPosition(new Vector3())
        : new Box3().setFromObject(paddle).getCenter(new Vector3())
    )
    const mixer = new AnimationMixer(root)
    const clips = new Map(
      asset.animations.map((clip) => [clip.name, mixer.clipAction(clip)])
    )
    const robot: RobotView = {
      root,
      mixer,
      clips,
      current: null,
      lastSwing: -1,
      lastContact: -1,
      strokeTravel: 0,
      paddle,
      paddleCenter,
      shoulder: root.getObjectByName("UpperArmR_joint"),
      shoulderRest:
        root.getObjectByName("UpperArmR_joint")?.position.clone() ||
        new Vector3(),
      elbow: root.getObjectByName("ForearmR_joint"),
      hand: root.getObjectByName("HandR_joint"),
      grip,
    }
    this.play(robot, "Ready", false)
    this.scene.add(root)
    this.roots.push(root)
    return robot
  }

  private play(robot: RobotView, clip: string, once: boolean) {
    const next =
      robot.clips.get(clip) ||
      robot.clips.get("Ready") ||
      robot.clips.get("Idle")
    if (!next || (robot.current === next && !once)) return
    next.reset()
    if (once) {
      next.setLoop(LoopOnce, 1)
      next.clampWhenFinished = true
      next.setDuration(0.3)
    } else {
      next.setEffectiveTimeScale(1)
    }
    next.enabled = true
    next.setEffectiveWeight(1)
    next.play()
    if (robot.current && robot.current !== next)
      robot.current.crossFadeTo(next, 0.08, false)
    robot.current = next
  }

  resize(width: number, height: number) {
    if (!width || !height || this.disposed) return
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    const landscapeFov = height < 450 ? 58 : 56
    this.camera.fov = width < height ? 52 : landscapeFov
    this.camera.updateProjectionMatrix()
  }

  setPlayer(player: PlayerId) {
    if (this.player === player && this.robots?.[player].root.userData.nearSide)
      return
    this.player = player
    this.robots?.forEach((robot, identity) => {
      robot.root.userData.nearSide = identity === player
      robot.root.traverse((node) => {
        if (!(node instanceof Mesh)) return
        if (identity !== player) {
          node.visible = true
          return
        }
        let branch: Object3D | null = node
        let isArm = false
        while (branch && branch !== robot.root) {
          if (/ForearmR|HandR|GripR|Paddle/i.test(branch.name)) isArm = true
          branch = branch.parent
        }
        node.visible = isArm && !/^ForearmR_(bearing|pivot)$/.test(node.name)
      })
    })
  }

  update(state: MatchState, seconds: number, snap = false) {
    if (!this.ball || !this.robots || this.disposed) return
    this.setPlayer(this.player)
    const end = state.ends[this.player]
    const orient = -end
    const cameraChangedEnd = this.cameraEnd !== end
    this.cameraEnd = end
    const tall = this.camera.aspect < 1
    const x = state.players[this.player].position.x
    this.cameraGoal.set(
      x * 0.18,
      tall ? 2.6 : 1.65,
      (tall ? 4.25 : 2.3) * orient
    )
    const blend =
      snap || cameraChangedEnd || this.reducedMotion
        ? 1
        : 1 - Math.exp(-seconds * 3.5)
    this.camera.position.lerp(this.cameraGoal, blend)
    this.cameraLook.set(x * 0.1, 0.85, -0.25 * orient)
    this.camera.lookAt(this.cameraLook)
    this.ballGoal.set(
      state.ball.position.x,
      state.ball.position.z,
      -state.ball.position.y
    )
    // Core advances at 120 Hz. Smoothing every moving-ball pose adds a visible
    // delay to actual paddle contact, so render the predicted physical position.
    this.ball.position.copy(this.ballGoal)
    this.ball.visible = state.phase !== "finished"
    this.ball.rotateX(state.ball.spin.x * seconds)
    this.ball.rotateZ(-state.ball.spin.y * seconds)
    this.robots.forEach((robot, identity) => {
      const data = state.players[identity]
      const oldX = robot.root.position.x
      // A forehand stance places the racket shoulder on the contact lane.
      const target = new Vector3(
        data.position.x + state.ends[identity] * 0.2,
        0,
        -data.position.y + state.ends[identity] * 0.22
      )
      robot.root.position.lerp(target, snap ? 1 : 1 - Math.exp(-seconds * 18))
      // Exported avatars face +Z; the near player faces the table (-Z).
      robot.root.rotation.y = state.ends[identity] === -1 ? Math.PI : 0
      if (data.paddle.swingAt > robot.lastSwing) {
        robot.lastSwing = data.paddle.swingAt
        let stroke = data.paddle.stroke.aimX < -0.15 ? "Backhand" : "Forehand"
        if (
          state.rallyHits === 1 &&
          data.paddle.contactAt === data.paddle.swingAt
        )
          stroke = "Serve"
        this.play(robot, stroke, true)
      } else if (
        state.tick >
        Math.max(data.paddle.activeUntil + 5, data.paddle.swingAt + 36)
      ) {
        const direction = oldX < data.position.x ? "StepRight" : "StepLeft"
        this.play(
          robot,
          Math.abs(oldX - data.position.x) > 0.035 ? direction : "Ready",
          false
        )
      }
      // Contact is dictated by the same authoritative core as ball physics.
      if (data.paddle.contactAt > robot.lastContact)
        robot.lastContact = data.paddle.contactAt
      robot.mixer.update(Math.min(0.05, seconds))
      this.placePaddle(
        robot,
        new Vector3(
          data.paddle.position.x,
          data.paddle.position.z,
          -data.paddle.position.y +
            state.ends[identity] *
              this.strokeTravel(robot, state, identity as PlayerId, seconds)
        )
      )
    })
  }

  private strokeTravel(
    robot: RobotView,
    state: MatchState,
    identity: PlayerId,
    seconds: number
  ) {
    const paddle = state.players[identity].paddle
    const sinceContact = (state.tick - paddle.contactAt) / 120
    let desired = 0
    if (paddle.contactAt >= 0 && sinceContact < 0.3) {
      desired = 0.12 * Math.sin((Math.PI * sinceContact) / 0.3)
    } else if (state.phase === "rally" && state.tick <= paddle.activeUntil) {
      const time =
        (paddle.position.y - state.ball.position.y) / state.ball.velocity.y
      if (time > 0)
        desired = -0.1 * Math.min(1, Math.max(0, (time - 0.035) / 0.18))
    }
    // The contact frame must stay exactly on the physical paddle plane. Before
    // and after it, the held racket can draw back and follow through naturally.
    if (paddle.contactAt >= 0 && sinceContact <= 2 / 120) robot.strokeTravel = 0
    else
      robot.strokeTravel +=
        (desired - robot.strokeTravel) * (1 - Math.exp(-seconds * 45))
    return robot.strokeTravel
  }

  /** Keep the held paddle on its collision pose; never animate a separate free paddle. */
  private placePaddle(robot: RobotView, contact: Vector3) {
    const shoulder = robot.shoulder
    const elbow = robot.elbow
    const handJoint = robot.hand
    if (!shoulder || !elbow || !handJoint) return
    shoulder.position.copy(robot.shoulderRest)
    robot.root.updateMatrixWorld(true)
    const paddleRotation = new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      robot.root.rotation.y
    )
    // On a low return the racket head drops below the wrist. Keeping the blade
    // upright at every height forces the hand below the rig's reachable span.
    const lowReturn = Math.max(0, Math.min(1, (1.15 - contact.y) / 0.3))
    paddleRotation.multiply(
      new Quaternion().setFromAxisAngle(
        new Vector3(0, 0, 1),
        lowReturn * Math.PI * 0.75
      )
    )
    const paddleScale = robot.paddle.getWorldScale(new Vector3())
    const paddleOrigin = contact
      .clone()
      .sub(
        robot.paddleCenter
          .clone()
          .multiply(paddleScale)
          .applyQuaternion(paddleRotation)
      )
    const handToPaddle = new Matrix4()
      .copy(handJoint.matrixWorld)
      .invert()
      .multiply(robot.paddle.matrixWorld)
    const targetHand = new Matrix4()
      .compose(paddleOrigin, paddleRotation, paddleScale)
      .multiply(handToPaddle.invert())
    const target = new Vector3()
    const handRotation = new Quaternion()
    targetHand.decompose(target, handRotation, new Vector3())
    if (robot.root.userData.nearSide && shoulder.parent) {
      // The first-person arm enters from below the viewport while its grip and
      // blade retain their world contact pose. The opponent keeps the authored
      // shoulder position and complete body animation.
      const side = -Math.cos(robot.root.rotation.y)
      const viewShoulder = target
        .clone()
        .add(new Vector3(side * 0.15, -0.1, side * 0.38))
      shoulder.position.copy(shoulder.parent.worldToLocal(viewShoulder))
      robot.root.updateMatrixWorld(true)
    }
    const s = shoulder.getWorldPosition(new Vector3())
    const e = elbow.getWorldPosition(new Vector3())
    const hand = handJoint.getWorldPosition(new Vector3())
    const upperLength = s.distanceTo(e)
    const lowerLength = e.distanceTo(hand)
    if (upperLength < 0.01 || lowerLength < 0.01) return
    const direction = target.clone().sub(s)
    const distance = Math.max(
      Math.abs(upperLength - lowerLength) + 0.005,
      Math.min(direction.length(), upperLength + lowerLength - 0.005)
    )
    direction.normalize()
    const outward = -Math.cos(robot.root.rotation.y)
    const bend = new Vector3(outward, -0.25, outward * 0.55)
    bend.addScaledVector(direction, -bend.dot(direction))
    if (bend.lengthSq() < 0.00001)
      bend.crossVectors(direction, new Vector3(0, 1, 0))
    bend.normalize()
    const along =
      (upperLength * upperLength -
        lowerLength * lowerLength +
        distance * distance) /
      (2 * distance)
    const across = Math.sqrt(
      Math.max(0, upperLength * upperLength - along * along)
    )
    const desiredElbow = s
      .clone()
      .addScaledVector(direction, along)
      .addScaledVector(bend, across)
    const desiredHand = s.clone().addScaledVector(direction, distance)
    this.rotateWorld(shoulder, e.clone().sub(s), desiredElbow.clone().sub(s))
    robot.root.updateMatrixWorld(true)
    const nextElbow = elbow.getWorldPosition(new Vector3())
    const nextHand = handJoint.getWorldPosition(new Vector3())
    this.rotateWorld(elbow, nextHand.sub(nextElbow), desiredHand.sub(nextElbow))
    const parentRotation =
      handJoint.parent?.getWorldQuaternion(new Quaternion()) || new Quaternion()
    handJoint.quaternion.copy(parentRotation.invert().multiply(handRotation))
    robot.root.updateMatrixWorld(true)
  }

  private rotateWorld(joint: Object3D, from: Vector3, to: Vector3) {
    if (from.lengthSq() < 0.000001 || to.lengthSq() < 0.000001) return
    const delta = new Quaternion().setFromUnitVectors(
      from.normalize(),
      to.normalize()
    )
    const rotation = joint
      .getWorldQuaternion(new Quaternion())
      .premultiply(delta)
    const parent =
      joint.parent?.getWorldQuaternion(new Quaternion()) || new Quaternion()
    joint.quaternion.copy(parent.invert().multiply(rotation))
  }

  render() {
    if (!this.disposed) this.renderer.render(this.scene, this.camera)
  }

  dispose(releaseContext = true) {
    if (this.disposed) {
      if (releaseContext) this.renderer.forceContextLoss()
      return
    }
    this.disposed = true
    this.abort.abort()
    this.robots?.forEach((robot) => {
      robot.mixer.stopAllAction()
      robot.mixer.uncacheRoot(robot.root)
    })
    disposeObjectResources(this.roots)
    this.environmentTarget?.dispose()
    this.assets.clear()
    this.roots.length = 0
    this.robots = null
    this.ball = null
    this.scene.clear()
    this.renderer.dispose()
    if (releaseContext) this.renderer.forceContextLoss()
  }
}

function disposeObjectResources(roots: Object3D[]) {
  const geometries = new Set<{ dispose(): void }>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  roots.forEach((root) =>
    root.traverse((node) => {
      if (!(node instanceof Mesh)) return
      geometries.add(node.geometry)
      const nodeMaterials = Array.isArray(node.material)
        ? node.material
        : [node.material]
      nodeMaterials.forEach((material) => {
        materials.add(material)
        for (const value of Object.values(material))
          if (value instanceof Texture) textures.add(value)
      })
    })
  )
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => material.dispose())
  const images = new Set<{ close?: () => void }>()
  textures.forEach((texture) => {
    texture.dispose()
    if (texture.source?.data) images.add(texture.source.data)
  })
  images.forEach((image) => {
    if (typeof image.close === "function") image.close()
  })
}
