import { useAtomValue } from "@effect/atom-react";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type IssueComment,
  type IssueDetail,
  type IssueRef,
  type JiraIssueTransition,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import {
  BoxesIcon,
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  CornerLeftUpIcon,
  ExternalLinkIcon,
  FlagIcon,
  Link2Icon,
  Link2OffIcon,
  MessageSquareIcon,
  MilestoneIcon,
  PaperclipIcon,
  TagIcon,
  UserRoundIcon,
  UsersIcon,
} from "lucide-react";
import { T, useGT, useMessages, Var } from "gt-react";
import { useState, type ReactNode } from "react";

import { requestConfirmDialog } from "~/confirmDialog";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { formatBytes } from "~/lib/formatBytes";
import { cn } from "~/lib/utils";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useProjects } from "~/state/entities";
import { issueEnvironment, refreshIssueLists } from "~/state/issues";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import { jiraIssueAtom, setJiraTicketLink, transitionJiraIssue } from "~/state/threadTickets";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { ThreadLinkPicker } from "../ThreadLinkPicker";
import { PullRequestCommentBody } from "../pullRequest/PullRequestCommentBody";
import { PullRequestDetailTitleRow } from "../pullRequest/PullRequestDetailLayout";
import { PullRequestMarkdown } from "../pullRequest/PullRequestMarkdown";
import { PullRequestMetaRow, PullRequestSection } from "../pullRequest/PullRequestSummaryTab";
import { PullRequestActorLabel, PullRequestMetaLine } from "../pullRequest/pullRequestPresentation";
import { useChangeJiraTicketLink } from "../threadTickets/JiraTicketPicker";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button, InlineButton } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { Menu, MenuItem, MenuItemLabel, MenuPopup, MenuTrigger } from "../ui/menu";
import { RefreshIcon } from "../ui/refresh-icon";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { issueDisplayActor } from "@t3tools/client-runtime/issue-presentation";
import { issueStatePresentation } from "./issuePresentation";
import { JiraIssueWork } from "./JiraIssueWork";

export interface JiraIssueComments {
  comments: ReadonlyArray<IssueComment>;
  nextCursor: string | null;
  loadingOlder: boolean;
  canLoadOlder: boolean;
  loadOlder: () => void;
}

