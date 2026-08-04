/* eslint-disable @typescript-eslint/no-require-imports -- github-script loads this helper through CommonJS. */
const { existsSync, readFileSync } = require("node:fs")
const { execFileSync } = require("node:child_process")

const SEMVER_TAG_PATTERN = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

function fail(message) {
  throw new Error(`Release notes: ${message}`)
}

function isSemverTag(tag) {
  return SEMVER_TAG_PATTERN.test(tag)
}

function requireTagRef(ref) {
  const prefix = "refs/tags/"
  if (!ref?.startsWith(prefix)) {
    fail(`release workflow requires a tag ref, received ${ref ?? "nothing"}`)
  }

  const tag = ref.slice(prefix.length)
  if (!isSemverTag(tag)) {
    fail(`release tag ${tag} is not semver-like`)
  }

  return tag
}

function parseTimestamp(value, description) {
  const timestamp = Date.parse(value ?? "")
  if (!Number.isFinite(timestamp)) {
    fail(`${description} has no valid timestamp`)
  }
  return timestamp
}

function createGitRunner(cwd = process.cwd()) {
  return (args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()
}

async function resolveTagCommitFromApi(github, owner, repo, tag) {
  const { data: tagRef } = await github.rest.git.getRef({
    owner,
    repo,
    ref: `tags/${tag}`,
  })

  let commitSha = tagRef.object.sha
  if (tagRef.object.type === "tag") {
    const { data: annotatedTag } = await github.rest.git.getTag({
      owner,
      repo,
      tag_sha: commitSha,
    })
    if (annotatedTag.object.type !== "commit") {
      fail(`tag ${tag} points to ${annotatedTag.object.type}, not a commit`)
    }
    commitSha = annotatedTag.object.sha
  } else if (tagRef.object.type !== "commit") {
    fail(`tag ${tag} points to ${tagRef.object.type}, not a commit`)
  }

  return commitSha
}

async function resolvePublishedTagCommit({ github, owner, repo, tag, runGit }) {
  try {
    runGit(["show-ref", "--verify", "--quiet", `refs/tags/${tag}`])
  } catch {
    runGit([
      "fetch",
      "--no-tags",
      "origin",
      `+refs/tags/${tag}:refs/tags/${tag}`,
    ])
  }

  const commitSha = await resolveTagCommitFromApi(github, owner, repo, tag)
  try {
    runGit(["cat-file", "-e", `${commitSha}^{commit}`])
  } catch {
    fail(`selected published tag ${tag} commit is unavailable in this checkout`)
  }

  return commitSha
}

function selectPreviousPublishedRelease({ releases, currentTag, cutoff }) {
  const candidates = releases.filter(
    (release) =>
      !release.draft &&
      release.tag_name !== currentTag &&
      isSemverTag(release.tag_name)
  )

  if (candidates.length === 0) {
    return { base: null, firstPublishedRelease: true }
  }

  const eligible = candidates
    .map((release) => ({
      release,
      publishedAt: Date.parse(release.published_at ?? release.created_at ?? ""),
    }))
    .filter(
      ({ publishedAt }) => Number.isFinite(publishedAt) && publishedAt <= cutoff
    )
    .sort((left, right) => {
      if (left.publishedAt !== right.publishedAt) {
        return right.publishedAt - left.publishedAt
      }
      if (left.release.id !== right.release.id) {
        return right.release.id - left.release.id
      }
      return left.release.tag_name.localeCompare(right.release.tag_name)
    })

  if (eligible.length === 0) {
    fail(
      "published semver-like releases exist, but none are eligible before the stable cutoff"
    )
  }

  const { release, publishedAt } = eligible[0]
  return {
    base: {
      source: "published GitHub release",
      tag: release.tag_name,
      releaseId: release.id,
      publishedAt,
    },
  }
}

function parseCommitLines(output) {
  if (!output) {
    return []
  }

  return output.split("\n").map((line) => {
    const separator = line.indexOf("\0")
    if (separator <= 0) {
      fail("git log returned an invalid NUL-separated commit record")
    }
    return {
      sha: line.slice(0, separator),
      subject: line.slice(separator + 1),
    }
  })
}

function collectCommitRange({ priorSha, targetSha, runGit }) {
  let range = targetSha
  if (priorSha) {
    try {
      runGit(["merge-base", priorSha, targetSha])
    } catch {
      fail(
        "selected published release does not share history with the target tag"
      )
    }
    range = `${priorSha}..${targetSha}`
  }

  let countText
  try {
    countText = runGit(["rev-list", "--count", range])
  } catch {
    fail(`cannot count release note range ${range}`)
  }
  if (!/^\d+$/.test(countText)) {
    fail(`release note range ${range} returned an invalid commit count`)
  }

  const expectedCount = Number(countText)
  if (!Number.isSafeInteger(expectedCount) || expectedCount <= 0) {
    fail(`release note range ${range} is empty or invalid`)
  }

  let commits
  try {
    commits = parseCommitLines(
      runGit(["log", "--reverse", "--format=%H%x00%s", range])
    )
  } catch (error) {
    if (error.message?.startsWith("Release notes:")) {
      throw error
    }
    fail(`cannot read release note range ${range}`)
  }

  if (commits.length !== expectedCount) {
    fail(
      `release note range ${range} changed while reading it: expected ${expectedCount} commits, found ${commits.length}`
    )
  }

  return { range, commits }
}

function categorizeCommits(commits) {
  const features = []
  const fixes = []
  const conventionalCommit = /^(feat|fix)(?:\([^)]*\))?!?:\s+(.+)$/

  for (const commit of commits) {
    const match = conventionalCommit.exec(commit.subject)
    if (!match) {
      continue
    }

    const entry = `- ${match[2]} (${commit.sha.slice(0, 7)})`
    if (match[1] === "feat") {
      features.push(entry)
    } else {
      fixes.push(entry)
    }
  }

  return { features, fixes }
}

