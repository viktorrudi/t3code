import { useAtomValue } from "@effect/atom-react";
import {
  IssueTrackerKind,
  SENSONEO_JIRA_HOST,
  type EnvironmentId,
  type ProjectId,
  type ThreadId,
  type ThreadTicket,
} from "@t3tools/contracts";
import { Link2Icon, Link2OffIcon, SearchIcon } from "lucide-react";
import { T, useGT } from "gt-react";
import { useState } from "react";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useServerConfigs, useProjects, useThreadShell } from "~/state/entities";
import { issueEnvironment, refreshIssueLists, useIssueList } from "~/state/issues";
import { useDebouncedValue } from "~/state/queries";
import { setJiraTicketLink } from "~/state/threadTickets";
import { useAtomCommand } from "~/state/use-atom-command";

import { Button } from "../ui/button";
import { Command, CommandInput, CommandItem, CommandList } from "../ui/command";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const JiraTracker = IssueTrackerKind.make("jira");

export function JiraTicketPicker({
  environmentId,
  threadId,
  tickets,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  tickets: readonly ThreadTicket[];
}) {
  const gt = useGT();
  const configs = useServerConfigs();
  const projects = useProjects();
  const thread = useThreadShell({ environmentId, threadId });
  const canLink = useAtomValue(setJiraTicketLink.permissionAtom(environmentId));
  const [open, setOpen] = useState(false);
  const project = projects.find(
    (candidate) => candidate.environmentId === environmentId && candidate.id === thread?.projectId,
  );
  if (
    !canLink ||
    configs.get(environmentId)?.environment.capabilities.jiraThreadLinks !== true ||
    !project ||
    !/\/sensoneo\/(?:frontend|test-composer\/test-composer)\/?$/u.test(project.workspaceRoot)
  )
    return null;
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={gt("Link Jira ticket")}
              onClick={() => setOpen(true)}
            />
          }
        >
          <Link2Icon aria-hidden />
        </TooltipTrigger>
        <TooltipPopup>
          <T>Link Jira ticket</T>
        </TooltipPopup>
      </Tooltip>
      {open ? (
        <Dialog open onOpenChange={setOpen}>
          <DialogPopup className="max-w-md" showCloseButton={false}>
            <DialogTitle className="sr-only">
              <T>Link Jira ticket</T>
            </DialogTitle>
            <JiraTicketSearch
              environmentId={environmentId}
              projectId={project.id}
              threadId={threadId}
              tickets={tickets}
              onLinked={() => setOpen(false)}
            />
          </DialogPopup>
        </Dialog>
      ) : null}
    </>
  );
}

function JiraTicketSearch({
  environmentId,
  projectId,
  threadId,
  tickets,
  onLinked,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  threadId: ThreadId;
  tickets: readonly ThreadTicket[];
  onLinked: () => void;
}) {
  const gt = useGT();
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);
  const [pending, setPending] = useState(false);
  const search = useDebouncedValue(query.trim(), 300);
  const changeLink = useAtomCommand(setJiraTicketLink, { reportFailure: false });
  const list = useIssueList([
    {
      environmentId,
      input: {
        projectId,
        host: SENSONEO_JIRA_HOST,
        involvement: all ? "all" : "assigned",
        state: all ? "all" : "open",
        ...(search.length ? { query: search } : {}),
        limit: 25,
      },
    },
  ]);
  const answer = list.answers[0]?.[1];
  const answers = answer?.entries ?? [];
  const trackerError = answer?.trackers.find((tracker) => !tracker.configured)?.detail;
  const error = list.error ?? trackerError ?? answer?.errors[0]?.message;
  const link = async (key: string, linked: boolean) => {
    if (pending) return;
    setPending(true);
    const result = await changeLink({ environmentId, input: { threadId, key, linked } });
    setPending(false);
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: linked ? gt("Could not link the issue") : gt("Could not unlink the issue"),
      });
      return;
    }
    if (!result.value.annotationsRefreshed) {
      toastManager.add({
        type: "warning",
        title: gt("Link saved. Chat badges could not be refreshed."),
      });
    }
    refreshIssueLists(environmentId);
    appAtomRegistry.refresh(
      issueEnvironment.linkedThreads({
        environmentId,
        input: {
          tracker: JiraTracker,
          host: SENSONEO_JIRA_HOST,
          scope: key.split("-")[0] ?? "",
          key,
        },
      }),
    );
    onLinked();
  };
  return (
    <Command mode="none" value={query} onValueChange={setQuery} aria-label={gt("Link Jira ticket")}>
      <CommandInput placeholder={gt("Search Jira by key or title")} disabled={pending} />
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        <Button
          size="xs"
          variant={all ? "ghost" : "secondary"}
          aria-pressed={!all}
          onClick={() => setAll(false)}
        >
          <T>Assigned to me</T>
        </Button>
        <Button
          size="xs"
          variant={all ? "secondary" : "ghost"}
          aria-pressed={all}
          onClick={() => setAll(true)}
        >
          <SearchIcon aria-hidden /> <T>Search Jira</T>
        </Button>
      </div>
      <CommandList className="max-h-80 overflow-y-auto">
        {error ? (
          <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
            <span>{error}</span>
            <Button size="xs" variant="outline" onClick={list.retry}>
              <T>Retry</T>
            </Button>
          </div>
        ) : null}
        {list.isPending && answers.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            <T>Loading…</T>
          </p>
        ) : null}
        {!list.isPending && !error && answers.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            <T>No tickets under these filters.</T>
          </p>
        ) : null}
        {tickets
          .filter((ticket) => !query && !answers.some((issue) => issue.key === ticket.key))
          .map((ticket) => (
            <CommandItem
              key={ticket.key}
              value={ticket.key}
              disabled={pending}
              onClick={() => void link(ticket.key, false)}
            >
              <Link2OffIcon aria-hidden />
              <span className="flex-1">{ticket.key}</span>
              <T>Unlink</T>
            </CommandItem>
          ))}
        {answers.map((issue) => {
          const linked = tickets.some((ticket) => ticket.key === issue.key);
          return (
            <CommandItem
              key={issue.key}
              value={issue.key}
              disabled={pending}
              onClick={() => void link(issue.key, !linked)}
            >
              {linked ? <Link2OffIcon aria-hidden /> : <Link2Icon aria-hidden />}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{issue.title}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {issue.key} · {issue.state.name}
                  {issue.assignees[0]?.name ? ` · ${issue.assignees[0].name}` : ""}
                </span>
              </span>
              {linked ? <T>Unlink</T> : null}
            </CommandItem>
          );
        })}
      </CommandList>
    </Command>
  );
}
