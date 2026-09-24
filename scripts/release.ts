/**
 * Cut a release. Consumers install a tag as a git dependency, so the tagged
 * commit carries a built dist/ and needs no compiler.
 *
 *   npm run release -- prepare <version>   # open the release PR
 *   npm run release -- tag <version>       # after it merges: build, tag, push
 *
 * Both steps refuse to run anywhere but a clean `main` that matches `origin/main`.
 *
 * `prepare` branches `release/vX.Y.Z` from main, bumps package.json and
 * package-lock.json, turns the CHANGELOG.md "Unreleased" section into the
 * version's entry, points the README install lines at the new tag, commits,
 * pushes, and opens a PR. Write the changelog entry under "## Unreleased"
 * before running it; an empty entry is refused.
 *
 * `tag` runs on main once the release PR has merged. It checks the version in
 * package.json and package-lock.json and the changelog entry, runs every CI
 * check and the build, then makes a "Release vX.Y.Z" commit whose parent is
 * main's HEAD and whose tree is main's tree plus dist/. That commit is reachable
 * only from the tag: main never tracks dist/ and never receives a direct commit.
 * The tag is annotated with the changelog entry and pushed.
 *
 * If the push fails, the tag is left locally and the error says how to push or
 * delete it. Rerunning `tag` with --push-existing pushes that tag as built,
 * without rebuilding, provided the tag is an annotated release tag on main's
 * HEAD, with the expected version and built dist/ tree.
 *
 * Flags:
 *   --no-push         do everything locally; push nothing and open no PR
 *   --push-existing   (tag only) push a local tag left by a failed push
 */

import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER = /^\d+\.\d+\.\d+$/;
const UNRELEASED = /^## Unreleased[ \t]*\n/m;

/** Every check CI runs, in CI's order, ending with the build that fills dist/. */
const CHECKS = ["typecheck", "data:check", "products:check", "products:equivalents:check", "test", "build"];

const USAGE = "Usage: npm run release -- <prepare|tag> <version> [--no-push | --push-existing]";

export class ReleaseError extends Error {}

interface Options {
  push: boolean;
  pushExisting: boolean;
}

interface Manifest {
  version: string;
  exports: Record<string, string | Record<string, string>>;
  bin: Record<string, string>;
}

interface Lockfile {
  version: string;
  packages: Record<string, { version?: string }>;
}

function fail(message: string): never {
  throw new ReleaseError(message);
}

function git(args: string[], options: ExecFileSyncOptions = {}): string {
  // With stdio inherited there is no captured output and execFileSync returns null.
  const out = execFileSync("git", args, { cwd: ROOT, ...options, encoding: "utf8" }) as string | null;
  return out?.trim() ?? "";
}

function readText(file: string): string {
  return readFileSync(join(ROOT, file), "utf8");
}

function writeText(file: string, text: string): void {
  writeFileSync(join(ROOT, file), text);
}

function readJson<T>(file: string): T {
  return JSON.parse(readText(file)) as T;
}

