import { describe, expect, it } from "vitest";
import packageJson from "../package.json";
import { resolveFoundationCliVersion } from "./version.js";

describe("Foundation CLI version", () => {
  it("uses the packaged version instead of a hard-coded release", () => {
    expect(resolveFoundationCliVersion()).toBe(packageJson.version);
  });
});
