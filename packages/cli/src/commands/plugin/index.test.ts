import { beforeEach, describe, expect, it, vi } from "vitest";

const listPlugins = vi.fn(async () => []);
const installDirectoryPlugin = vi.fn(async () => ({ id: "example" }));
const reloadPlugin = vi.fn(async () => ({ id: "example" }));
const enablePlugin = vi.fn(async () => ({ id: "example" }));
const disablePlugin = vi.fn(async () => ({ id: "example" }));
const removePlugin = vi.fn(async () => undefined);
const getPluginLogs = vi.fn(async () => [
  {
    sequence: 1,
    timestamp: "2026-08-16T12:00:00.000Z",
    stream: "stdout" as const,
    message: "ready",
  },
]);
const close = vi.fn(async () => undefined);
const features: { pluginManagement?: boolean; pluginLogs?: boolean } = {};

vi.mock("../../utils/client.js", () => ({
  connectToDaemon: vi.fn(async () => ({
    getLastServerInfoMessage: () => ({ features }),
    listPlugins,
    installDirectoryPlugin,
    reloadPlugin,
    enablePlugin,
    disablePlugin,
    removePlugin,
    getPluginLogs,
    close,
  })),
}));

import { render } from "../../output/index.js";
import {
  assertPluginLifecycleHumanContext,
  runPluginActionCommand,
  runPluginInitCommand,
  runPluginInstallCommand,
  runPluginListCommand,
  runPluginLogsCommand,
  runPluginRemoveCommand,
} from "./index.js";

describe("plugin management commands", () => {
  beforeEach(() => {
    features.pluginManagement = false;
    features.pluginLogs = false;
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("requires host support before attempting a management RPC", async () => {
    await expect(runPluginListCommand({}, {} as never)).rejects.toMatchObject({
      code: "DAEMON_UPDATE_REQUIRED",
      message: "Update the host to use plugin management.",
    });
    expect(listPlugins).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("requires plugin log support before attempting the RPC", async () => {
    await expect(runPluginLogsCommand("example", {}, {} as never)).rejects.toMatchObject({
      code: "DAEMON_UPDATE_REQUIRED",
      message: "Update the host to view plugin logs.",
    });
    expect(getPluginLogs).not.toHaveBeenCalled();
  });

  it("returns readable and JSON plugin log output", async () => {
    features.pluginLogs = true;
    const result = await runPluginLogsCommand("example", {}, {} as never);

    expect(getPluginLogs).toHaveBeenCalledWith("example");
    expect(render(result, { noColor: true })).toContain("ready");
    expect(JSON.parse(render(result, { format: "json" }))).toEqual([
      {
        sequence: 1,
        timestamp: "2026-08-16T12:00:00.000Z",
        stream: "stdout",
        message: "ready",
      },
    ]);
  });

  it("rejects every mutating lifecycle entry point for a Paseo agent", async () => {
    vi.stubEnv("PASEO_AGENT_ID", "agent-123");
    const expected = {
      code: "PLUGIN_LIFECYCLE_HUMAN_REQUIRED",
      message: expect.stringContaining("Human-owned"),
    };

    expect(() => assertPluginLifecycleHumanContext()).toThrow();
    await expect(runPluginInitCommand("/tmp/plugin", {}, {} as never)).rejects.toMatchObject(
      expected,
    );
    await expect(runPluginInstallCommand("/tmp/plugin", {}, {} as never)).rejects.toMatchObject(
      expected,
    );
    for (const action of ["reload", "enable", "disable"] as const) {
      await expect(runPluginActionCommand(action, "example", {})).rejects.toMatchObject(expected);
    }
    await expect(runPluginRemoveCommand("example", {}, {} as never)).rejects.toMatchObject(
      expected,
    );

    expect(installDirectoryPlugin).not.toHaveBeenCalled();
    expect(reloadPlugin).not.toHaveBeenCalled();
    expect(enablePlugin).not.toHaveBeenCalled();
    expect(disablePlugin).not.toHaveBeenCalled();
    expect(removePlugin).not.toHaveBeenCalled();
  });

  it("keeps read-only listing and logs available in agent context", async () => {
    vi.stubEnv("PASEO_AGENT_ID", "agent-123");
    features.pluginManagement = true;
    features.pluginLogs = true;

    await expect(runPluginListCommand({}, {} as never)).resolves.toMatchObject({ type: "list" });
    await expect(runPluginLogsCommand("example", {}, {} as never)).resolves.toMatchObject({
      type: "list",
    });
  });
});
