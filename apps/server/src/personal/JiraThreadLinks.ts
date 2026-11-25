import {
  CommandId,
  IssueOperationError,
  JiraIssueError,
  type IssueLinkedThreadsResult,
  type JiraTicketLinkInput,
  type ThreadIssueKey,
} from "@t3tools/contracts";
import * as Config from "effect/Config";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Semaphore from "effect/Semaphore";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as NodeOS from "node:os";

import * as ServerConfig from "../config.ts";
import * as IssueService from "../issue/IssueService.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { eligibleJiraThread, linkedJiraThreads, linkedPullRequests } from "./JiraTicketWork.ts";
import { JIRA_HOST, JIRA_TRACKER, jiraProject, ticketRoot } from "./SensoneoJira.ts";
import * as ThreadTickets from "./ThreadTickets.ts";

export class JiraThreadLinks extends Context.Service<
  JiraThreadLinks,
  {
    readonly set: (
      input: JiraTicketLinkInput,
    ) => Effect.Effect<{ readonly annotationsRefreshed: boolean }, JiraIssueError>;
    readonly forIssue: (
      key: ThreadIssueKey,
    ) => Effect.Effect<IssueLinkedThreadsResult, IssueOperationError>;
  }
>()("t3/personal/JiraThreadLinks") {}

const make = Effect.gen(function* () {
  const issues = yield* IssueService.IssueService;
  const sql = yield* SqlClient.SqlClient;
  const random = yield* SecureRandom.SecureRandom;
  const writes = yield* Semaphore.make(1);
  const fs = yield* FileSystem.FileSystem;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projects = yield* ProjectService.ProjectService;
  const tickets = yield* ThreadTickets.ThreadTickets;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const path = yield* Path.Path;
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const scripts = yield* Config.String("T3_JIRA_TICKET_SCRIPTS").pipe(
    Config.withDefault(path.join(NodeOS.homedir(), ".claude/skills/ticket/scripts")),
  );

  const set = Effect.fn("JiraThreadLinks.set")(function* (input: JiraTicketLinkInput) {
    const scope = jiraProject(input.key);
    const thread = yield* eligibleJiraThread(input.threadId, input.key).pipe(
      Effect.provideService(Orchestrator.OrchestratorV2, orchestrator),
      Effect.provideService(ProjectService.ProjectService, projects),
      Effect.mapError(
        (cause) =>
          new JiraIssueError({ key: input.key, detail: "Could not read the chat.", cause }),
      ),
    );
    if (scope === undefined || thread === null) {
      return yield* new JiraIssueError({
        key: input.key,
        detail: "This Jira ticket cannot be linked to that chat.",
      });
    }
    const issue = input.linked
      ? yield* issues
          .detail({
            projectId: thread.projectId,
            tracker: JIRA_TRACKER,
            host: JIRA_HOST,
            scope,
            key: input.key,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new JiraIssueError({
                  key: input.key,
                  detail: "Could not verify the Jira ticket.",
                  cause,
                }),
            ),
          )
      : null;
    if (issue !== null && issue.key !== input.key) {
      return yield* new JiraIssueError({
        key: input.key,
        detail: "The Jira ticket key changed. Search for it again.",
      });
    }
    const command = ChildProcess.make(
      "/usr/bin/env",
      [
        "node",
        path.join(scripts, "ticket-tracking.mjs"),
        input.linked ? "link" : "unlink",
        input.key,
        input.threadId,
        "--require-refresh",
      ],
      {
        cwd: ticketRoot(),
        extendEnv: true,
        env: { T3CODE_HOME: path.dirname(stateDir), TICKET_ROOT: ticketRoot() },
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      },
    );
    const code = yield* Effect.scoped(
      spawner.spawn(command).pipe(Effect.flatMap((handle) => handle.exitCode)),
    ).pipe(
      Effect.timeout("40 seconds"),
      Effect.mapError(
        (cause) =>
          new JiraIssueError({
            key: input.key,
            detail: "Could not update the local Jira link.",
            cause,
          }),
      ),
    );
    if (Number(code) !== 0 && Number(code) !== 2) {
      return yield* new JiraIssueError({
        key: input.key,
        detail: "The ticket skill could not update the local Jira link.",
      });
    }
    yield* tickets.refresh;
    // The registry owns work metadata; the native relation makes the same link navigable everywhere.
    const commandId = CommandId.make(`jira-link:${yield* random.uuidV4().pipe(Effect.orDie)}`);
    const identity = {
      threadId: input.threadId,
      tracker: JIRA_TRACKER,
      host: JIRA_HOST,
      scope,
      key: input.key,
    };
    yield* orchestrator
      .dispatch(
        issue === null
          ? {
              ...identity,
              commandId,
              type: "thread.issue.unlink",
            }
          : {
              ...identity,
              commandId,
              type: "thread.issue.link",
              projectId: thread.projectId,
              url: issue.url,
              displayKey: issue.displayKey,
              title: issue.title,
              source: "manual",
            },
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new JiraIssueError({
              key: input.key,
              detail:
                "Local tracking saved, but the chat link could not be refreshed. Retry the same action.",
              cause,
            }),
        ),
      );
    return { annotationsRefreshed: Number(code) === 0 };
  }, writes.withPermits(1));

  const forIssue = Effect.fn("JiraThreadLinks.forIssue")(function* (key: ThreadIssueKey) {
    if (key.host !== JIRA_HOST || jiraProject(key.key) !== key.scope.toUpperCase()) {
      return { threads: [], jiraPullRequests: [] };
    }
    const threads = yield* linkedJiraThreads(key.key).pipe(
      Effect.provideService(Orchestrator.OrchestratorV2, orchestrator),
      Effect.provideService(ProjectService.ProjectService, projects),
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.provideService(SqlClient.SqlClient, sql),
      Effect.mapError(
        (cause) =>
          new IssueOperationError({
            operation: "linkedThreads",
            detail: "Could not read the chats linked to this Jira ticket.",
            cause,
          }),
      ),
    );
    const ordered = [...threads].sort(
      (a, b) => DateTime.toEpochMillis(b.updatedAt) - DateTime.toEpochMillis(a.updatedAt),
    );
    return {
      threads: ordered.map((thread) => ({
        id: thread.id,
        projectId: thread.projectId,
        title: thread.title,
        archivedAt: thread.archivedAt === null ? null : DateTime.formatIso(thread.archivedAt),
        settled: thread.settledAt != null,
      })),
      jiraPullRequests: linkedPullRequests(ordered),
    };
  });

  return JiraThreadLinks.of({ set, forIssue });
});

export const layer = Layer.effect(JiraThreadLinks, make);
