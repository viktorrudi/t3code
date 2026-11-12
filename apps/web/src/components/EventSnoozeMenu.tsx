import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { create } from "zustand";
import {
  eventSnoozeAllowed,
  ThreadSnoozeCondition,
  type ThreadSnoozeChoice,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { MessageSquareTextIcon } from "lucide-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { serverEnvironment } from "../state/server";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { PullRequestGlyph } from "./pullRequest/pullRequestIcons";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { MenuItem, MenuSeparator } from "./ui/menu";
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogPanel } from "./ui/dialog";

const isSnoozeCondition = Schema.is(ThreadSnoozeCondition);

type Project = { readonly id: string; readonly title: string } | null;
type Thread = Pick<EnvironmentThreadShell, "environmentId" | "pullRequests" | "title">;

export function hasEventSnoozeOptions(thread: Thread, project: Project): boolean {
  const settings = appAtomRegistry.get(serverEnvironment.settingsValueAtom(thread.environmentId));
  const config = appAtomRegistry.get(serverEnvironment.configValueAtom(thread.environmentId));
  if (config?.environment.capabilities.threadEventSnooze !== true) return false;
  return (
    project !== null &&
    settings?.eventSnoozeRules !== undefined &&
    (eventSnoozeAllowed(settings.eventSnoozeRules, project, "jira") ||
      eventSnoozeAllowed(settings.eventSnoozeRules, project, "pull-request"))
  );
}

function EventSnoozeFields(props: {
  thread: Thread;
  project: Project;
  onChoose: (choice: ThreadSnoozeChoice) => void;
  menu?: boolean;
}) {
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(props.thread.environmentId));
  const [ticket, setTicket] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const rules = settings?.eventSnoozeRules;
  if (props.project === null || rules === undefined) return null;
  const jira = eventSnoozeAllowed(rules, props.project, "jira");
  const pullRequest = eventSnoozeAllowed(rules, props.project, "pull-request");
  const links = pullRequest
    ? props.thread.pullRequests.filter((link) => link.source !== "stack-dismissed")
    : [];
  const condition = { kind: "jira" as const, issueKey: ticket.trim().toUpperCase() };
  const valid = isSnoozeCondition(condition);
  const configured = Boolean(settings?.jiraSnooze?.email && settings?.jiraSnooze?.apiToken);
  return (
    <>
      {links.map((link) => {
        const choice = {
          snoozeCondition: {
            kind: "pull-request" as const,
            pullRequest: { host: link.host, repository: link.repository, number: link.number },
          },
        };
        const content = (
          <>
            <PullRequestGlyph.pullRequest aria-hidden className="size-3.5 shrink-0" />
            <span>Until a PR approval or comment · #{link.number}</span>
          </>
        );
        return props.menu ? (
          <MenuItem
            key={link.url}
            onClick={(event) => {
              event.stopPropagation();
              props.onChoose(choice);
            }}
          >
            {content}
          </MenuItem>
        ) : (
          <Button key={link.url} variant="outline" onClick={() => props.onChoose(choice)}>
            {content}
          </Button>
        );
      })}
      {pullRequest && links.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          Link a PR to wait for approval or a comment.
        </p>
      ) : null}
      {jira ? (
        <>
          {props.menu ? <MenuSeparator /> : null}
          <form
            className="flex flex-col gap-2 px-2 py-1"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              setSubmitted(true);
              if (valid && configured) props.onChoose({ snoozeCondition: condition });
            }}
          >
            <label
              className="flex items-center gap-2 text-xs"
              htmlFor={`jira-snooze-${props.menu ? "menu" : "dialog"}`}
            >
              <MessageSquareTextIcon aria-hidden className="size-3.5" />
              Until a Jira comment
            </label>
            <div className="flex items-center gap-2">
              <Input
                id={`jira-snooze-${props.menu ? "menu" : "dialog"}`}
                size="compact"
                placeholder="RET-1234"
                aria-label="Jira ticket"
                value={ticket}
                onValueChange={setTicket}
                aria-invalid={submitted && !valid}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") event.stopPropagation();
                }}
              />
              <Button
                type="submit"
                aria-label="Snooze until a Jira comment"
                size="sm"
                variant="outline"
                disabled={!configured}
              >
                Snooze
              </Button>
            </div>
            {submitted && !valid ? (
              <p role="alert" className="text-xs text-destructive">
                Enter a ticket key, such as RET-1234.
              </p>
            ) : null}
            {!configured ? (
              <p className="text-xs text-muted-foreground">
                Set up the Jira connection in Settings → Snooze.
              </p>
            ) : null}
          </form>
        </>
      ) : null}
    </>
  );
}

export function EventSnoozeMenuItems(props: {
  thread: Thread;
  project: Project;
  onChoose: (choice: ThreadSnoozeChoice) => void;
}) {
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(props.thread.environmentId));
  const config = useAtomValue(serverEnvironment.configValueAtom(props.thread.environmentId));
  const rules =
    config?.environment.capabilities.threadEventSnooze === true
      ? settings?.eventSnoozeRules
      : undefined;
  const allowed =
    props.project !== null &&
    rules !== undefined &&
    (eventSnoozeAllowed(rules, props.project, "jira") ||
      eventSnoozeAllowed(rules, props.project, "pull-request"));
  return allowed ? (
    <>
      <MenuSeparator />
      <EventSnoozeFields {...props} menu />
    </>
  ) : null;
}

type Request = {
  thread: Thread;
  project: Project;
  resolve: (choice: ThreadSnoozeChoice | null) => void;
};
const useRequest = create<{ request: Request | null }>(() => ({ request: null }));
export function requestEventSnooze(
  thread: Thread,
  project: Project,
): Promise<ThreadSnoozeChoice | null> {
  useRequest.getState().request?.resolve(null);
  return new Promise((resolve) => useRequest.setState({ request: { thread, project, resolve } }));
}
function finish(choice: ThreadSnoozeChoice | null) {
  const { request } = useRequest.getState();
  useRequest.setState({ request: null });
  request?.resolve(choice);
}
export function EventSnoozeDialogHost() {
  const { request } = useRequest();
  return request === null ? null : (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) finish(null);
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Wait for an event</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-3">
            <EventSnoozeFields
              thread={request.thread}
              project={request.project}
              onChoose={finish}
            />
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
