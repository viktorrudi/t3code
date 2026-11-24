import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, IssueDetail, IssueRef, ThreadId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  Link2Icon,
  Link2OffIcon,
  MessageSquareIcon,
} from "lucide-react";
import { T, useGT } from "gt-react";
import { useState } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { issueEnvironment, refreshIssueLists } from "~/state/issues";
import { useEnvironmentQuery } from "~/state/query";
import { useProjects } from "~/state/entities";
import { setJiraTicketLink } from "~/state/threadTickets";
import { useAtomCommand } from "~/state/use-atom-command";

import { ThreadLinkPicker } from "../ThreadLinkPicker";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { toastManager } from "../ui/toast";
import { JiraIssueWork } from "./JiraIssueWork";

export function JiraIssueDetail({
  environmentId,
  issue,
  reference,
  onRefresh,
}: {
  environmentId: EnvironmentId;
  issue: IssueDetail;
  reference: IssueRef;
  onRefresh: () => void;
}) {
  const gt = useGT();
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const changeLink = useAtomCommand(setJiraTicketLink, { reportFailure: false });
  const canLink = useAtomValue(setJiraTicketLink.permissionAtom(environmentId));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const related = useEnvironmentQuery(
    issueEnvironment.linkedThreads({
      environmentId,
      input: { tracker: issue.tracker, host: issue.host, scope: issue.scope, key: issue.key },
    }),
  );
  const threads = related.data?.threads ?? [];
  const projects = useProjects();
  const projectIds =
    issue.scope === "FED"
      ? projects
          .filter(
            (project) =>
              project.environmentId === environmentId &&
              /\/sensoneo\/(?:frontend|test-composer\/test-composer)\/?$/u.test(
                project.workspaceRoot,
              ),
          )
          .map((project) => project.id)
      : [reference.projectId];

  const setLink = async (threadId: ThreadId, linked: boolean) => {
    if (pending) return;
    setPending(true);
    const result = await changeLink({ environmentId, input: { threadId, key: issue.key, linked } });
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
    related.refresh();
    onRefresh();
    refreshIssueLists(environmentId);
    setPickerOpen(false);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="space-y-4 px-4 py-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium">{issue.displayKey}</span>
            <Badge size="sm" variant={issue.state.category === "closed" ? "success" : "secondary"}>
              {issue.state.name}
            </Badge>
            {issue.assignees.map((actor) => (
              <span key={actor.login}>{actor.name ?? actor.login}</span>
            ))}
          </div>
          <h2 className="text-base font-semibold leading-snug">{issue.title}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              render={<a href={issue.url} target="_blank" rel="noopener noreferrer" />}
            >
              <ExternalLinkIcon aria-hidden />
              <T>Open in Jira</T>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => copyToClipboard(`/ticket ${issue.key}`, undefined)}
            >
              {isCopied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
              {isCopied ? <T>Copied</T> : <T>Copy /ticket</T>}
            </Button>
          </div>
        </div>
        {issue.jiraWork ? (
          <div className="border-y border-border py-3">
            <JiraIssueWork
              environmentId={environmentId}
              ticketKey={issue.key}
              work={issue.jiraWork}
              extraPullRequests={related.data?.jiraPullRequests ?? []}
            />
          </div>
        ) : null}
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">
              <T>Linked chats</T>
            </h3>
            {canLink ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setPickerOpen(true)}
                disabled={pending}
              >
                <Link2Icon aria-hidden /> <T>Link chat</T>
              </Button>
            ) : null}
          </div>
          {related.error ? (
            <Button size="xs" variant="ghost" onClick={related.refresh}>
              <T>Retry</T>
            </Button>
          ) : threads.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {related.isPending ? gt("Loading…") : gt("No linked chats yet.")}
            </p>
          ) : (
            threads.map((thread) => (
              <div key={thread.id} className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  render={
                    <Link
                      to="/$environmentId/$threadId"
                      params={{ environmentId, threadId: thread.id }}
                    />
                  }
                >
                  <MessageSquareIcon aria-hidden />
                  <span className="min-w-0 max-w-64 truncate">
                    {thread.title || gt("Untitled thread")}
                  </span>
                  {thread.archivedAt !== null ? (
                    <Badge size="sm" variant="secondary">
                      <T>Archived thread</T>
                    </Badge>
                  ) : null}
                </Button>
                {canLink ? (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={gt("Unlink chat {title}", {
                      title: thread.title || gt("Untitled thread"),
                    })}
                    disabled={pending}
                    onClick={() => void setLink(thread.id, false)}
                  >
                    <Link2OffIcon aria-hidden />
                  </Button>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
      {pickerOpen ? (
        <Dialog open onOpenChange={setPickerOpen}>
          <DialogPopup showCloseButton={false} className="max-w-md">
            <DialogTitle className="sr-only">
              <T>Link issue to a thread</T>
            </DialogTitle>
            <ThreadLinkPicker
              environmentId={environmentId}
              projectIds={projectIds}
              pending={pending}
              isLinked={(thread) => threads.some((linked) => linked.id === thread.id)}
              onSelect={(threadId) => void setLink(threadId, true)}
            />
          </DialogPopup>
        </Dialog>
      ) : null}
    </div>
  );
}
