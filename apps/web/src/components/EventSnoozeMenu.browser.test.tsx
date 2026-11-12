import "../index.css";
import { DEFAULT_SERVER_SETTINGS, EnvironmentId, type ServerSettings } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../test/render";
import { EventSnoozeMenuItems } from "./EventSnoozeMenu";
import { Menu, MenuPopup, MenuTrigger } from "./ui/menu";

const state = vi.hoisted(() => ({ settings: null as ServerSettings | null, enabled: true }));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (key: string) =>
    key === "config"
      ? { environment: { capabilities: { threadEventSnooze: state.enabled } } }
      : state.settings,
}));
vi.mock("../state/server", () => ({
  serverEnvironment: { settingsValueAtom: () => "settings", configValueAtom: () => "config" },
}));
vi.mock("../rpc/atomRegistry", () => ({
  appAtomRegistry: {
    get: (key: string) =>
      key === "config"
        ? { environment: { capabilities: { threadEventSnooze: state.enabled } } }
        : state.settings,
  },
}));

function setup() {
  state.enabled = true;
  state.settings = {
    ...DEFAULT_SERVER_SETTINGS,
    jiraSnooze: {
      baseUrl: "https://jira.example.test",
      email: "person@example.test",
      apiToken: "redacted-fixture",
    },
  };
  return {
    thread: {
      environmentId: EnvironmentId.make("environment"),
      title: "Review change",
      pullRequests: [
        {
          host: "github.com",
          repository: "acme/app",
          number: 12,
          url: "https://github.com/acme/app/pull/12",
          source: "manual" as const,
          linkedAt: "2026-11-12T09:00:00Z",
          snapshot: null,
          stack: null,
        },
      ],
    },
  };
}

it("keeps the Jira field editable inside the menu and submits a normalized ticket", async () => {
  const { thread } = setup();
  const choose = vi.fn();
  await using screen = await render(
    <Menu>
      <MenuTrigger>Snooze</MenuTrigger>
      <MenuPopup>
        <EventSnoozeMenuItems
          thread={thread}
          project={{ id: "project", title: "Sensoneo" }}
          onChoose={choose}
        />
      </MenuPopup>
    </Menu>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Snooze" }));
  await userEvent.click(page.getByRole("button", { name: "Snooze until a Jira comment" }));
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("Enter a ticket key, such as RET-1234.");
  await userEvent.fill(page.getByRole("textbox", { name: "Jira ticket" }), "ret-1234");
  await userEvent.keyboard("{Enter}");
  expect(choose).toHaveBeenCalledExactlyOnceWith({
    snoozeCondition: { kind: "jira", issueKey: "RET-1234" },
  });
});

it("chooses a linked PR and omits event controls for other projects", async () => {
  const { thread } = setup();
  const choose = vi.fn();
  const menu = (title: string) => (
    <Menu>
      <MenuTrigger>Snooze</MenuTrigger>
      <MenuPopup>
        <EventSnoozeMenuItems
          thread={thread}
          project={{ id: "project", title }}
          onChoose={choose}
        />
      </MenuPopup>
    </Menu>
  );
  await using screen = await render(menu("Sensoneo"));
  await userEvent.click(screen.getByRole("button", { name: "Snooze" }));
  await userEvent.click(
    page.getByRole("menuitem", { name: "Until a PR approval or comment · #12" }),
  );
  expect(choose).toHaveBeenCalledExactlyOnceWith({
    snoozeCondition: {
      kind: "pull-request",
      pullRequest: { host: "github.com", repository: "acme/app", number: 12 },
    },
  });
  await screen.rerender(menu("Other"));
  await userEvent.click(screen.getByRole("button", { name: "Snooze" }));
  await expect.element(page.getByRole("textbox", { name: "Jira ticket" })).not.toBeInTheDocument();
});
