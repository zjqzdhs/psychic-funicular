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
  PCFShadowMap,
  Object3D,
  PerspectiveCamera,
  PMREMGenerator,
  Quaternion,
  Scene,
  Texture,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget
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
  currentName: string
  lastSwing: number
  paddle: Object3D
  paddleCenter: Vector3
  shoulder: Object3D | undefined
  elbow: Object3D | undefined
  hand: Object3D | undefined
  grip: Object3D
  palm: Object3D | undefined
  leftShoulder: Object3D | undefined
  leftElbow: Object3D | undefined
  leftHand: Object3D | undefined
  authoredPose: { joint: Object3D; position: Vector3; rotation: Quaternion }[]
  bladeUp: Vector3
  lastBladeUp: Vector3 | null
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
  private readonly spinAxis = new Vector3()
  private readonly quality: "low" | "balanced" | "high"
  private readonly reducedMotion: boolean
  private environmentTarget: WebGLRenderTarget | null = null
  private cameraStride = 0
  private lastPlayerX = 0
  private cameraBob = 0

  constructor(canvas: HTMLCanvasElement, options: TableTennisOptions) {
    this.quality = options.preferences?.quality || "balanced"
    this.reducedMotion =
      options.preferences?.reducedMotion ??
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: this.quality !== "low",
      alpha: false,
      powerPreference: "high-performance"
    })
    this.renderer.setPixelRatio(
      Math.min(
        window.devicePixelRatio || 1,
        { high: 2, balanced: 1.5, low: 1 }[this.quality]
      )
    )
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.02
    this.renderer.shadowMap.enabled = this.quality !== "low"
    this.renderer.shadowMap.type = PCFShadowMap
    const studio = new RoomEnvironment()
    const pmrem = new PMREMGenerator(this.renderer)
    this.environmentTarget = pmrem.fromScene(studio, 0.04)
    this.scene.environment = this.environmentTarget.texture
    studio.dispose()
    pmrem.dispose()
    this.scene.add(new HemisphereLight(0xe6f5ff, 0x3a4550, 1.5))
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
    // The ball radius is only 20 mm: a 25 mm normal bias erased its own
    // shading. Keep bias below the visible contact scale.
    key.shadow.normalBias = 0.002
    key.shadow.bias = -0.00008
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
      cache: "no-cache"
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
      this.createRobot(robot, originalPaddle, 1)
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
    this.ball.traverse((node) => {
      if (!(node instanceof Mesh)) return
      // Preserve the authored sphere, print and normals; give its matte shell
      // a readable highlight without making it a self-lit flat white disc.
      node.receiveShadow = false
      const materials = Array.isArray(node.material)
        ? node.material
        : [node.material]
      const copies = materials.map((material) => {
        const copy = material.clone()
        if (copy instanceof MeshStandardMaterial) {
          copy.envMapIntensity = 0.6
        }
        return copy
      })
      node.material = Array.isArray(node.material) ? copies : copies[0]
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
    // GripR is authored as the complete grip transform in Blender. No extra
    // runtime flip may invert the handle inside the palm.
    paddle.rotation.set(0, 0, 0)
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
      currentName: "",
      lastSwing: -1,
      paddle,
      paddleCenter,
      shoulder: root.getObjectByName("UpperArmR_joint"),
      elbow: root.getObjectByName("ForearmR_joint"),
      hand: root.getObjectByName("HandR_joint"),
      grip,
      palm: root.getObjectByName("PalmL"),
      leftShoulder: root.getObjectByName("UpperArmL_joint"),
      leftElbow: root.getObjectByName("ForearmL_joint"),
      leftHand: root.getObjectByName("HandL_joint"),
      authoredPose: [],
      bladeUp: new Vector3(0, 1, 0),
      lastBladeUp: null
    }
    this.play(robot, "Ready", false)
    mixer.update(0)
    this.capturePose(robot)
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
    robot.currentName = clip
  }

  resize(width: number, height: number) {
    if (!width || !height || this.disposed) return
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    // An eye-level camera needs peripheral vision to retain the near table
    // edge. Backing the camera behind the shoulders exposed cut-off upper arms.
    this.camera.fov = width < height ? 106 : 86
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
          if (
            /UpperArm[RL]|Forearm[RL]|Hand[RL]|GripR|Paddle/i.test(branch.name)
          )
            isArm = true
          branch = branch.parent
        }
        node.visible = isArm
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
    const displacement = snap ? 0 : x - this.lastPlayerX
    this.lastPlayerX = x
    this.cameraStride += Math.abs(displacement) * 9
    const paddle = state.players[this.player].paddle
    const contactSoon =
      Math.abs(
        (paddle.position.y - state.ball.position.y) / state.ball.velocity.y
      ) < 0.22
    const steady =
      contactSoon ||
      state.tick - paddle.contactAt < 24 ||
      state.phase === "serve" ||
      this.reducedMotion
    const moving = Math.min(
      1,
      Math.abs(displacement) / Math.max(0.001, seconds) / 1.5
    )
    const desiredBob = steady ? 0 : Math.sin(this.cameraStride) * 0.009 * moving
    this.cameraBob +=
      (desiredBob - this.cameraBob) * (1 - Math.exp(-seconds * 18))
    const followSpeed = steady ? 4 : 6
    const blend =
      snap || cameraChangedEnd ? 1 : 1 - Math.exp(-seconds * followSpeed)
    this.ballGoal.set(
      state.ball.position.x,
      state.ball.position.z,
      -state.ball.position.y
    )
    // Core advances at 120 Hz. Smoothing every moving-ball pose adds a visible
    // delay to actual paddle contact, so render the predicted physical position.
    this.ball.position.copy(this.ballGoal)
    this.ball.visible = state.phase !== "finished"
    this.spinAxis.set(state.ball.spin.x, state.ball.spin.z, -state.ball.spin.y)
    const angularSpeed = this.spinAxis.length()
    if (angularSpeed > 0.001)
      this.ball.rotateOnWorldAxis(
        this.spinAxis.multiplyScalar(1 / angularSpeed),
        angularSpeed * seconds
      )
    this.robots.forEach((robot, identity) => {
      const data = state.players[identity]
      const oldX = robot.root.position.x
      // Place the complete athlete behind its contact plane. The shoulders
      // remain attached to this body in both first- and third-person views.
      const target = new Vector3(
        data.position.x + state.ends[identity] * 0.1,
        0,
        -data.position.y
      )
      robot.root.position.lerp(target, snap ? 1 : 1 - Math.exp(-seconds * 18))
      // Exported avatars face +Z; the near player faces the table (-Z).
      robot.root.rotation.y = state.ends[identity] === -1 ? Math.PI : 0
      const serving = identity === state.server && state.phase === "serve"
      this.updateRobotAnimation(
        robot,
        state,
        identity as PlayerId,
        target.x - oldX
      )
      this.restorePose(robot)
      robot.mixer.update(Math.min(0.05, seconds))
      this.capturePose(robot)
      this.placePaddle(
        robot,
        new Vector3(
          data.paddle.position.x,
          data.paddle.position.z,
          -data.paddle.position.y
        ),
        new Vector3(
          data.paddle.normal.x,
          data.paddle.normal.z,
          -data.paddle.normal.y
        )
      )
      if (serving) this.placeServingHand(robot, state)
    })
    const own = this.robots[this.player]
    const head = own.root.getObjectByName("Head_joint")
    if (head) {
      // This is the actual visor point in the exported head coordinate frame,
      // slightly ahead of the face; shoulders/torso are physically behind it.
      this.cameraGoal.set(0, 0.16, 0.09)
      head.localToWorld(this.cameraGoal)
      this.cameraGoal.y += this.cameraBob
    } else {
      this.cameraGoal.set(x, 1.6, 1.94 * orient)
    }
    this.camera.position.lerp(this.cameraGoal, blend)
    this.cameraLook.set(
      this.camera.position.x * 0.4,
      tall ? 0.7 : 0.8,
      0.55 * orient
    )
    this.camera.lookAt(this.cameraLook)
  }

  private updateRobotAnimation(
    robot: RobotView,
    state: MatchState,
    identity: PlayerId,
    lateralMotion: number
  ) {
    const paddle = state.players[identity].paddle
    robot.lastSwing = Math.min(robot.lastSwing, paddle.swingAt)
    const serving = identity === state.server && state.phase === "serve"
    if (serving && state.serveMotion.stage === "held") {
      this.play(robot, "ServeHold", false)
      return
    }
    if (serving && state.serveMotion.stage === "toss") {
      if (robot.currentName !== "ServeToss") this.play(robot, "ServeToss", true)
      return
    }
    if (paddle.swingAt > robot.lastSwing) {
      robot.lastSwing = paddle.swingAt
      let stroke = paddle.hand === "backhand" ? "Backhand" : "Forehand"
      if (serving) stroke = "Serve"
      this.play(robot, stroke, true)
      return
    }
    if (state.tick <= Math.max(paddle.activeUntil + 5, paddle.swingAt + 36))
      return
    const direction = lateralMotion > 0 ? "StepRight" : "StepLeft"
    this.play(
      robot,
      Math.abs(lateralMotion) > 0.035 ? direction : "Ready",
      false
    )
  }

  /** Keep the held paddle on its collision pose; never animate a separate free paddle. */
  private placePaddle(robot: RobotView, contact: Vector3, normal: Vector3) {
    const shoulder = robot.shoulder
    const elbow = robot.elbow
    const handJoint = robot.hand
    if (!shoulder || !elbow || !handJoint) return
    this.restorePose(robot)
    robot.root.updateMatrixWorld(true)
    normal.normalize()
    // Preserve the authored wrist roll/forehand-backhand silhouette, project
    // its blade axis onto the physical face, then solve the arm to that pose.
    const blade = robot.bladeUp.clone()
    // Low returns turn the blade out beside the forearm, rather than keeping
    // its head above the wrist and forcing a straight arm through the table.
    // This roll leaves the physical face normal and grip attachment unchanged.
    const low = Math.max(0, Math.min(1, (1.22 - contact.y) / 0.28))
    const strokeSide = robot.currentName === "Backhand" ? -1 : 1
    const side = Math.cos(robot.root.rotation.y) * strokeSide
    blade.lerp(
      new Vector3(side, -0.4, 0).normalize(),
      low * low * (3 - 2 * low)
    )
    blade.addScaledVector(normal, -blade.dot(normal))
    if (blade.lengthSq() < 0.001)
      blade.set(0, 1, 0).addScaledVector(normal, -normal.y)
    blade.normalize()
    const paddleScale = robot.paddle.getWorldScale(new Vector3())
    const handToPaddle = new Matrix4()
      .copy(handJoint.matrixWorld)
      .invert()
      .multiply(robot.paddle.matrixWorld)
    handToPaddle.invert()
    const s = shoulder.getWorldPosition(new Vector3())
    const e = elbow.getWorldPosition(new Vector3())
    const h = handJoint.getWorldPosition(new Vector3())
    let best:
      | { target: Vector3; rotation: Quaternion; blade: Vector3; score: number }
      | undefined
    // The physics face normal and contact stay authoritative, but roll about
    // that normal is free. Use it to keep the wrist within its bend range;
    // never translate shoulder roots to make an impossible hand pose fit.
    const candidates = [blade]
    if (robot.lastBladeUp) {
      const previous = robot.lastBladeUp.clone()
      previous.addScaledVector(normal, -previous.dot(normal))
      if (previous.lengthSq() > 0.001) candidates.push(previous.normalize())
    }
    for (let step = 1; step < 24; step++)
      candidates.push(
        blade.clone().applyAxisAngle(normal, (step * Math.PI) / 12)
      )
    for (const candidate of candidates) {
      const across = new Vector3().crossVectors(candidate, normal).normalize()
      const paddleRotation = new Quaternion().setFromRotationMatrix(
        new Matrix4().makeBasis(across, candidate, normal)
      )
      const origin = contact
        .clone()
        .sub(
          robot.paddleCenter
            .clone()
            .multiply(paddleScale)
            .applyQuaternion(paddleRotation)
        )
      const target = new Vector3()
      const rotation = new Quaternion()
      new Matrix4()
        .compose(origin, paddleRotation, paddleScale)
        .multiply(handToPaddle)
        .decompose(target, rotation, new Vector3())
      const geometry = armGeometry(s, e, h, target, rotation)
      const continuity = robot.lastBladeUp?.angleTo(candidate) || 0
      const score =
        Math.max(0, geometry.wristBend - Math.PI / 3) * 80 +
        geometry.reachError * 400 +
        blade.angleTo(candidate) ** 2 * 0.1 +
        continuity ** 2 * 0.16
      if (!best || score < best.score)
        best = { target, rotation, blade: candidate, score }
    }
    if (best) {
      robot.lastBladeUp = best.blade.clone()
      this.solveArm(
        robot,
        shoulder,
        elbow,
        handJoint,
        best.target,
        best.rotation
      )
    }
  }

  private capturePose(robot: RobotView) {
    if (!robot.authoredPose.length) {
      for (const joint of [
        robot.shoulder,
        robot.elbow,
        robot.hand,
        robot.leftShoulder,
        robot.leftElbow,
        robot.leftHand
      ]) {
        if (joint)
          robot.authoredPose.push({
            joint,
            position: joint.position.clone(),
            rotation: joint.quaternion.clone()
          })
      }
    }
    for (const pose of robot.authoredPose) {
      pose.position.copy(pose.joint.position)
      pose.rotation.copy(pose.joint.quaternion)
    }
    robot.root.updateMatrixWorld(true)
    robot.bladeUp
      .set(0, 1, 0)
      .applyQuaternion(robot.paddle.getWorldQuaternion(new Quaternion()))
  }

  private restorePose(robot: RobotView) {
    // AnimationMixer skips writes for unchanged tracks. Restore their authored
    // value before sampling, otherwise last frame's IK becomes the next pose.
    for (const pose of robot.authoredPose) {
      pose.joint.position.copy(pose.position)
      pose.joint.quaternion.copy(pose.rotation)
    }
  }

  private placeServingHand(robot: RobotView, state: MatchState) {
    const {
      palm,
      leftShoulder: shoulder,
      leftElbow: elbow,
      leftHand: hand
    } = robot
    if (!palm || !shoulder || !elbow || !hand) return
    robot.root.updateMatrixWorld(true)
    const motion = state.serveMotion
    // Once released, the palm finishes its toss and withdraws; only the core
    // ball follows the independent ballistic arc.
    const elapsed = Math.max(0, (state.tick - motion.tossAt) / 120)
    let lift = 0
    if (motion.stage !== "held")
      lift =
        0.07 * Math.sin(Math.min(1, elapsed / 0.22) * Math.PI) -
        Math.min(0.16, elapsed * 0.3)
    const palmGoal = new Vector3(
      motion.hand.x,
      motion.hand.z + lift,
      -motion.hand.y
    )
    const delta = palmGoal.sub(palm.getWorldPosition(new Vector3()))
    const target = hand.getWorldPosition(new Vector3()).add(delta)
    this.solveArm(
      robot,
      shoulder,
      elbow,
      hand,
      target,
      hand.getWorldQuaternion(new Quaternion())
    )
  }

  private solveArm(
    robot: RobotView,
    shoulder: Object3D,
    elbow: Object3D,
    handJoint: Object3D,
    target: Vector3,
    handRotation: Quaternion
  ) {
    const s = shoulder.getWorldPosition(new Vector3())
    const e = elbow.getWorldPosition(new Vector3())
    const hand = handJoint.getWorldPosition(new Vector3())
    const { elbow: desiredElbow, hand: desiredHand } = armGeometry(
      s,
      e,
      hand,
      target,
      handRotation
    )
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

function armGeometry(
  s: Vector3,
  e: Vector3,
  hand: Vector3,
  target: Vector3,
  rotation: Quaternion
) {
  const upper = s.distanceTo(e)
  const lower = e.distanceTo(hand)
  const direction = target.clone().sub(s)
  const distance = Math.max(
    Math.abs(upper - lower) + 0.005,
    Math.min(direction.length(), upper + lower - 0.005)
  )
  direction.normalize()
  const along =
    (upper * upper - lower * lower + distance * distance) / (2 * distance)
  const radius = Math.sqrt(Math.max(0, upper * upper - along * along))
  const handAxis = new Vector3(0, 1, 0).applyQuaternion(rotation)
  const bend = target.clone().addScaledVector(handAxis, -lower).sub(s)
  bend.addScaledVector(direction, -bend.dot(direction))
  if (bend.lengthSq() < 0.00001) {
    bend.copy(e).sub(s)
    bend.addScaledVector(direction, -bend.dot(direction))
  }
  if (bend.lengthSq() < 0.00001)
    bend.crossVectors(direction, new Vector3(0, 1, 0))
  bend.normalize()
  const elbow = s
    .clone()
    .addScaledVector(direction, along)
    .addScaledVector(bend, radius)
  const desiredHand = s.clone().addScaledVector(direction, distance)
  return {
    elbow,
    hand: desiredHand,
    reachError: desiredHand.distanceTo(target),
    wristBend: desiredHand.clone().sub(elbow).angleTo(handAxis)
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
