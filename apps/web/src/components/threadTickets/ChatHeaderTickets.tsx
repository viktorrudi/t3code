import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type JiraIssueStatusCategory,
  type JiraIssueTransition,
  type ThreadId,
  type ThreadTicket,
} from "@t3tools/contracts";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";

import { requestConfirmDialog } from "~/confirmDialog";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { jiraIssueAtom, transitionJiraIssue, useThreadTickets } from "../../state/threadTickets";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuItemLabel, MenuPopup, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadTicketChips } from "./ThreadTicketChips";

const STATUS_BADGE_VARIANT = {
  new: "secondary",
  indeterminate: "info",
  done: "success",
  unknown: "secondary",
} as const satisfies Record<JiraIssueStatusCategory, string>;

function JiraTicketStatus({
  environmentId,
  ticket,
}: {
  environmentId: EnvironmentId;
  ticket: ThreadTicket;
}) {
  const query = useEnvironmentQuery(jiraIssueAtom({ environmentId, input: { key: ticket.key } }));
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const [moving, setMoving] = useState(false);
  const issue = query.data;

  const move = async (transition: JiraIssueTransition) => {
    if (issue === null) return;
    const confirmed = await requestConfirmDialog(
      `Move ${issue.key} from “${issue.status.name}” to “${transition.toStatus}” (${transition.name})?`,
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
    query.refresh();
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: `Could not move ${issue.key}`,
        description: error instanceof Error ? error.message : "Jira rejected the change.",
      });
    }
  };

  if (issue === null) {
    if (query.error === null) return null;
    return (
      <Tooltip>
        <TooltipTrigger render={<Badge size="sm" variant="warning" />}>Jira?</TooltipTrigger>
        <TooltipPopup side="bottom">{query.error}</TooltipPopup>
      </Tooltip>
    );
  }

  const statusBadge = (
    <Badge size="sm" variant={STATUS_BADGE_VARIANT[issue.status.category]}>
      {issue.status.name}
    </Badge>
  );
  return (
    <>
      {canOperate && issue.transitions.length > 0 ? (
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="xs"
                variant="ghost"
                disabled={moving}
                aria-label={`Change status of ${issue.key}`}
              />
            }
          >
            {statusBadge}
            <ChevronDownIcon aria-hidden className="size-3 text-muted-foreground" />
          </MenuTrigger>
          <MenuPopup align="end">
            {issue.transitions.map((transition) => (
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
      ) : (
        statusBadge
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="inline-flex max-w-32 min-w-0 items-center gap-1 text-muted-foreground text-xs" />
          }
        >
          {issue.assignee?.avatarUrl ? (
            <img
              src={issue.assignee.avatarUrl}
              alt=""
              className="size-4 shrink-0 rounded-full"
              referrerPolicy="no-referrer"
            />
          ) : null}
          <span className="truncate">{issue.assignee?.displayName ?? "Unassigned"}</span>
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          {issue.issueType ? `${issue.issueType} · ` : ""}
          {issue.summary}
        </TooltipPopup>
      </Tooltip>
    </>
  );
}

/** The thread's linked Jira tickets with live status, assignee and a status picker. */
export function ChatHeaderTickets({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const tickets = useThreadTickets(environmentId, threadId);
  if (tickets.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
      {tickets.map((ticket) => (
        <div key={ticket.key} className="flex shrink-0 items-center gap-1.5">
          <ThreadTicketChips tickets={[ticket]} />
          <JiraTicketStatus environmentId={environmentId} ticket={ticket} />
        </div>
      ))}
    </div>
  );
}