function formatDueDate(value: string) {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/u.test(value) ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

function JiraLinkedIssueRow({
  issueKey,
  title,
  url,
  state,
  relationship,
  onOpen,
}: {
  issueKey: string;
  title: string;
  url: string;
  state: string;
  relationship?: string;
  onOpen?: (() => void) | undefined;
}) {
  const className =
    "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent";
  const content = (
    <>
      <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
        {issueKey}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
      {relationship ? (
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
          {relationship}
        </span>
      ) : null}
      <Badge size="sm" variant="secondary" className="max-w-28 shrink-0">
        <span className="truncate">{state}</span>
      </Badge>
    </>
  );
  return onOpen ? (
    <button type="button" className={className} onClick={onOpen}>
      {content}
    </button>
  ) : (
    <a href={url} target="_blank" rel="noopener noreferrer" className={className}>
      {content}
    </a>
  );
}

/** The Jira status as the native state control, moving through the workflow's transitions. */
function JiraStatusControl({
  environmentId,
  issue,
  onChanged,
}: {
  environmentId: EnvironmentId;
  issue: IssueDetail;
  onChanged: () => void;
}) {
  const gt = useGT();
  const live = useEnvironmentQuery(jiraIssueAtom({ environmentId, input: { key: issue.key } }));
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const [moving, setMoving] = useState(false);
  const state = issueStatePresentation(issue.state);
  const transitions = live.data?.transitions ?? [];
  const label = live.data?.status.name ?? issue.state.name;
  const icon = <state.Icon aria-hidden className={cn("size-3.5 shrink-0", state.toneClassName)} />;

  const move = async (transition: JiraIssueTransition) => {
    const confirmed = await requestConfirmDialog(
      gt("Move {key} from “{from}” to “{to}” ({transition})?", {
        key: issue.key,
        from: label,
        to: transition.toStatus,
        transition: transition.name,
      }),
    );
    if (!confirmed) return;
    setMoving(true);
    const result = await runAtomCommand(
      appAtomRegistry,
      transitionJiraIssue,
      { environmentId, input: { key: issue.key, transitionId: transition.id } },
      { reportFailure: false, reportDefect: false },
    );
    setMoving(false);
    live.refresh();
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: gt("Could not move {key}", { key: issue.key }),
        description: error instanceof Error ? error.message : gt("Jira rejected the change."),
      });
      return;
    }
    onChanged();
    refreshIssueLists(environmentId);
  };

  if (!canOperate || transitions.length === 0) {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs font-medium">
        {icon}
        {label}
      </span>
    );
  }
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="xs"
            variant="outline"
            disabled={moving}
            aria-label={gt("Change status of {key}, {state}", { key: issue.key, state: label })}
          />
        }
      >
        {icon}
        <span className="max-w-32 truncate">{label}</span>
        <ChevronDownIcon aria-hidden className="size-3" />
      </MenuTrigger>
      <MenuPopup align="end">
        {transitions.map((transition) => (
          <MenuItem key={transition.id} onClick={() => void move(transition)}>
            <MenuItemLabel>
              {transition.name === transition.toStatus
                ? transition.toStatus
                : `${transition.name} → ${transition.toStatus}`}
            </MenuItemLabel>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

function JiraLinkedChats({
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
  const changeLink = useChangeJiraTicketLink(environmentId);
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
    const changed = await changeLink(threadId, issue.key, linked);
    setPending(false);
    if (!changed) return;
    related.refresh();
    onRefresh();
    setPickerOpen(false);
  };

  return (
    <PullRequestSection
      key={`chats:${issue.url}`}
      title={
        threads.length > 0
          ? gt("Linked chats ({count})", { count: threads.length })
          : gt("Linked chats")
      }
      actions={
        canLink ? (
          <Button size="xs" variant="ghost" onClick={() => setPickerOpen(true)} disabled={pending}>
            <Link2Icon aria-hidden /> <T>Link chat</T>
          </Button>
        ) : null
      }
    >
      {related.error ? (
        <Button size="xs" variant="outline" onClick={related.refresh}>
          <T>Retry</T>
        </Button>
      ) : threads.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {related.isPending ? gt("Loading…") : gt("No linked chats yet.")}
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {threads.map((thread) => (
            <div key={thread.id} className="flex min-w-0 items-center gap-1">
              <Link
                to="/$environmentId/$threadId"
                params={{ environmentId, threadId: thread.id }}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
              >
                <MessageSquareIcon
                  aria-hidden
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 truncate">{thread.title || gt("Untitled thread")}</span>
                {thread.archivedAt !== null ? (
                  <Badge size="sm" variant="secondary" className="shrink-0">
                    <T>Archived thread</T>
                  </Badge>
                ) : null}
              </Link>
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
          ))}
        </div>
      )}
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
    </PullRequestSection>
  );
}

/** A Jira ticket in the native issue layout, with its release work and the chats that touch it. */
export function JiraIssueDetail({
  environmentId,
  issue,
  reference,
  threadRef,
  cwd,
  comments,
  refreshing,
  refreshError,
  onRefresh,
  onSelectIssue,
}: {
  environmentId: EnvironmentId;
  issue: IssueDetail;
  reference: IssueRef;
  threadRef: ScopedThreadRef | null;
  cwd: string;
  comments: JiraIssueComments;
  refreshing: boolean;
  refreshError: string | null;
  onRefresh: () => void;
  onSelectIssue?: ((reference: IssueRef) => void) | undefined;
}) {
  const gt = useGT();
  const messages = useMessages();
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const jira = issue.jiraDetails;
  const relatedThreads = useEnvironmentQuery(
    issueEnvironment.linkedThreads({
      environmentId,
      input: { tracker: issue.tracker, host: issue.host, scope: issue.scope, key: issue.key },
    }),
  );
  const fixVersions = issue.jiraWork?.fixVersions ?? [];
  // The scope is the key's project prefix; another project may not be readable here, so it opens in Jira.
  const openRelated = (key: string) =>
    onSelectIssue && key.split("-")[0]?.toUpperCase() === reference.scope.toUpperCase()
      ? () => onSelectIssue({ ...reference, key })
      : undefined;
  const relative = (value: string) => formatRelativeTimeLabel(value, undefined, messages);
  const metaRow = (icon: ReactNode, label: string, values: ReadonlyArray<string>) =>
    values.length === 0 ? null : (
      <PullRequestMetaRow icon={icon} label={label}>
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          {values.map((value) => (
            <Badge key={value} size="sm" variant="outline" className="max-w-48">
              <span className="truncate">{value}</span>
            </Badge>
          ))}
        </span>
      </PullRequestMetaRow>
    );

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pb-6" data-pull-request-summary-scroll>
        <div className="px-4 pb-1">
          <PullRequestDetailTitleRow className="h-7 gap-1 text-sm sm:text-xs">
            <span className="min-w-0 truncate font-medium text-muted-foreground">
              {jira?.projectName ?? issue.scope}
            </span>
            <InlineButton
              className="shrink-0 font-medium tabular-nums"
              aria-label={gt("Open {issue} on {provider}", {
                issue: issue.displayKey,
                provider: "Jira",
              })}
              render={<a href={issue.url} target="_blank" rel="noopener noreferrer" />}
            >
              {issue.displayKey}
              <ExternalLinkIcon aria-hidden className="size-2.5" />
            </InlineButton>
            <span className="flex-1" />
            <JiraStatusControl environmentId={environmentId} issue={issue} onChanged={onRefresh} />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={gt("Copy /ticket {key}", { key: issue.key })}
                    onClick={() => copyToClipboard(`/ticket ${issue.key}`, undefined)}
                  />
                }
              >
                {isCopied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
              </TooltipTrigger>
              <TooltipPopup>{isCopied ? <T>Copied</T> : <T>Copy /ticket</T>}</TooltipPopup>
            </Tooltip>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={gt("Refresh issue")}
              disabled={refreshing}
              onClick={onRefresh}
            >
              <RefreshIcon size="sm" refreshing={refreshing} />
            </Button>
          </PullRequestDetailTitleRow>

          {refreshError !== null && !refreshing ? (
            <div className="mt-2">
              <Alert variant="error">
                <AlertTitle>{gt("Could not refresh this issue")}</AlertTitle>
                <AlertDescription>{refreshError}</AlertDescription>
              </Alert>
            </div>
          ) : null}

          <PullRequestDetailTitleRow className="mt-1">
            <h2 className="min-w-0 flex-1 text-base font-semibold leading-snug">{issue.title}</h2>
          </PullRequestDetailTitleRow>

          <PullRequestMetaLine className="mt-2 min-h-5 flex-wrap text-xs text-muted-foreground">
            {jira?.issueType ? <span>{jira.issueType}</span> : null}
            <span>
              <T>
                created <Var>{relative(issue.createdAt)}</Var>
              </T>
            </span>
            <span>
              <T>
                updated <Var>{relative(issue.updatedAt)}</Var>
              </T>
            </span>
            {jira?.resolution ? <span>{jira.resolution}</span> : null}
          </PullRequestMetaLine>

          <div className="mt-4 space-y-2">
            <PullRequestMetaRow icon={<UsersIcon className="size-3.5" />} label={gt("Assignee")}>
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {issue.assignees.length === 0 ? (
                  <span className="text-muted-foreground">
                    <T>Unassigned</T>
                  </span>
                ) : (
                  issue.assignees.map((actor) => (
                    <PullRequestActorLabel
                      key={actor.login}
                      actor={issueDisplayActor(issue.tracker, actor)}
                    />
                  ))
                )}
              </span>
            </PullRequestMetaRow>
            {jira?.reporter ? (
              <PullRequestMetaRow
                icon={<UserRoundIcon className="size-3.5" />}
                label={gt("Reporter")}
              >
                <PullRequestActorLabel actor={issueDisplayActor(issue.tracker, jira.reporter)} />
              </PullRequestMetaRow>
            ) : null}
            {jira?.priority ? (
              <PullRequestMetaRow icon={<FlagIcon className="size-3.5" />} label={gt("Priority")}>
                {jira.priority}
              </PullRequestMetaRow>
            ) : null}
            {jira?.dueDate ? (
              <PullRequestMetaRow icon={<CalendarIcon className="size-3.5" />} label={gt("Due")}>
                {formatDueDate(jira.dueDate)}
              </PullRequestMetaRow>
            ) : null}
            {metaRow(
              <TagIcon className="size-3.5" />,
              gt("Labels"),
              issue.labels.map((label) => label.name),
            )}
            {metaRow(<BoxesIcon className="size-3.5" />, gt("Components"), jira?.components ?? [])}
            {metaRow(<MilestoneIcon className="size-3.5" />, gt("Fix versions"), fixVersions)}
            {metaRow(
              <MilestoneIcon className="size-3.5" />,
              gt("Affects"),
              jira?.affectedVersions ?? [],
            )}
            {jira?.parent ? (
              <PullRequestMetaRow
                icon={<CornerLeftUpIcon className="size-3.5" />}
                label={gt("Parent")}
              >
                <InlineButton
                  className="min-w-0 max-w-full"
                  {...(openRelated(jira.parent.key)
                    ? { onClick: openRelated(jira.parent.key) }
                    : {
                        render: (
                          <a href={jira.parent.url} target="_blank" rel="noopener noreferrer" />
                        ),
                      })}
                >
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {jira.parent.key}
                    </span>
                    <span className="min-w-0 truncate">{jira.parent.title}</span>
                  </span>
                </InlineButton>
              </PullRequestMetaRow>
            ) : null}
          </div>
        </div>

        {issue.jiraWork ? (
          <PullRequestSection key={`work:${issue.url}`} title={gt("Release and work")}>
            <JiraIssueWork
              environmentId={environmentId}
              ticketKey={issue.key}
              work={issue.jiraWork}
              extraPullRequests={relatedThreads.data?.jiraPullRequests ?? []}
            />
          </PullRequestSection>
        ) : null}

        <JiraLinkedChats
          environmentId={environmentId}
          issue={issue}
          reference={reference}
          onRefresh={onRefresh}
        />

        <PullRequestSection key={`description:${issue.url}`} title={gt("Description")} keepMounted>
          <PullRequestMarkdown
            text={issue.body.trim().length > 0 ? issue.body : gt("_No description provided._")}
            cwd={cwd}
            environmentId={environmentId}
            threadRef={threadRef}
          />
        </PullRequestSection>

        {jira && jira.fields.length > 0 ? (
          <PullRequestSection key={`fields:${issue.url}`} title={gt("Details")}>
            <dl className="grid grid-cols-[minmax(6rem,auto)_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2">
              {jira.fields.map((field) => (
                <div key={field.name} className="contents">
                  <dt className="text-xs text-muted-foreground">{field.name}</dt>
                  <dd className="min-w-0 break-words whitespace-pre-line text-sm">{field.value}</dd>
                </div>
              ))}
            </dl>
          </PullRequestSection>
        ) : null}

        {jira && jira.relatedIssues.length > 0 ? (
          <PullRequestSection
            key={`related:${issue.url}`}
            title={gt("Linked issues ({count})", { count: jira.relatedIssues.length })}
          >
            <div className="flex flex-col gap-0.5">
              {jira.relatedIssues.map((related) => (
                <JiraLinkedIssueRow
                  key={`${related.relationship}:${related.key}`}
                  issueKey={related.key}
                  title={related.title}
                  url={related.url}
                  state={related.state}
                  relationship={related.relationship}
                  onOpen={openRelated(related.key)}
                />
              ))}
            </div>
          </PullRequestSection>
        ) : null}

        {jira && jira.attachments.length > 0 ? (
          <PullRequestSection
            key={`attachments:${issue.url}`}
            title={gt("Attachments ({count})", { count: jira.attachments.length })}
          >
            <div className="flex flex-col gap-0.5">
              {jira.attachments.map((attachment) => (
                <a
                  key={attachment.id}
                  href={attachment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <PaperclipIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatBytes(attachment.size)}
                  </span>
                </a>
              ))}
            </div>
          </PullRequestSection>
        ) : null}

        <PullRequestSection
          key={`comments:${issue.url}`}
          title={
            issue.commentCount > 0
              ? gt("Comments ({count})", { count: issue.commentCount })
              : gt("Comments")
          }
        >
          <div className="flex flex-col gap-3">
            {comments.nextCursor !== null ? (
              <Button
                size="sm"
                variant="outline"
                className="self-start"
                disabled={!comments.canLoadOlder}
                onClick={comments.loadOlder}
              >
                {comments.loadingOlder ? <T>Loading…</T> : <T>Load older comments</T>}
              </Button>
            ) : null}
            {comments.comments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                <T>No comments yet.</T>
              </p>
            ) : (
              comments.comments.map((comment) => (
                <article
                  key={comment.id}
                  className="flex flex-col gap-2 rounded-lg border border-border/60 p-3"
                >
                  <PullRequestMetaLine className="text-xs text-muted-foreground">
                    <PullRequestActorLabel
                      actor={issueDisplayActor(issue.tracker, comment.author)}
                    />
                    {comment.url ? (
                      <InlineButton
                        tone="muted"
                        render={<a href={comment.url} target="_blank" rel="noopener noreferrer" />}
                      >
                        {relative(comment.createdAt)}
                      </InlineButton>
                    ) : (
                      <span>{relative(comment.createdAt)}</span>
                    )}
                  </PullRequestMetaLine>
                  <PullRequestCommentBody
                    text={comment.body}
                    cwd={cwd}
                    environmentId={environmentId}
                    threadRef={threadRef}
                  />
                </article>
              ))
            )}
          </div>
        </PullRequestSection>
      </div>
    </div>
  );
}
