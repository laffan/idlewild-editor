/**
 * The iOS linker patch, against the two files it edits.
 *
 * This script is the one piece of this repository that cannot be checked by
 * running it: `src-tauri/gen/apple` only exists on a Mac that has run
 * `tauri ios init`, and what it edits is a generated file nobody reads. Both
 * halves fail silently in the way that matters — a pbxproj rebuilt slightly
 * wrong is a project Xcode refuses to open, and a patch that matches nothing
 * is a build that fails exactly as it did before.
 *
 * So the fixtures below are cargo-mobile2's template as XcodeGen renders it:
 * the iOS target's two configurations, and a project-level one that must be
 * left alone.
 *
 * Plain JavaScript, like the script it covers: `scripts/` is inside this
 * project's `tsconfig` and the app's `lib` is the browser's, so a TypeScript
 * file here could not import `node:fs` without putting node's types over the
 * whole front end to test a build script.
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  withLinkerFlagsPbxproj,
  withLinkerFlagsYml,
} from "../patch-ios-linker.mjs";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "patch-ios-linker.mjs",
);

/**
 * Tauri's own iOS target, verbatim from a generated project — not
 * cargo-mobile2's, which is a different file that disagrees about exactly the
 * settings this script anchors on.
 */
const YML = `name: idlewild-editor
options:
  bundleIdPrefix: com.idlewild.editor
configs:
  debug: debug
  release: release
settingGroups:
  app:
    base:
      PRODUCT_NAME: Idlewild
      PRODUCT_BUNDLE_IDENTIFIER: com.idlewild.editor
targets:
  idlewild-editor_iOS:
    type: application
    platform: iOS
    info:
      path: idlewild-editor_iOS/Info.plist
    settings:
      base:
        ENABLE_BITCODE: false
        ARCHS: [arm64]
        VALID_ARCHS: arm64 
        LIBRARY_SEARCH_PATHS[arch=x86_64]: $(inherited) $(PROJECT_DIR)/Externals/x86_64/$(CONFIGURATION)
        LIBRARY_SEARCH_PATHS[arch=arm64]: $(inherited) $(PROJECT_DIR)/Externals/arm64/$(CONFIGURATION)
        ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES: true
        EXCLUDED_ARCHS[sdk=iphoneos*]: x86_64
      groups: [app]
`;

/**
 * The same target as XcodeGen renders it: the app's two configurations, and
 * one of the project's own, which must be left alone.
 */
const PBXPROJ = `// !$*UTF8*$!
{
	objects = {

/* Begin XCBuildConfiguration section */
		1A0000012B /* debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES = YES;
				ARCHS = arm64;
				ENABLE_BITCODE = NO;
				"EXCLUDED_ARCHS[sdk=iphoneos*]" = x86_64;
				INFOPLIST_FILE = "idlewild-editor_iOS/Info.plist";
				"LIBRARY_SEARCH_PATHS[arch=arm64]" = "$(inherited) $(PROJECT_DIR)/Externals/arm64/$(CONFIGURATION)";
				"LIBRARY_SEARCH_PATHS[arch=x86_64]" = "$(inherited) $(PROJECT_DIR)/Externals/x86_64/$(CONFIGURATION)";
				PRODUCT_BUNDLE_IDENTIFIER = com.idlewild.editor;
				PRODUCT_NAME = Idlewild;
				VALID_ARCHS = arm64;
			};
			name = debug;
		};
		1A0000022B /* release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES = YES;
				ARCHS = arm64;
				INFOPLIST_FILE = "idlewild-editor_iOS/Info.plist";
				"LIBRARY_SEARCH_PATHS[arch=arm64]" = "$(inherited) $(PROJECT_DIR)/Externals/arm64/$(CONFIGURATION)";
				PRODUCT_NAME = Idlewild;
			};
			name = release;
		};
		1A0000032B /* debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				ONLY_ACTIVE_ARCH = YES;
				SDKROOT = iphoneos;
			};
			name = debug;
		};
/* End XCBuildConfiguration section */
	};
}
`;

/**
 * cargo-mobile2's key for the same setting. Tauri does not use this template,
 * but the two have already diverged once here and matching the stem rather
 * than a bracketed variant is what makes that survivable.
 */
const PBXPROJ_CARGO_MOBILE = PBXPROJ.replaceAll(
  "LIBRARY_SEARCH_PATHS[arch=arm64]",
  "LIBRARY_SEARCH_PATHS[sdk=iphoneos*]",
);

describe("the XcodeGen source", () => {
  it("adds the flags to the iOS target's own settings", () => {
    const out = withLinkerFlagsYml(YML);
    expect(out).toContain(`OTHER_LDFLAGS: "$(inherited) -lz -liconv"`);
    // Inside settings.base, at the same indent as the line it follows.
    expect(out).toContain(
      `        ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES: true\n        OTHER_LDFLAGS:`,
    );
  });

  it("is a no-op the second time", () => {
    const once = withLinkerFlagsYml(YML);
    expect(withLinkerFlagsYml(once)).toBe(once);
  });

  it("says so rather than guessing when the anchor has moved", () => {
    expect(withLinkerFlagsYml("name: something-else\n")).toBeNull();
  });
});

