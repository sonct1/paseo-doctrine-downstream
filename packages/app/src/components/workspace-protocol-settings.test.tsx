/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { WorkspaceProtocolSettings } from "./workspace-protocol-settings";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const { toastShow } = vi.hoisted(() => ({ toastShow: vi.fn() }));

vi.mock("react-native", () => ({
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("span", null, children),
  TextInput: ({
    value,
    onChangeText,
    testID,
  }: {
    value: string;
    onChangeText: (value: string) => void;
    testID?: string;
  }) =>
    React.createElement("textarea", {
      value,
      "data-testid": testID,
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onChangeText(event.target.value),
    }),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function"
        ? (factory as (theme: unknown) => unknown)({
            spacing: { 4: 16 },
            fontFamily: { mono: "monospace" },
            fontSize: { xs: 11 },
            colors: { foregroundMuted: "#999" },
          })
        : factory,
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/ui/alert", () => ({
  Alert: ({
    children,
    title,
    description,
    testID,
  }: {
    children?: React.ReactNode;
    title?: string;
    description?: string;
    testID?: string;
  }) => React.createElement("section", { "data-testid": testID }, title, description, children),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    disabled,
    testID,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    disabled?: boolean;
    testID?: string;
  }) =>
    React.createElement(
      "button",
      { type: "button", "data-testid": testID, disabled, onClick: onPress },
      children,
    ),
}));

vi.mock("@/components/ui/loading-spinner", () => ({
  LoadingSpinner: () => React.createElement("span", null, "loading"),
}));

vi.mock("@/components/settings-textarea", () => ({
  SettingsTextAreaCard: ({
    value,
    onChangeText,
    testID,
  }: {
    value: string;
    onChangeText: (value: string) => void;
    testID?: string;
  }) =>
    React.createElement("textarea", {
      value,
      "data-testid": testID,
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onChangeText(event.target.value),
    }),
}));

vi.mock("@/screens/settings/settings-group", () => ({
  SettingsGroup: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
}));

vi.mock("@/screens/settings/settings-section", () => ({
  SettingsSection: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
}));

vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({ show: toastShow }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function renderComponent(client: unknown, supported = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceProtocolSettings
          client={client as never}
          serverId="server-1"
          repoRoot="/repo/app"
          supported={supported}
        />
      </QueryClientProvider>,
    );
  });
}

describe("WorkspaceProtocolSettings", () => {
  test("does not call an unsupported host and tells the Human to update it", () => {
    const client = { inspectWorkspaceProtocol: vi.fn() };
    renderComponent(client, false);

    expect(client.inspectWorkspaceProtocol).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="workspace-protocol-unsupported"]'),
    ).not.toBeNull();
  });

  test("shows a missing preview and bootstraps it with an explicit Human click", async () => {
    const suggestedContent = "# Workspace Protocol preview";
    const client = {
      inspectWorkspaceProtocol: vi.fn(async () => ({
        requestId: "inspect-1",
        ok: true,
        snapshot: {
          status: "missing",
          repoRoot: "/repo/app",
          path: "/repo/app/WORKSPACE_PROTOCOL.md",
          suggestedContent,
          revision: null,
          issues: [],
        },
      })),
      writeWorkspaceProtocol: vi.fn(async () => ({
        requestId: "write-1",
        ok: true,
        snapshot: {
          status: "valid",
          repoRoot: "/repo/app",
          path: "/repo/app/WORKSPACE_PROTOCOL.md",
          content: suggestedContent,
          revision: { mtimeMs: 1, size: 10, sha256: "a".repeat(64) },
          issues: [],
        },
      })),
    };
    renderComponent(client);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(container.querySelector('[data-testid="workspace-protocol-missing"]')).not.toBeNull();
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="workspace-protocol-save"]',
    );
    expect(button).not.toBeNull();
    await act(async () => button?.click());

    expect(client.writeWorkspaceProtocol).toHaveBeenCalledWith({
      repoRoot: "/repo/app",
      content: suggestedContent,
      expectedRevision: null,
    });
    expect(toastShow).toHaveBeenCalled();
  });

  test("shows validation issues for an existing invalid protocol", async () => {
    const client = {
      inspectWorkspaceProtocol: vi.fn(async () => ({
        requestId: "inspect-invalid",
        ok: true,
        snapshot: {
          status: "invalid",
          repoRoot: "/repo/app",
          path: "/repo/app/WORKSPACE_PROTOCOL.md",
          content: "# Workspace Protocol\n",
          revision: { mtimeMs: 1, size: 21, sha256: "b".repeat(64) },
          issues: ["missing_version_marker", "missing_identity"],
        },
      })),
    };
    renderComponent(client);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const alert = container.querySelector('[data-testid="workspace-protocol-invalid"]');
    expect(alert?.textContent).toContain("missing_version_marker");
    expect(alert?.textContent).toContain("missing_identity");
  });

  test("fails closed when the protocol cannot be read", async () => {
    const client = {
      inspectWorkspaceProtocol: vi.fn(async () => ({
        requestId: "inspect-unreadable",
        ok: true,
        snapshot: {
          status: "unreadable",
          repoRoot: "/repo/app",
          path: "/repo/app/WORKSPACE_PROTOCOL.md",
          revision: null,
          issues: [],
        },
      })),
    };
    renderComponent(client);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(container.querySelector('[data-testid="workspace-protocol-unreadable"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="workspace-protocol-input"]')).toBeNull();
  });
});
