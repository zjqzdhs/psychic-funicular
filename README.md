# Break Builder · Table Tennis

3D 乒乓球游戏：单指划动或鼠标拖动挥拍、辅助站位、练习模式、三个难度的 AI，以及由主站提供房间服务的好友对战。原始二维原型 [`pong.html`](./pong.html) 原样保留。

本仓库负责独立游戏和可复用的 TypeScript 物理核心。Break Builder 主站负责账户、好友、邀请、WebSocket 鉴权、权威房间、战绩与部署。游戏不需要获取用户的登录令牌。

## 本地运行

使用 Node.js 22.12+ 或 24 LTS。依赖版本在 `package.json` 中固定。

```sh
npm ci
npm run dev
```

打开终端显示的本地地址。开发页是 `demo/index.html`，生产构建输出到 `build/`。`predev` / `prebuild` 会把 `assets/models/` 内已制作完成的模型复制成带内容版本的同源资源，并生成加载清单；模型缺失会明确报错，不会用简陋占位体冒充成品。

```sh
npm test              # 核心物理、规则、浏览器输入与网络单元测试
npm run lint         # TypeScript 类型检查
npm run build        # 类型检查与 Vite 生产打包
npm run prettify     # 统一格式
```

独立试玩支持练习及 AI。好友模式需要主站提供已鉴权的 WebSocket URL，单独启动 Vite 不会创建线上房间。

## 游戏规则与操作

- 单打 11 分、领先 2 分获胜，三局两胜；每 2 分换发球，10 平后每分换发球。
- 发球先落本方台面，再落对方台面；合法发球擦网后重发，错误发球判失分。
- 漏接、出界、同一侧二次落台和未落台截击都会失分；局间换边，决胜局一方先到 5 分时换边。
- 向上划动挥拍，横向分量决定落点、划动速度决定力度。系统辅助移动和拍面高度，仍需要把握挥拍时间。
- 初学、进阶、高手 AI 使用不同反应时间、移动速度和瞄准误差；球的运动使用相同物理。
- 练习模式持续进行，不在赢得两局后结束；每个练习回合由玩家重新发球，陪练主要回中路。

这是有站位和落点辅助的休闲乒乓球。发球动作、受限旋转和球拍碰撞是可玩性优先的近似，不是职业级动作捕捉或完整流体模拟。

## 代码结构与接入

```text
src/core/       无 DOM / Three.js 依赖的确定性物理、规则与 AI
src/browser/    Three.js 场景、模型动画、手势、音效、UI 与网络适配
demo/           独立试玩入口
art/            Blender 制作与导出脚本
assets/         可编辑 Blender 源文件与正式 GLB
public/         从正式资产准备的版本化发布资源
test/           核心运动学、规则与输入回归
docs/           架构、资产来源和制作说明
pong.html       原始二维原型
```

核心 API：

```ts
import { createMatch, applyInput, stepMatch, createSnapshot } from "./src/core";

const state = createMatch({ mode: "ai", difficulty: "medium", seed: 42 });
applyInput(state, 0, { kind: "serve", seq: 0, aimX: 0, power: 0.5, spin: 0 });
stepMatch(state); // 每次准确推进 1 / 120 秒；由调用方提供固定步进循环
const snapshot = createSnapshot(state); // 可 JSON 序列化，独立拷贝
```

`mode` 为 `ai`、`practice` 或 `friend`。`friend` 不会自动控制任何一方。`seq` 是每位玩家单调递增的输入序号，重连时从快照中该玩家的 `lastInputSeq + 1` 继续；输入不接受 `NaN`、无穷值、过期序号或错误回合。每个 tick 的 `state.events` 包含触球、落台、擦网、得分及胜负事件，记录时须在下一 tick 前消费。

浏览器入口导出 `mountTableTennis(options)`，返回 `resize()`、`pause()`、`resume()` 和 `dispose()`。传入容器、模式、画质/音量、同源资源地址和公开的玩家信息；退出时调用 `dispose()` 释放 WebGL、音频、监听器和连接。精确选项见 `src/browser/types.ts`。

坐标约定：核心中 X 为桌宽，Y 为桌长，Z 向上；桌面高度 0.76m、台面 1.525 × 2.74m、球半径 0.02m。玩家编号在整场比赛内保持不变，实际所处方向以 `state.ends` 判断，不得在换边后把玩家 0 始终当成负 Y。

## 主站集成与版本固定

主站将本仓库作为 `packages/table-tennis` Git submodule，并固定到已经验证的提交。拉取主站时运行：

```sh
git submodule update --init --recursive
```

不要在生产构建时自动追踪本仓库浮动 `main`。修改先在本仓库完成测试、浏览器检查和提交，再更新主站 submodule 指针；主站同源发布资源并按需加载游戏。线上服务以服务器的快照、得分和胜负为准，本地预测不得提交战绩。

## 模型与权利说明

本地验证记录见 [`docs/validation.md`](./docs/validation.md)：37 项单元测试、192 个真实模型触点姿态、双浏览器完整对局和断线重连，以及 50/100/150ms 人工链路延迟下的真实本地服务回击。上述记录对应资源版本 `b09035069dae8d57`；不等同于公网或手机真机验收。

模型源文件、Blender 制作流程、导出参数及来源记录见 [`docs/assets.md`](./docs/assets.md)。游戏逻辑和浏览器代码的测试通过，不等于真实手机操作已验收。本轮按项目安排暂不做真机测试；手机性能、触控舒适度与双设备弱网表现仍是未验证边界。

原仓库未包含许可文件，本次保留原作者的 `pong.html`，未为原作擅自增加或变更许可证。第三方资产必须逐项记录来源、许可证和再分发范围；仓库公开可读不自动等于允许第三方任意复用。