describe("the Xcode project", () => {
  it("gives the flags to both of the app target's configurations", () => {
    const { text, added } = withLinkerFlagsPbxproj(PBXPROJ);
    expect(added).toBe(2);
    expect(text.match(/OTHER_LDFLAGS/g)).toHaveLength(2);
    expect(text).toContain(`OTHER_LDFLAGS = "$(inherited) -lz -liconv";`);
  });

  /**
   * The regression this file exists for. The first version of this script
   * anchored on `LIBRARY_SEARCH_PATHS[sdk=iphoneos*]`, which is
   * cargo-mobile2's spelling — Tauri ships its own template and writes
   * `[arch=arm64]`. Nothing matched, project.yml was patched and reported as a
   * success, and the build failed on the same linker error as before.
   */
  it("matches whichever library-search-path key the template writes", () => {
    expect(withLinkerFlagsPbxproj(PBXPROJ_CARGO_MOBILE).added).toBe(2);
  });

  /**
   * The project-level configuration is not one the app is built from, and a
   * linker flag on it would be a setting nobody can explain later.
   */
  it("leaves a configuration without the iOS search path alone", () => {
    const { text } = withLinkerFlagsPbxproj(PBXPROJ);
    const project = text.slice(text.indexOf("1A0000032B"));
    expect(project).not.toContain("OTHER_LDFLAGS");
  });

  /**
   * The rebuild has to be exact: everything but the inserted lines comes back
   * byte for byte, or the file Xcode opens is not the file XcodeGen wrote.
   */
  it("changes nothing but the lines it adds", () => {
    const { text } = withLinkerFlagsPbxproj(PBXPROJ);
    const stripped = text
      .split("\n")
      .filter((line) => !line.includes("OTHER_LDFLAGS"))
      .join("\n");
    expect(stripped).toBe(PBXPROJ);
  });

  it("is a no-op the second time", () => {
    const once = withLinkerFlagsPbxproj(PBXPROJ).text;
    const twice = withLinkerFlagsPbxproj(once);
    expect(twice.added).toBe(0);
    expect(twice.text).toBe(once);
  });

  it("leaves a file it cannot make sense of alone", () => {
    const truncated = PBXPROJ.slice(0, PBXPROJ.indexOf("ALWAYS_EMBED"));
    const { text, added } = withLinkerFlagsPbxproj(truncated);
    expect(added).toBe(0);
    expect(text).toBe(truncated);
  });

  /**
   * Recognising nothing has to be distinguishable from having nothing to do,
   * because the first is the script quietly not working and the second is a
   * second build. `seen` is what tells them apart, and the warning hangs off
   * it.
   */
  it("says whether it recognised the target at all", () => {
    const none = withLinkerFlagsPbxproj(`// !$*UTF8*$!
{
	objects = {
		1A00000B2B /* debug */ = {
			buildSettings = {
				SDKROOT = iphoneos;
			};
			name = debug;
		};
	};
}
`);
    expect(none.added).toBe(0);
    expect(none.seen).toBe(0);

    const already = withLinkerFlagsPbxproj(withLinkerFlagsPbxproj(PBXPROJ).text);
    expect(already.added).toBe(0);
    expect(already.seen).toBe(2);
  });
});

describe("run as a program", () => {
  it("patches both files under a project root it is pointed at", () => {
    const root = mkdtempSync(join(tmpdir(), "ios-linker-"));
    const apple = join(root, "src-tauri", "gen", "apple");
    mkdirSync(join(apple, "idlewild-editor.xcodeproj"), { recursive: true });
    writeFileSync(join(apple, "project.yml"), YML);
    writeFileSync(
      join(apple, "idlewild-editor.xcodeproj", "project.pbxproj"),
      PBXPROJ,
    );

    const say = execFileSync("node", [SCRIPT, root], { encoding: "utf-8" });
    expect(say).toContain("project.yml");
    expect(say).toContain("×2");

    expect(readFileSync(join(apple, "project.yml"), "utf-8")).toContain(
      "OTHER_LDFLAGS",
    );
    expect(
      readFileSync(
        join(apple, "idlewild-editor.xcodeproj", "project.pbxproj"),
        "utf-8",
      ),
    ).toContain(`OTHER_LDFLAGS = "$(inherited) -lz -liconv";`);

    // And again, on the files it has already patched.
    expect(execFileSync("node", [SCRIPT, root], { encoding: "utf-8" })).toBe("");
  });

  it("exits quietly where there is no iOS project", () => {
    const root = mkdtempSync(join(tmpdir(), "ios-linker-none-"));
    expect(execFileSync("node", [SCRIPT, root], { encoding: "utf-8" })).toBe("");
  });
});
