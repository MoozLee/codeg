import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  buildEnglishBody,
  collectCommitRange,
  createReleaseNotes,
  requireTagRef,
  resolvePublishedTagCommit,
  selectPreviousPublishedRelease,
} = require("./release-notes.cjs")

function release(tag, id, publishedAt, overrides = {}) {
  return {
    id,
    tag_name: tag,
    draft: false,
    published_at: publishedAt,
    created_at: publishedAt,
    ...overrides,
  }
}

function createGithub({ currentTag, targetSha, releases, existingRelease }) {
  return {
    rest: {
      git: {
        async getRef({ ref }) {
          const tag = ref.slice("tags/".length)
          if (tag === currentTag) {
            return { data: { object: { type: "commit", sha: targetSha } } }
          }
          return {
            data: {
              object: { type: "tag", sha: `annotated-${tag}` },
            },
          }
        },
        async getTag({ tag_sha: tagSha }) {
          return {
            data: {
              object: { type: "commit", sha: `commit-for-${tagSha}` },
            },
          }
        },
      },
      repos: {
        async getReleaseByTag() {
          if (existingRelease) {
            return { data: existingRelease }
          }
          const error = new Error("not found")
          error.status = 404
          throw error
        },
        listReleases() {},
      },
    },
    async paginate() {
      return releases
    },
  }
}

test("requires a semver-like tag ref", () => {
  assert.equal(requireTagRef("refs/tags/v0.22.2-1"), "v0.22.2-1")
  assert.equal(requireTagRef("refs/tags/v0.22.2-rc.1"), "v0.22.2-rc.1")
  assert.throws(() => requireTagRef("refs/heads/release"), /tag ref/)
  assert.throws(() => requireTagRef("refs/tags/latest"), /semver-like/)
})

test("rejects annotated tags that do not resolve to commits", async () => {
  const github = {
    rest: {
      git: {
        async getRef() {
          return { data: { object: { type: "tag", sha: "tag-object" } } }
        },
        async getTag() {
          return { data: { object: { type: "tree", sha: "tree-object" } } }
        },
      },
    },
  }

  await assert.rejects(
    () =>
      createReleaseNotes({
        context: {
          ref: "refs/tags/v0.22.2-1",
          repo: { owner: "MoozLee", repo: "codeg" },
        },
        github,
        core: { info() {}, warning() {} },
        exists: () => true,
        readFile: () => "中文说明",
        runGit: () => "",
      }),
    /points to tree, not a commit/
  )
})

test("selects a stable published base without requiring ancestry", () => {
  const selection = selectPreviousPublishedRelease({
    currentTag: "v0.22.2-1",
    cutoff: Date.parse("2026-07-31T12:00:00Z"),
    releases: [
      release("v0.22.0-1", 20, "2026-07-29T00:00:00Z"),
      release("v0.22.1-1", 30, "2026-07-30T00:00:00Z"),
      release("v0.22.1-2", 30, "2026-07-30T00:00:00Z"),
      release("v0.22.2-1", 99, "2026-07-31T00:00:00Z"),
      release("v0.22.3-1", 40, "2026-08-01T00:00:00Z"),
      release("nightly", 50, "2026-07-30T00:00:00Z"),
    ],
  })

  assert.equal(selection.base.tag, "v0.22.1-1")
  assert.equal(selection.base.releaseId, 30)
})

test("fails when published releases exist but none predate the cutoff", () => {
  assert.throws(
    () =>
      selectPreviousPublishedRelease({
        currentTag: "v0.22.2-1",
        cutoff: Date.parse("2026-07-31T00:00:00Z"),
        releases: [release("v0.22.3-1", 1, "2026-08-01T00:00:00Z")],
      }),
    /none are eligible/
  )
})

test("keeps release candidates eligible for RC releases", () => {
  const selection = selectPreviousPublishedRelease({
    currentTag: "v0.22.3-rc.1",
    cutoff: Date.parse("2026-07-31T12:00:00Z"),
    releases: [
      release("v0.22.2-1", 1, "2026-07-30T00:00:00Z"),
      release("v0.22.3-rc.0", 2, "2026-07-31T00:00:00Z"),
    ],
  })

  assert.equal(selection.base.tag, "v0.22.3-rc.0")
})