function writeJson(file: string, value: unknown): void {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

/** The body of a `## ...` section, up to the next `## ` heading. */
function sectionBody(changelog: string, heading: RegExpExecArray): string {
  const start = heading.index + heading[0].length;
  const next = changelog.slice(start).search(/^## /m);
  return changelog.slice(start, next === -1 ? undefined : start + next).trim();
}

/** The changelog entry for a version, or null when it has none or it is empty. */
export function changelogEntry(changelog: string, version: string): string | null {
  const escaped = version.replaceAll(".", "\\.");
  const heading = new RegExp(`^## \\[?${escaped}\\]?(?: - .*)?[ \\t]*\\n`, "m").exec(changelog);
  if (!heading) return null;
  return sectionBody(changelog, heading) || null;
}

/** Move the Unreleased entry under a dated version heading, leaving Unreleased empty. */
export function dateUnreleased(changelog: string, version: string, date: string): string {
  const heading = UNRELEASED.exec(changelog);
  if (!heading) fail('CHANGELOG.md has no "## Unreleased" section.');
  if (sectionBody(changelog, heading) === "") {
    fail('The "## Unreleased" section of CHANGELOG.md is empty; write the entry first.');
  }
  const at = heading.index + heading[0].length;
  return `${changelog.slice(0, at)}\n## [${version}] - ${date}\n${changelog.slice(at)}`;
}

/** Point every `github:thesnug/color-picker#vX.Y.Z` in the README at the new tag. */
export function pointReadme(readme: string, version: string): string {
  return readme.replace(/(github:thesnug\/color-picker#)v(?:\d+\.\d+\.\d+|X\.Y\.Z)/g, `$1v${version}`);
}

/** Parse the command line; throws ReleaseError on anything unexpected. */
export function parseArgs(argv: string[]): { command: "prepare" | "tag"; version: string } & Options {
  const flags = new Set(["--no-push", "--push-existing"]);
  const push = !argv.includes("--no-push");
  const pushExisting = argv.includes("--push-existing");
  const [command, version, ...rest] = argv.filter((arg) => !flags.has(arg));
  if ((command !== "prepare" && command !== "tag") || !version || rest.length > 0) fail(USAGE);
  const bare = version.replace(/^v/, "");
  if (!SEMVER.test(bare)) fail(`"${version}" is not a version like 0.1.0.`);
  if (pushExisting && command !== "tag") fail("--push-existing applies only to tag.");
  if (pushExisting && !push) fail("--push-existing and --no-push contradict each other.");
  return { command, version: bare, push, pushExisting };
}

/** What git says about a release tag before `tag` runs. */
export interface TagState {
  local: boolean;
  remote: boolean;
  /** Parents of the local tag's commit; empty when there is no local tag. */
  parents: string[];
  head: string;
}

/**
 * Whether `tag` should build and create the tag, or push the local one it
 * built on an earlier run. Refuses whenever origin has the tag.
 */
export function existingTagAction(tagName: string, state: TagState, pushExisting: boolean): "create" | "push" {
  const version = tagName.replace(/^v/, "");
  const deleteIt = `delete it with \`git tag -d ${tagName}\``;
  if (state.remote) fail(`${tagName} already exists on origin.`);
  if (!state.local) {
    if (pushExisting) fail(`--push-existing was given, but there is no local ${tagName} to push.`);
    return "create";
  }
  const fromHead = state.parents.length === 1 && state.parents[0] === state.head;
  if (!fromHead) {
    fail(`${tagName} exists locally but its commit is not a release commit on main's HEAD; ${deleteIt} and rerun.`);
  }
  if (!pushExisting) {
    fail(
      `${tagName} exists locally but not on origin. Push it with ` +
        `\`npm run release -- tag ${version} --push-existing\`, or ${deleteIt} and rerun.`,
    );
  }
  return "push";
}

/** Check the actual tag object and tree, not just the commit's parent. */
export function validateReleaseTag(tagName: string, requiredFiles: string[], cwd = ROOT): void {
  const run = (args: string[]): string => git(args, { cwd });
  const reject = (): never => fail(
    `${tagName} is not the expected annotated release with only built dist/ added; ` +
      `delete it with \`git tag -d ${tagName}\` and rerun.`,
  );
  const commit = run(["rev-parse", `${tagName}^{commit}`]);
  if (run(["cat-file", "-t", `refs/tags/${tagName}`]) !== "tag" ||
      run(["show", "-s", "--format=%s", commit]) !== `Release ${tagName}`) reject();
  const changed = run(["diff", "--name-only", "HEAD", commit]).split("\n").filter(Boolean);
  if (!changed.length || changed.some((path) => !path.startsWith("dist/"))) reject();
  const built = new Set(run(["ls-tree", "-r", "--name-only", commit, "dist/"]).split("\n"));
  if (requiredFiles.some((file) => !built.has(file))) reject();
}

/** The error for a tag push that failed after the tag was created locally. */
export function pushFailureMessage(tagName: string): string {
  const version = tagName.replace(/^v/, "");
  return [
    `Pushing ${tagName} to origin failed. ${tagName} exists locally but not on origin.`,
    "Fix the remote or credentials, then validate and push it with:",
    `  npm run release -- tag ${version} --push-existing`,
    "Or delete it and start over with:",
    `  git tag -d ${tagName}`,
  ].join("\n");
}

/** Refuse unless on a clean main that matches origin/main. */
function checkMain(): void {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== "main") fail(`Releases run on main; this is ${branch}.`);
  if (git(["status", "--porcelain"]) !== "") fail("The working tree is not clean.");
  git(["fetch", "--quiet", "--tags", "origin", "main"]);
  if (git(["rev-parse", "HEAD"]) !== git(["rev-parse", "origin/main"])) {
    fail("main does not match origin/main; pull or push first.");
  }
}

function tagState(tag: string): TagState {
  const local = git(["tag", "--list", tag]) !== "";
  const remote = git(["ls-remote", "--tags", "origin", `refs/tags/${tag}`]) !== "";
  // rev-list --parents prints the commit followed by its parents.
  const parents = local ? git(["rev-list", "--parents", "-n", "1", `${tag}^{commit}`]).split(" ").slice(1) : [];
  return { local, remote, parents, head: git(["rev-parse", "HEAD"]) };
}

function checkTagFree(tag: string): void {
  const { local, remote } = tagState(tag);
  if (local || remote) fail(`${tag} already exists.`);
}

function pushTag(tagName: string): void {
  try {
    git(["push", "--quiet", "origin", `refs/tags/${tagName}`], { stdio: "inherit" });
  } catch {
    // git has already printed its own reason to stderr.
    fail(pushFailureMessage(tagName));
  }
  log(`Pushed ${tagName}. Install with: npm install github:thesnug/color-picker#${tagName}`);
}

function prepare(version: string, { push }: Options): void {
  const tag = `v${version}`;
  checkMain();
  checkTagFree(tag);
  const branch = `release/${tag}`;
  if (git(["branch", "--list", branch]) !== "") fail(`Branch ${branch} already exists.`);

  const today = new Date().toISOString().slice(0, 10);
  const changelog = dateUnreleased(readText("CHANGELOG.md"), version, today);

  git(["switch", "--quiet", "-c", branch]);
  const pkg = readJson<Manifest>("package.json");
  pkg.version = version;
  writeJson("package.json", pkg);
  const lock = readJson<Lockfile>("package-lock.json");
  lock.version = version;
  lock.packages[""] = { ...lock.packages[""], version };
  writeJson("package-lock.json", lock);
  writeText("CHANGELOG.md", changelog);
  writeText("README.md", pointReadme(readText("README.md"), version));

  git(["add", "package.json", "package-lock.json", "CHANGELOG.md", "README.md"]);
  git(["commit", "--quiet", "-m", `Prepare ${tag}`]);
  log(`Committed "Prepare ${tag}" on ${branch}.`);
  if (!push) {
    log("Not pushed (--no-push).");
    return;
  }
  git(["push", "--quiet", "-u", "origin", branch], { stdio: "inherit" });
  const notes = changelogEntry(changelog, version);
  const body = `Bumps the version to ${version}. After this merges, run \`npm run release -- tag ${version}\` on main.\n\n${notes}\n`;
  execFileSync("gh", ["pr", "create", "--base", "main", "--title", `Release ${tag}`, "--body", body], {
    cwd: ROOT,
    stdio: "inherit",
  });
}

function releaseManifest(version: string): Manifest {
  const pkg = readJson<Manifest>("package.json");
  if (pkg.version !== version) {
    fail(`package.json is at ${pkg.version}, not ${version}. Merge the release PR from "prepare" first.`);
  }
  const lock = readJson<Lockfile>("package-lock.json");
  if (lock.version !== version || lock.packages[""]?.version !== version) {
    fail(`package-lock.json is not at ${version}.`);
  }
  if (!changelogEntry(readText("CHANGELOG.md"), version)) fail(`CHANGELOG.md has no entry for ${version}.`);
  return pkg;
}

/** Paths that a tag consumer needs, according to the package manifest. */
function releaseFiles(pkg: Manifest): string[] {
  return [...Object.values(pkg.exports).flatMap((entry) => typeof entry === "string" ? [entry] : Object.values(entry)),
    ...Object.values(pkg.bin)]
    .filter((path) => path.startsWith("./dist/"))
    .map((path) => path.slice(2));
}

function tag(version: string, { push, pushExisting }: Options): void {
  const tagName = `v${version}`;
  checkMain();
  const action = existingTagAction(tagName, tagState(tagName), pushExisting);
  if (action === "push") {
    const pkg = releaseManifest(version);
    validateReleaseTag(tagName, releaseFiles(pkg));
    // The tag was built and annotated by an earlier run; push it as it is.
    pushTag(tagName);
    return;
  }

  releaseManifest(version);
  const notes = changelogEntry(readText("CHANGELOG.md"), version);
  if (!notes) fail(`CHANGELOG.md has no entry for ${version}.`);

  for (const script of CHECKS) {
    log(`npm run ${script}`);
    execFileSync("npm", ["run", "--silent", script], { cwd: ROOT, stdio: "inherit" });
  }

  // Build the release tree in a scratch index so main's index and working tree
  // are never touched and dist/ never becomes tracked on main.
  const scratch = mkdtempSync(join(tmpdir(), "color-picker-release-"));
  const env = { ...process.env, GIT_INDEX_FILE: join(scratch, "index") };
  try {
    git(["read-tree", "HEAD"], { env });
    git(["add", "--force", "dist"], { env });
    const tree = git(["write-tree"], { env });
    const commit = git(["commit-tree", tree, "-p", "HEAD", "-m", `Release ${tagName}`]);
    // Verbatim cleanup keeps the changelog's "###" headings, which the default
    // cleanup would strip as comments.
    git(["tag", "--annotate", "--cleanup=verbatim", tagName, commit, "--message", `${tagName}\n\n${notes}\n`]);
    log(`Tagged ${tagName} at ${commit.slice(0, 7)} (main plus dist/).`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  if (!push) {
    log("Not pushed (--no-push).");
    return;
  }
  pushTag(tagName);
}

function main(argv: string[]): number {
  try {
    const { command, version, ...options } = parseArgs(argv);
    (command === "prepare" ? prepare : tag)(version, options);
    return 0;
  } catch (error) {
    if (!(error instanceof ReleaseError)) throw error;
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
