import { StackActions, useNavigation } from "@react-navigation/native";
import {
  jiraTicketIssueTarget,
  mergeThreadJiraTickets,
} from "@t3tools/client-runtime/thread-jira-tickets";
import type { EnvironmentId, ProjectId, ThreadIssueLink, ThreadTicket } from "@t3tools/contracts";
import { Linking, Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useEnvironmentServerConfig } from "../../state/entities";
import { cn } from "../../lib/cn";

export function ThreadTicketChips({
  thread,
  annotations,
  inset = 0,
}: {
  readonly thread: {
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
    readonly issues?: ReadonlyArray<ThreadIssueLink>;
  };
  readonly annotations?: ReadonlyArray<ThreadTicket>;
  readonly inset?: number;
}) {
  const navigation = useNavigation();
  const config = useEnvironmentServerConfig(thread.environmentId);
  const tickets = mergeThreadJiraTickets(annotations ?? [], thread.issues);
  if (tickets.length === 0) return null;
  return (
    <View className="mt-1 flex-row flex-wrap items-center gap-2" style={{ paddingLeft: inset }}>
      {tickets.map((ticket) => (
        <Pressable
          key={`${ticket.host}:${ticket.key}`}
          accessibilityRole="button"
          accessibilityLabel={[ticket.key, ticket.deploy?.title ?? ticket.deploy?.label]
            .filter(Boolean)
            .join(" · ")}
          className="min-h-7 shrink flex-row flex-wrap items-center gap-1 rounded-lg bg-card px-2 py-1"
          hitSlop={8}
          onPress={() => {
            const target = jiraTicketIssueTarget(ticket, thread.projectId);
            if (config?.environment.capabilities.issues === true) {
              navigation.dispatch(
                StackActions.push("Issue", {
                  ...target,
                  environmentId: thread.environmentId,
                  issueKey: ticket.key,
                }),
              );
            } else {
              void Linking.openURL(ticket.url);
            }
          }}
        >
          <Text className="text-xs font-t3-medium text-foreground">
            {[ticket.flag, ticket.key].filter(Boolean).join(" ")}
          </Text>
          {ticket.deploy ? (
            <Text
              className={cn(
                "text-xs font-t3-medium",
                ticket.deploy.tone === "success"
                  ? "text-success-foreground"
                  : ticket.deploy.tone === "warning"
                    ? "text-warning-foreground"
                    : "text-foreground-muted",
              )}
            >
              {[ticket.deploy.assign?.current ?? ticket.deploy.target?.release, ticket.deploy.label]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}
