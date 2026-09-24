import { describe, expect, it } from "vitest";

import {
  changelogEntry,
  dateUnreleased,
  existingTagAction,
  parseArgs,
  pointReadme,
  pushFailureMessage,
  ReleaseError,
  type TagState,
} from "../scripts/release.js";

const CHANGELOG = `# Changelog

Intro text.

## Unreleased

- Added the thing.

## [0.1.0] - 2026-09-24

- First release.
`;

describe("changelogEntry", () => {
  it("returns the body of a version's section", () => {
    expect(changelogEntry(CHANGELOG, "0.1.0")).toBe("- First release.");
  });

  it("returns null for a version with no section", () => {
    expect(changelogEntry(CHANGELOG, "0.2.0")).toBeNull();
  });

  it("returns null for an empty section", () => {
    expect(changelogEntry("## [0.3.0] - 2026-10-01\n\n## [0.2.0]\n\n- x\n", "0.3.0")).toBeNull();
  });

  it("does not treat dots as wildcards", () => {
    expect(changelogEntry("## [0x1x0]\n\n- x\n", "0.1.0")).toBeNull();
  });
});

describe("dateUnreleased", () => {
  it("moves the Unreleased entry under a dated heading and leaves Unreleased empty", () => {
    const next = dateUnreleased(CHANGELOG, "0.2.0", "2026-10-01");
    expect(next).toContain("## Unreleased\n\n## [0.2.0] - 2026-10-01\n\n- Added the thing.");
    expect(changelogEntry(next, "0.2.0")).toBe("- Added the thing.");
    expect(changelogEntry(next, "0.1.0")).toBe("- First release.");
  });

  it("refuses an empty Unreleased section", () => {
    const empty = CHANGELOG.replace("- Added the thing.\n", "");
    expect(() => dateUnreleased(empty, "0.2.0", "2026-10-01")).toThrow(ReleaseError);
  });

  it("refuses a changelog without an Unreleased section", () => {
    expect(() => dateUnreleased("# Changelog\n", "0.2.0", "2026-10-01")).toThrow(/no "## Unreleased"/);
  });
});

describe("pointReadme", () => {
  it("replaces pinned tags and the placeholder", () => {
    const readme = "npm install github:thesnug/color-picker#v0.1.0\n\"github:thesnug/color-picker#vX.Y.Z\"";
    expect(pointReadme(readme, "0.2.0")).toBe(
      "npm install github:thesnug/color-picker#v0.2.0\n\"github:thesnug/color-picker#v0.2.0\"",
    );
  });
});

describe("parseArgs", () => {
  it("accepts a command and a version with or without a leading v", () => {
    expect(parseArgs(["tag", "v0.1.0"])).toEqual({ command: "tag", version: "0.1.0", push: true, pushExisting: false });
    expect(parseArgs(["prepare", "1.2.3", "--no-push"])).toEqual({
      command: "prepare",
      version: "1.2.3",
      push: false,
      pushExisting: false,
    });
  });

  it("accepts --push-existing for tag only, and not with --no-push", () => {
    expect(parseArgs(["tag", "0.1.0", "--push-existing"])).toEqual({
      command: "tag",
      version: "0.1.0",
      push: true,
      pushExisting: true,
    });
    expect(() => parseArgs(["prepare", "0.1.0", "--push-existing"])).toThrow(/only to tag/);
    expect(() => parseArgs(["tag", "0.1.0", "--push-existing", "--no-push"])).toThrow(/contradict/);
  });

  it("refuses unknown commands, missing versions, and non-versions", () => {
    expect(() => parseArgs(["publish", "0.1.0"])).toThrow(ReleaseError);
    expect(() => parseArgs(["tag"])).toThrow(ReleaseError);
    expect(() => parseArgs(["tag", "0.1"])).toThrow(/not a version/);
    expect(() => parseArgs(["tag", "0.1.0", "extra"])).toThrow(ReleaseError);
    expect(() => parseArgs(["tag", "0.1.0", "--force"])).toThrow(ReleaseError);
  });
});

describe("existingTagAction", () => {
  const head = "a".repeat(40);
  const free: TagState = { local: false, remote: false, parents: [], head };
  const leftover: TagState = { local: true, remote: false, parents: [head], head };

  it("creates the tag when it exists nowhere", () => {
    expect(existingTagAction("v0.1.0", free, false)).toBe("create");
  });

  it("refuses a tag that exists on origin, with or without --push-existing", () => {
    for (const pushExisting of [false, true]) {
      expect(() => existingTagAction("v0.1.0", { ...leftover, remote: true }, pushExisting)).toThrow(
        "v0.1.0 already exists on origin.",
      );
      expect(() => existingTagAction("v0.1.0", { ...free, remote: true }, pushExisting)).toThrow(/on origin/);
    }
  });

  it("pushes a local-only tag on main's HEAD when asked", () => {
    expect(existingTagAction("v0.1.0", leftover, true)).toBe("push");
  });

  it("refuses a local-only tag without --push-existing and names the flag and the delete command", () => {
    expect(() => existingTagAction("v0.1.0", leftover, false)).toThrow(
      /exists locally but not on origin.*tag 0\.1\.0 --push-existing.*git tag -d v0\.1\.0/,
    );
  });

  it("refuses a local tag whose commit is not a child of HEAD", () => {
    const stale = { ...leftover, parents: ["b".repeat(40)] };
    const merge = { ...leftover, parents: [head, "b".repeat(40)] };
    const root = { ...leftover, parents: [] };
    for (const state of [stale, merge, root]) {
      for (const pushExisting of [false, true]) {
        expect(() => existingTagAction("v0.1.0", state, pushExisting)).toThrow(/not a release commit.*git tag -d v0\.1\.0/);
      }
    }
  });

  it("refuses --push-existing when there is no local tag", () => {
    expect(() => existingTagAction("v0.1.0", free, true)).toThrow(/no local v0\.1\.0/);
  });
});

describe("pushFailureMessage", () => {
  it("says where the tag is and gives the commands to push or delete it", () => {
    const message = pushFailureMessage("v0.1.0");
    expect(message).toContain("v0.1.0 exists locally but not on origin.");
    expect(message).toContain("git push origin refs/tags/v0.1.0");
    expect(message).toContain("npm run release -- tag 0.1.0 --push-existing");
    expect(message).toContain("git tag -d v0.1.0");
  });
});