test("fetches only the selected missing release tag and requires its commit", async () => {
  const calls = []
  const runGit = (args) => {
    calls.push(args)
    if (args[0] === "show-ref") {
      throw new Error("missing")
    }
    if (args[0] === "cat-file") {
      return ""
    }
    return ""
  }
  const github = createGithub({
    currentTag: "v0.22.2-1",
    targetSha: "target",
    releases: [],
  })

  const commit = await resolvePublishedTagCommit({
    github,
    owner: "MoozLee",
    repo: "codeg",
    tag: "v0.22.1-1",
    runGit,
  })

  assert.equal(commit, "commit-for-annotated-v0.22.1-1")
  assert.deepEqual(calls[1], [
    "fetch",
    "--no-tags",
    "origin",
    "+refs/tags/v0.22.1-1:refs/tags/v0.22.1-1",
  ])
  assert.equal(calls.filter((args) => args[0] === "fetch").length, 1)
})

test("fails rather than falling back when the selected tag cannot resolve", async () => {
  const github = {
    rest: {
      git: {
        async getRef() {
          const error = new Error("selected tag is missing")
          error.status = 404
          throw error
        },
      },
    },
  }

  await assert.rejects(
    () =>
      resolvePublishedTagCommit({
        github,
        owner: "MoozLee",
        repo: "codeg",
        tag: "v0.22.1-1",
        runGit(args) {
          if (args[0] === "show-ref") {
            throw new Error("missing")
          }
          return ""
        },
      }),
    /selected tag is missing/
  )
})

test("uses prior..target set difference for diverged shared histories", () => {
  const calls = []
  const runGit = (args) => {
    calls.push(args)
    if (args[0] === "merge-base") {
      return "shared-root"
    }
    if (args[0] === "rev-list") {
      return "2"
    }
    if (args[0] === "log") {
      return "1111111\0feat(acp): preserve context management\n2222222\0fix(acp): retain transcript replay"
    }
    throw new Error(`unexpected git command: ${args.join(" ")}`)
  }

  const range = collectCommitRange({
    priorSha: "fork-release",
    targetSha: "upstream-target",
    runGit,
  })

  assert.equal(range.range, "fork-release..upstream-target")
  assert.deepEqual(
    range.commits.map((commit) => commit.subject),
    [
      "feat(acp): preserve context management",
      "fix(acp): retain transcript replay",
    ]
  )
  assert.equal(
    calls.some((args) => args.includes("--is-ancestor")),
    false
  )
})

test("rejects unrelated, empty, and inconsistent release-note ranges", () => {
  assert.throws(
    () =>
      collectCommitRange({
        priorSha: "fork-release",
        targetSha: "upstream-target",
        runGit(args) {
          if (args[0] === "merge-base") {
            throw new Error("unrelated")
          }
          throw new Error(`unexpected git command: ${args.join(" ")}`)
        },
      }),
    /does not share history/
  )

  assert.throws(
    () =>
      collectCommitRange({
        priorSha: "fork-release",
        targetSha: "upstream-target",
        runGit(args) {
          if (args[0] === "merge-base") return "shared-root"
          if (args[0] === "rev-list") return "0"
          throw new Error(`unexpected git command: ${args.join(" ")}`)
        },
      }),
    /empty or invalid/
  )

  assert.throws(
    () =>
      collectCommitRange({
        priorSha: "fork-release",
        targetSha: "upstream-target",
        runGit(args) {
          if (args[0] === "merge-base") return "shared-root"
          if (args[0] === "rev-list") return "2"
          if (args[0] === "log") return "1111111\0fix: only one"
          throw new Error(`unexpected git command: ${args.join(" ")}`)
        },
      }),
    /expected 2 commits, found 1/
  )
})

