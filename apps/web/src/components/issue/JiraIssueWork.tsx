import type { EnvironmentId, JiraTicketWork, JiraWorkPullRequest } from "@t3tools/contracts";
import { MessageSquareIcon } from "lucide-react";
import { T, useGT } from "gt-react";

import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { TicketDeployBadge } from "../threadTickets/ThreadTicketChips";
import { Button } from "../ui/button";

export function JiraIssueWork({
  environmentId,
  ticketKey,
  work,
  extraPullRequests = [],
  compact = false,
}: {
  environmentId: EnvironmentId;
  ticketKey: string;
  work: JiraTicketWork;
  extraPullRequests?: readonly JiraWorkPullRequest[];
  compact?: boolean;
}) {
  const gt = useGT();
  const pullRequests = [
    ...new Map([...work.pullRequests, ...extraPullRequests].map((pr) => [pr.url, pr])).values(),
  ];
  if (
    compact &&
    work.release === null &&
    !work.deploy &&
    work.linkedChatCount === 0 &&
    pullRequests.length === 0
  )
    return null;
  return (
    <div
      className={
        compact
          ? "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
          : "space-y-2"
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {compact && work.linkedChatCount > 0 ? (
          <span
            className="inline-flex items-center gap-1"
            aria-label={gt("{count} linked chats", { count: work.linkedChatCount })}
          >
            <MessageSquareIcon aria-hidden className="size-3" />
            <span>{work.linkedChatCount}</span>
          </span>
        ) : null}
        {work.release === null ? (
          compact ? null : (
            <T>No local release assigned</T>
          )
        ) : (
          <span>{gt("Release {release}", { release: work.release })}</span>
        )}
        {work.deploy ? (
          <TicketDeployBadge
            environmentId={environmentId}
            ticketKey={ticketKey}
            deploy={work.deploy}
          />
        ) : null}
      </div>
      {!compact && work.fixVersions.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {gt("Jira Fix Version: {versions}", { versions: work.fixVersions.join(", ") })}
        </p>
      ) : null}
      {pullRequests.length > 0 ? (
        <div
          className={
            compact
              ? "flex min-w-0 flex-wrap items-center gap-1"
              : "flex min-w-0 flex-col items-start gap-1"
          }
        >
          {pullRequests.slice(0, compact ? 2 : undefined).map((pr) => (
            <Button
              key={pr.url}
              size="xs"
              variant={compact ? "ghost" : "outline"}
              title={pr.title ?? undefined}
              render={<a href={pr.url} target="_blank" rel="noopener noreferrer" />}
            >
              <PullRequestGlyph.pullRequest aria-hidden />
              <span className="max-w-60 truncate">
                {compact
                  ? pr.number === undefined
                    ? gt("Pull request")
                    : `#${pr.number}`
                  : (pr.title ??
                    (pr.number === undefined
                      ? gt("Pull request")
                      : gt("Pull request #{number}", { number: pr.number })))}
              </span>
            </Button>
          ))}
          {compact && pullRequests.length > 2 ? <span>+{pullRequests.length - 2}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
