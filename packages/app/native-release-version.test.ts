import { describe, expect, it } from "vitest";

const { getNativeReleaseVersion } = require("./native-release-version");

describe("native release version", () => {
  it("reserves the final iOS build slot for a stable release", () => {
    expect(getNativeReleaseVersion("0.2.6")).toEqual({
      appVersion: "0.2.6",
      androidVersionCode: 2006,
      iosBuildNumber: "2006999",
    });
  });

  it("gives each beta a unique iOS build slot under the stable app version", () => {
    expect(getNativeReleaseVersion("0.2.6-beta.2")).toEqual({
      appVersion: "0.2.6",
      androidVersionCode: 2006,
      iosBuildNumber: "2006002",
    });
  });

  it("accepts downstream provenance without changing the upstream native beta slot", () => {
    expect(getNativeReleaseVersion("0.3.0-beta.1.paseo.1")).toEqual({
      appVersion: "0.3.0",
      androidVersionCode: 3000,
      iosBuildNumber: "3000001",
    });
  });

  it("accepts stable downstream provenance without changing the upstream native stable slot", () => {
    expect(getNativeReleaseVersion("0.3.0-paseo.1")).toEqual({
      appVersion: "0.3.0",
      androidVersionCode: 3000,
      iosBuildNumber: "3000999",
    });
  });

  it("rejects a zero downstream revision", () => {
    expect(() => getNativeReleaseVersion("0.3.0-beta.1.paseo.0")).toThrow(
      "Paseo downstream revision must be at least 1",
    );
  });

  it("rejects a zero stable downstream revision", () => {
    expect(() => getNativeReleaseVersion("0.3.0-paseo.0")).toThrow(
      "Paseo downstream revision must be at least 1",
    );
  });

  it("rejects beta numbers that consume the stable iOS build slot", () => {
    expect(() => getNativeReleaseVersion("0.2.6-beta.999")).toThrow(
      "iOS beta number must be between 1 and 998",
    );
  });
});
