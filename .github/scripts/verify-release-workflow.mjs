import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const FORK_UPDATER_PUBKEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDQ1RDg5QzNGOTQ1NDA3MDcKUldRSEIxU1VQNXpZUllJa1NzRnR4dW1jODAvZmcyMnhPNU5CZG1Td1Bwb09MNWtLQnNHQWdHc2sK"
const failures = []

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), "utf8")
}

function fail(message) {
  failures.push(message)
}

function assert(condition, message) {
  if (!condition) {
    fail(message)
  }
}

function runGit(args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
}

const packageJson = JSON.parse(read("package.json"))
const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json"))
const cargoToml = read("src-tauri/Cargo.toml")
const cargoLock = read("src-tauri/Cargo.lock")
const migrator = read("src-tauri/src/db/migration/mod.rs")
const workflow = read(".github/workflows/release.yml")
const testWorkflow = read(".github/workflows/test.yml")

const cargoVersion = cargoToml.match(/^version = "([^"]+)"/m)?.[1]
const rootPackage = cargoLock.match(
  /\[\[package\]\]\nname = "codeg"\nversion = "([^"]+)"/
)?.[1]
const versions = [
  packageJson.version,
  tauriConfig.version,
  cargoVersion,
  rootPackage,
]
assert(
  versions.every((version) => version === versions[0]),
  `version sources are not lockstep: ${versions.join(", ")}`
)

const tag = `v${versions[0]}`
const chineseNotesPath = `.github/release-notes/${tag}.zh.md`
assert(
  existsSync(resolve(root, chineseNotesPath)),
  `missing ${chineseNotesPath}`
)
if (existsSync(resolve(root, chineseNotesPath))) {
  assert(
    read(chineseNotesPath).trim().length > 0,
    `${chineseNotesPath} is empty`
  )
}

const updater = tauriConfig.plugins?.updater
assert(
  updater?.endpoints?.includes(
    "https://github.com/MoozLee/codeg/releases/latest/download/latest.json"
  ),
  "updater endpoint does not use the fork release channel"
)
assert(Boolean(updater?.pubkey?.trim()), "updater public key is missing")
assert(
  updater?.pubkey === FORK_UPDATER_PUBKEY,
  "updater public key does not match the fork trust root"
)
assert(
  !JSON.stringify(tauriConfig).includes("xintaofei/codeg"),
  "updater configuration references the upstream release channel"
)

const requiredMigrations = [
  "m20260510_000001_folder_is_pinned",
  "m20260511_000001_paired_devices",
  "m20260513_000001_provider_usage_config",
  "m20260513_000001_remote_workspace_connection",
  "m20260513_000002_provider_usage_config_query_kinds",
]
const migrationRegistrations = [
  ...migrator.matchAll(/Box::new\((m\d+_[a-z0-9_]+)::Migration\)/g),
].map((match) => match[1])
const expectedMigrationWindow = [
  "m20260424_000002_quick_message",
  ...requiredMigrations,
  "m20260518_000001_model_provider_single_type_and_model",
]
const migrationWindowStart = migrationRegistrations.indexOf(
  expectedMigrationWindow[0]
)
assert(
  migrationWindowStart >= 0 &&
    migrationRegistrations
      .slice(
        migrationWindowStart,
        migrationWindowStart + expectedMigrationWindow.length
      )
      .every((name, index) => name === expectedMigrationWindow[index]),
  "legacy migrations are not registered between quick_message and model_provider"
)
for (const migration of requiredMigrations) {
  assert(
    existsSync(resolve(root, `src-tauri/src/db/migration/${migration}.rs`)),
    `missing historical migration module ${migration}`
  )
}

const upstreamCustomAgentMigrations = [
  "m20260726_000001_custom_agent",
  "m20260727_000001_custom_agent_skills",
  "m20260728_000001_custom_agent_skills_dir",
  "m20260728_000002_custom_agent_source",
]
const customAgentStart = migrationRegistrations.indexOf(
  upstreamCustomAgentMigrations[0]
)
assert(
  customAgentStart > migrationWindowStart &&
    migrationRegistrations
      .slice(
        customAgentStart,
        customAgentStart + upstreamCustomAgentMigrations.length
      )
      .every((name, index) => name === upstreamCustomAgentMigrations[index]),
  "upstream custom-agent migrations no longer follow the restored legacy sequence"
)

