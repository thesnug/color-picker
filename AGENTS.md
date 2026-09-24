# Working in this repository

This file is for agents and people doing tasks here. `docs/DESIGN.md` holds the
decisions; this file holds the working method.

## The project

- **Repo:** `thesnug/color-picker`, public, single package with subpath exports,
  consumed by other repos as a git dependency pinned to a tag. See `docs/DESIGN.md`.
- **Linear:** project **Color Picker** (`P-INT-53`) on the **Internal** team (`INT`).
  Every piece of work is an issue in that project. Nothing ships without one.
- **Default product:** Comfort Colors 1717 when no product is named.
- **Spelling:** US English everywhere: code, comments, docs, commit messages, PR
  bodies, Linear issues, and UI copy. Flag UK spellings in vendored data rather than
  copying them.

## Git

- Work in a worktree under `.claude/worktrees/<branch>` on a branch named for the
  task (`feat/...`, `fix/...`, `docs/...`, `data/...`). Never commit directly to `main`.
- Open a PR against `main` when the work is done, with the Linear issue identifier
  in the branch name or PR body so Linear links it. Keep PRs reviewable: one issue
  per PR unless issues are trivially small and related.
- Never commit `.env*` files, API keys, or downloaded garment images. `dist/` is
  committed only by the release script at tag time.
- Releases are tags (`vX.Y.Z`). Consumers pin the tag. A release PR bumps the
  version, builds `dist`, and tags after merge.

## Linear: adding and maintaining issues

When work is planned here, it is written into Linear before it is started, and the
dependency graph is kept truthful as work proceeds.

**Creating issues**

- Team `Internal`, project `Color Picker`. Put the issue in the milestone matching
  its phase in `docs/DESIGN.md` (Foundation, Products and rules, Jev, Integration).
- Title: an imperative phrase naming the outcome ("Add Printify import script").
- Description: the outcome, the acceptance criteria as a checklist, the files or
  entry points involved, and links to the relevant section of `docs/DESIGN.md`.
  Enough that an agent can start without this conversation.
- Labels: `ready-for-agent` when the issue is fully specified and needs no human
  judgment; `ready-for-human` when it needs Jill (for example the hex review pass).
  Add a topical label where one fits (`setup`, `feature`, `accessibility`,
  `documentation`, `testing`, `api`, `ui`, `bug`).
- Priority: High for the Foundation milestone, Medium elsewhere unless a blocker
  chain makes something urgent.

**Dependencies**

- Use Linear's blocking relations, not prose. An issue that cannot start until
  another is merged is `blockedBy` that issue. Create issues in dependency order so
  the relation can be set at creation.
- A blocker is a real prerequisite (data, an API, a schema), not a preference about
  sequencing. If two issues merely share a file, use `relatedTo`.
- When scope changes, fix the graph: remove relations that no longer hold, add new
  ones, and split an issue rather than letting it grow.
- Cross-repo prerequisites (in `maker-method-picker` or `print-on-demand`) get an
  issue in this project that describes the change and names the other repo, so the
  blocking relation is visible here.

**Keeping it in sync**

- Starting work: move the issue to In Progress. Opening a PR: In Review. Merged:
  Done. Do not mark Done until merged and, where relevant, tagged.
- If a design decision changes, update `docs/DESIGN.md` in the same PR and note the
  change in the affected issues.
- Adding a new capability or product later: write the design change first, then the
  issues with their blockers, then the code.

## Data rules

- `assets/colors.json` is the vendored Wada source and is never edited by hand;
  cleanups produce derived files.
- Product hex values carry `source` and a date. `source: reviewed` values are never
  overwritten by an import script. Unstocked colors carry `available: false`.
- Garment images are referenced by public URL and SHA-256, never stored here.
- Jev is used for semantic judgments only. Anything derivable is precomputed and
  committed.