test("categorizes conventional commits and has an explicit fallback", () => {
  const categorized = buildEnglishBody([
    { sha: "abcdef0123", subject: "feat!: release a breaking setting" },
    { sha: "0123456789", subject: "fix(acp)!: preserve a setting" },
    { sha: "9876543210", subject: "Merge branch 'release'" },
  ])
  assert.match(categorized.body, /## Features/)
  assert.match(categorized.body, /## Bug Fixes/)
  assert.equal(categorized.features, 1)
  assert.equal(categorized.fixes, 1)

  const fallback = buildEnglishBody([
    { sha: "abcdef0123", subject: "chore: housekeeping" },
  ])
  assert.match(fallback.body, /No categorized feat or fix commits/)
})

test("creates a bounded English-first body with Chinese notes", async () => {
  const currentTag = "v0.22.2-1"
  const targetSha = "target-commit"
  const priorTag = "v0.22.1-1"
  const fetches = []
  const github = createGithub({
    currentTag,
    targetSha,
    releases: [release(priorTag, 1, "2026-07-30T00:00:00Z")],
  })
  const runGit = (args) => {
    if (args[0] === "cat-file") return ""
    if (args[0] === "show") return "2026-07-31T00:00:00Z"
    if (args[0] === "show-ref") throw new Error("missing selected tag")
    if (args[0] === "fetch") {
      fetches.push(args)
      return ""
    }
    if (args[0] === "merge-base") return "shared-root"
    if (args[0] === "rev-list") return "2"
    if (args[0] === "log") {
      return "1111111\0feat(acp): safer context windows\n2222222\0fix(acp): preserve private maintenance"
    }
    throw new Error(`unexpected git command: ${args.join(" ")}`)
  }
  const messages = []

  const notes = await createReleaseNotes({
    context: {
      ref: `refs/tags/${currentTag}`,
      repo: { owner: "MoozLee", repo: "codeg" },
    },
    github,
    core: {
      info(message) {
        messages.push(message)
      },
      warning(message) {
        messages.push(message)
      },
    },
    exists: (path) => path === `.github/release-notes/${currentTag}.zh.md`,
    readFile: () => "中文变更说明",
    runGit,
  })

  assert.equal(notes.range, "commit-for-annotated-v0.22.1-1..target-commit")
  assert.match(notes.releaseBody, /^## Features/)
  assert.match(notes.releaseBody, /## 中文说明\n\n中文变更说明$/)
  assert.equal(fetches.length, 1)
  assert.match(messages.join("\n"), /commits=2, features=1, fixes=1/)
})

test("reuses same-tag drafts and rejects already published releases", async () => {
  const common = {
    currentTag: "v0.22.2-1",
    targetSha: "target",
    releases: [],
  }
  const draftGithub = createGithub({
    ...common,
    existingRelease: {
      draft: true,
      created_at: "2026-07-31T00:00:00Z",
    },
  })
  const draftCommands = []
  const draftNotes = await createReleaseNotes({
    context: {
      ref: "refs/tags/v0.22.2-1",
      repo: { owner: "MoozLee", repo: "codeg" },
    },
    github: draftGithub,
    core: { info() {}, warning() {} },
    exists: () => true,
    readFile: () => "中文说明",
    runGit(args) {
      draftCommands.push(args)
      if (args[0] === "cat-file") return ""
      if (args[0] === "rev-list") return "1"
      if (args[0] === "log") return "1111111\0fix: draft reuse"
      throw new Error(`unexpected command: ${args.join(" ")}`)
    },
  })
  assert.equal(draftNotes.existingDraft.draft, true)
  assert.equal(
    draftCommands.some((args) => args[0] === "show"),
    false
  )

  const publishedGithub = createGithub({
    ...common,
    existingRelease: { draft: false },
  })
  await assert.rejects(
    () =>
      createReleaseNotes({
        context: {
          ref: "refs/tags/v0.22.2-1",
          repo: { owner: "MoozLee", repo: "codeg" },
        },
        github: publishedGithub,
        core: { info() {}, warning() {} },
        exists: () => true,
        readFile: () => "中文说明",
        runGit: () => "",
      }),
    /already exists and is not a draft/
  )
})

test("uses a draft's stable cutoff and fails closed for shallow history", async () => {
  const currentTag = "v0.22.2-1"
  const github = createGithub({
    currentTag,
    targetSha: "target-commit",
    existingRelease: {
      draft: true,
      created_at: "2026-07-31T00:00:00Z",
    },
    releases: [
      release("v0.22.1-1", 1, "2026-07-30T00:00:00Z"),
      release("v0.22.3-1", 2, "2026-08-01T00:00:00Z"),
    ],
  })
  const calls = []

  await assert.rejects(
    () =>
      createReleaseNotes({
        context: {
          ref: `refs/tags/${currentTag}`,
          repo: { owner: "MoozLee", repo: "codeg" },
        },
        github,
        core: { info() {}, warning() {} },
        exists: () => true,
        readFile: () => "中文说明",
        runGit(args) {
          calls.push(args)
          if (args[0] === "cat-file") return ""
          if (args[0] === "show-ref") throw new Error("missing selected tag")
          if (args[0] === "fetch") return ""
          if (args[0] === "merge-base") throw new Error("shallow checkout")
          throw new Error(`unexpected git command: ${args.join(" ")}`)
        },
      }),
    /does not share history/
  )

  assert.equal(
    calls.some((args) => args[0] === "show"),
    false
  )
  assert.deepEqual(
    calls.find((args) => args[0] === "fetch"),
    ["fetch", "--no-tags", "origin", "+refs/tags/v0.22.1-1:refs/tags/v0.22.1-1"]
  )
})

test("rejects a selected prior tag that resolves to the target commit", async () => {
  const github = {
    rest: {
      git: {
        async getRef() {
          return { data: { object: { type: "commit", sha: "same-commit" } } }
        },
      },
      repos: {
        async getReleaseByTag() {
          const error = new Error("not found")
          error.status = 404
          throw error
        },
        listReleases() {},
      },
    },
    async paginate() {
      return [release("v0.22.1-1", 1, "2026-07-30T00:00:00Z")]
    },
  }

  await assert.rejects(
    () =>
      createReleaseNotes({
        context: {
          ref: "refs/tags/v0.22.2-1",
          repo: { owner: "MoozLee", repo: "codeg" },
        },
        github,
        core: { info() {}, warning() {} },
        exists: () => true,
        readFile: () => "中文说明",
        runGit(args) {
          if (args[0] === "cat-file" || args[0] === "show-ref") return ""
          if (args[0] === "show") return "2026-07-31T00:00:00Z"
          throw new Error(`unexpected git command: ${args.join(" ")}`)
        },
      }),
    /resolves to the target commit/
  )
})

test("uses complete history only for a genuine first published release", async () => {
  const messages = []
  const notes = await createReleaseNotes({
    context: {
      ref: "refs/tags/v0.22.2-1",
      repo: { owner: "MoozLee", repo: "codeg" },
    },
    github: createGithub({
      currentTag: "v0.22.2-1",
      targetSha: "target-commit",
      releases: [],
    }),
    core: {
      info(message) {
        messages.push(message)
      },
      warning(message) {
        messages.push(message)
      },
    },
    exists: () => true,
    readFile: () => "中文说明",
    runGit(args) {
      if (args[0] === "cat-file") return ""
      if (args[0] === "show") return "2026-07-31T00:00:00Z"
      if (args[0] === "rev-list") return "1"
      if (args[0] === "log") return "1111111\0feat: first published release"
      throw new Error(`unexpected git command: ${args.join(" ")}`)
    },
  })

  assert.equal(notes.range, "target-commit")
  assert.equal(notes.releaseBase, null)
  assert.equal(notes.diagnostics.commitCount, 1)
  assert.match(messages.join("\n"), /First published fork release/)
  assert.match(messages.join("\n"), /English=\d+, final=\d+/)
})