function buildEnglishBody(commits) {
  const { features, fixes } = categorizeCommits(commits)
  const sections = []

  if (features.length > 0) {
    sections.push(`## Features\n\n${features.join("\n")}`)
  }
  if (fixes.length > 0) {
    sections.push(`## Bug Fixes\n\n${fixes.join("\n")}`)
  }
  if (sections.length === 0) {
    sections.push(
      "## Changes\n\n_No categorized feat or fix commits in this release._"
    )
  }

  return {
    body: sections.join("\n\n"),
    features: features.length,
    fixes: fixes.length,
  }
}

function utf8ByteLength(value) {
  return Buffer.byteLength(value, "utf8")
}

async function createReleaseNotes({
  context,
  github,
  core,
  cwd = process.cwd(),
  exists = existsSync,
  readFile = readFileSync,
  runGit = createGitRunner(cwd),
}) {
  const tag = requireTagRef(context.ref)
  const { owner, repo } = context.repo

  const targetSha = await resolveTagCommitFromApi(github, owner, repo, tag)
  try {
    runGit(["cat-file", "-e", `${targetSha}^{commit}`])
  } catch {
    fail(`current tag ${tag} commit is unavailable in this checkout`)
  }

  let existingDraft = null
  try {
    const { data: release } = await github.rest.repos.getReleaseByTag({
      owner,
      repo,
      tag,
    })
    if (!release.draft) {
      fail(`release for tag ${tag} already exists and is not a draft`)
    }
    existingDraft = release
  } catch (error) {
    if (error.message?.startsWith("Release notes:")) {
      throw error
    }
    if (error.status !== 404) {
      throw error
    }
  }

  const chineseNotesPath = `.github/release-notes/${tag}.zh.md`
  if (!exists(chineseNotesPath)) {
    fail(`missing Simplified Chinese release notes file: ${chineseNotesPath}`)
  }
  const chineseNotes = readFile(chineseNotesPath, "utf8").trim()
  if (!chineseNotes) {
    fail(`Simplified Chinese release notes file is empty: ${chineseNotesPath}`)
  }

  const cutoff = existingDraft
    ? parseTimestamp(existingDraft.created_at, "existing draft release")
    : parseTimestamp(
        runGit(["show", "-s", "--format=%cI", targetSha]),
        "target tag commit"
      )
  const releases = await github.paginate(github.rest.repos.listReleases, {
    owner,
    repo,
    per_page: 100,
  })
  const selection = selectPreviousPublishedRelease({
    releases,
    currentTag: tag,
    cutoff,
  })

  let priorSha = null
  if (selection.base) {
    priorSha = await resolvePublishedTagCommit({
      github,
      owner,
      repo,
      tag: selection.base.tag,
      runGit,
    })
    if (priorSha === targetSha) {
      fail(
        `selected published tag ${selection.base.tag} resolves to the target commit`
      )
    }
    selection.base.sha = priorSha
  } else {
    core.warning("First published fork release: using complete history")
  }

  const { range, commits } = collectCommitRange({
    priorSha,
    targetSha,
    runGit,
  })
  const english = buildEnglishBody(commits)
  const releaseBody = `${english.body}\n\n## 中文说明\n\n${chineseNotes}`

  core.info(
    `Release notes range ${range}: commits=${commits.length}, features=${english.features}, fixes=${english.fixes}`
  )
  core.info(
    `Release notes UTF-8 bytes: English=${utf8ByteLength(english.body)}, final=${utf8ByteLength(releaseBody)}`
  )

  return {
    tag,
    targetSha,
    existingDraft,
    releaseBody,
    range,
    releaseBase: selection.base,
    diagnostics: {
      commitCount: commits.length,
      features: english.features,
      fixes: english.fixes,
      englishBytes: utf8ByteLength(english.body),
      finalBytes: utf8ByteLength(releaseBody),
    },
  }
}

module.exports = {
  SEMVER_TAG_PATTERN,
  buildEnglishBody,
  categorizeCommits,
  collectCommitRange,
  createGitRunner,
  createReleaseNotes,
  isSemverTag,
  requireTagRef,
  resolvePublishedTagCommit,
  selectPreviousPublishedRelease,
}
