import { describe, expect, test } from "vitest";
import { shouldShowProjectConfiguration } from "./project-settings-screen-policy";

describe("project settings protocol correction intent", () => {
  test("shows only Workspace Protocol settings when redirected from role admission", () => {
    expect(shouldShowProjectConfiguration("/repo/worktree")).toBe(false);
  });

  test("keeps ordinary project configuration visible for normal project settings", () => {
    expect(shouldShowProjectConfiguration(undefined)).toBe(true);
    expect(shouldShowProjectConfiguration(" ")).toBe(true);
  });
});
