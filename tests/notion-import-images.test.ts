import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { countMissingImages } from "@/lib/services/notion-import/runner";

// Stage 12.2 (adversarial finding): the import image resolver must not let a
// traversing/absolute markdown image path — `![x](../../etc/logo.png)` or
// `/home/other/photo.png` — resolve to a file OUTSIDE the export root. copyImages
// would otherwise copy that file into public/media/import (world-readable). We
// exercise the guard through countMissingImages (same resolver, filesystem-read
// only, no write to the real public dir): an escaping ref must count as missing
// unless a same-named file legitimately exists under the provided image dir.

const base = fs.mkdtempSync(path.join(os.tmpdir(), "mentors-imgtest-"));
const root = path.join(base, "root");
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, "logo.png"), "ok");
fs.writeFileSync(path.join(base, "secret.png"), "secret"); // OUTSIDE root

afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

describe("import image resolver — path containment (spec 11 / stage 12.2)", () => {
  it("a legit image inside the root resolves (not missing)", () => {
    expect(
      countMissingImages(
        [{ originalDecodedPath: "logo.png", normalizedName: "logo.png" }],
        root,
        new Map(),
      ),
    ).toBe(0);
  });

  it("a ../ traversal to an existing outside file is treated as missing", () => {
    expect(
      countMissingImages(
        [{ originalDecodedPath: "../secret.png", normalizedName: "x.png" }],
        root,
        new Map(),
      ),
    ).toBe(1);
  });

  it("an absolute path to an existing outside file is treated as missing", () => {
    expect(
      countMissingImages(
        [{ originalDecodedPath: path.join(base, "secret.png"), normalizedName: "x.png" }],
        root,
        new Map(),
      ),
    ).toBe(1);
  });

  it("basename fallback still resolves a same-named file under the provided dir", () => {
    const map = new Map([["logo.png", path.join(root, "logo.png")]]);
    expect(
      countMissingImages(
        [{ originalDecodedPath: "../logo.png", normalizedName: "x.png" }],
        root,
        map,
      ),
    ).toBe(0);
  });
});