assert(
  workflow.includes("fetch-depth: 0"),
  "release workflow must retain a complete checkout"
)
assert(
  workflow.includes('RELEASE_BRANCH="release"'),
  "release workflow must gate tags against origin/release"
)
assert(
  workflow.includes("release-notes.cjs"),
  "release workflow does not use the bounded release-note helper"
)
assert(
  workflow.includes("release-notes.test.mjs"),
  "release workflow does not run release-note fixtures"
)
assert(
  testWorkflow.includes("release-workflow:") &&
    testWorkflow.includes("fetch-depth: 2"),
  "release workflow fixture job cannot inspect the versioned commit parent"
)
assert(
  workflow.includes("release_body: ${{ steps.release.outputs.release_body }}"),
  "release body is not exported from the draft job"
)
assert(
  workflow.includes(
    "releaseBody: ${{ needs.create-draft-release.outputs.release_body }}"
  ),
  "release body is not forwarded to artifact uploads"
)
assert(
  workflow.includes("if: ${{ false }}"),
  "Docker publishing is not disabled"
)
assert(
  !workflow.includes("      - build-docker\n    if:"),
  "publish-release still depends on the disabled Docker job"
)
assert(
  workflow.includes(
    "Build and upload unsigned macOS artifact to draft release"
  ),
  "unsigned macOS fallback is missing"
)
assert(
  workflow.includes("Verify updater signatures match committed pubkey"),
  "macOS updater signature verification is missing"
)
assert(
  workflow.includes("steps.apple-signing.outputs.available == 'true'") &&
    workflow.includes("steps.apple-signing.outputs.available != 'true'"),
  "macOS signed and unsigned artifact paths are not both configured"
)
assert(
  workflow.includes("minisign -Vm"),
  "macOS updater signature verification does not invoke minisign"
)
assert(
  workflow.includes('find "$BUNDLE_ROOT" -type f -name "*.sig"') &&
    workflow.includes('base64 --decode < "$sig"'),
  "macOS updater signature verification does not validate every artifact"
)
assert(
  workflow.indexOf("Verify updater signatures match committed pubkey") <
    workflow.indexOf("  publish-release:"),
  "macOS updater signature verification must occur before publish"
)

try {
  const headCargoLock = runGit(["show", "HEAD:src-tauri/Cargo.lock"])
  const headRootPackage = headCargoLock.match(
    /\[\[package\]\]\nname = "codeg"\nversion = "([^"]+)"/
  )?.[1]
  const baselineRef = headRootPackage === versions[0] ? "HEAD^" : "HEAD"
  const baselineCargoLock = runGit([
    "show",
    `${baselineRef}:src-tauri/Cargo.lock`,
  ])
  const baselineRootPackage = baselineCargoLock.match(
    /\[\[package\]\]\nname = "codeg"\nversion = "([^"]+)"/
  )?.[1]
  const baselineLines = baselineCargoLock.trimEnd().split("\n")
  const workingLines = cargoLock.trimEnd().split("\n")
  const changedLines = []
  const lineCount = Math.max(baselineLines.length, workingLines.length)
  for (let index = 0; index < lineCount; index += 1) {
    if (baselineLines[index] !== workingLines[index]) {
      changedLines.push({
        baseline: baselineLines[index],
        working: workingLines[index],
      })
    }
  }
  assert(
    baselineRootPackage === "0.22.2" &&
      changedLines.length === 1 &&
      changedLines[0].baseline === 'version = "0.22.2"' &&
      changedLines[0].working === `version = "${versions[0]}"`,
    "Cargo.lock release-prep delta must contain only the root codeg version"
  )
} catch (error) {
  fail(`cannot validate Cargo.lock delta: ${error.message}`)
}

if (failures.length > 0) {
  for (const message of failures) {
    console.error(`release overlay validation failed: ${message}`)
  }
  process.exitCode = 1
} else {
  console.log(`release overlay validation passed for ${tag}`)
}
