import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { fileURLToPath, URL } from "node:url"
import path from "node:path"
import process from "node:process"
import console from "node:console"

const root = fileURLToPath(new URL("../", import.meta.url))
const models = [
  "robot-player",
  "table-tennis-equipment",
  "cyber-arena",
  "sports-hall",
]
const source = path.join(root, "assets/models")
const targetIndex = process.argv.indexOf("--target")
if (targetIndex !== -1 && !process.argv[targetIndex + 1])
  throw new Error("--target requires a destination directory")
const destination =
  targetIndex === -1
    ? path.join(root, "public/models/table-tennis")
    : path.resolve(process.cwd(), process.argv[targetIndex + 1])

// Preflight every source before changing a staging copy. Authored assets are retained.
const buffers = await Promise.all(
  models.map((name) => readFile(path.join(source, `${name}.glb`)))
)
const hash = createHash("sha256")
models.forEach((name, index) => {
  if (buffers[index].readUInt32LE(0) !== 0x46546c67)
    throw new Error(`${name} is not a GLB`)
  hash.update(name)
  hash.update(buffers[index])
})
const version = hash.digest("hex").slice(0, 16)
const versionDir = path.join(destination, version)
await mkdir(versionDir, { recursive: true })
await Promise.all(
  models.map((name) =>
    copyFile(
      path.join(source, `${name}.glb`),
      path.join(versionDir, `${name}.glb`)
    )
  )
)
const manifest = {
  version,
  models: Object.fromEntries(models.map((name) => [name, `${name}.glb`])),
}
await writeFile(
  path.join(destination, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n"
)
console.log(
  `Prepared ${models.length} Blender GLB assets (${version}) in ${destination}`
)
