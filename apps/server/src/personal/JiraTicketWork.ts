import {
  ThreadId,
  ThreadTicketDeploy,
  type JiraTicketWork,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { jiraProject, jiraScopes, ticketRoot } from "./SensoneoJira.ts";

const parseBadges = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);
const parseBadge = Schema.decodeUnknownOption(ThreadTicketDeploy);

export function httpsBrowserUrl(value: string | null | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.href.length <= 2_000
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function metadata(notes: string) {
  const block = notes.split(/^##\s/mu, 1)[0] ?? "";
  const release = /^- Release:\s+`?(?:release\/returo-uat-|drsi-release-)([\d.]+)`?/mu.exec(
    block,
  )?.[1];
  const pullRequests = [
    ...block.matchAll(/^- PR:\s+`?<?(https:\/\/[^\s`>]+)(?:>|\x60)?/gmu),
  ].flatMap((match) => {
    const url = httpsBrowserUrl(match[1]);
    if (url === undefined) return [];
    const number = /\/(?:pullrequest|pull|pulls|merge_requests)\/(\d+)(?:\/|$)/u.exec(
      new URL(url).pathname,
    )?.[1];
    return [{ url, ...(number === undefined ? {} : { number: Number(number) }) }];
  });
  return { release, pullRequests };
}

export const eligibleJiraThread = Effect.fn("JiraTicketWork.eligibleThread")(function* (
  threadId: ThreadId,
  key: string,
) {
  const scope = jiraProject(key);
  if (scope === undefined) return null;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projects = yield* ProjectService.ProjectService;
  const thread = yield* orchestrator.getThreadShell(threadId);
  if (thread === null) return null;
  const project = yield* projects.getShell(thread.projectId);
  return Option.isSome(project) &&
    jiraScopes(project.value).some((candidate) => candidate === scope)
    ? thread
    : null;
});

const parseTracking = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      threads: Schema.Array(ThreadId),
    }),
  ),
);

export const linkedJiraThreads = Effect.fn("JiraTicketWork.linkedThreads")(function* (key: string) {
  if (jiraProject(key) === undefined) return [];
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const raw = yield* fs
    .readFileString(path.join(ticketRoot(), ".my-docs", key, "tracking.json"))
    .pipe(Effect.orElseSucceed(() => ""));
  const tracking = parseTracking(raw);
  if (Option.isNone(tracking)) return [];
  const threads = yield* Effect.forEach(
    new Set(tracking.value.threads),
    (id) => eligibleJiraThread(id, key),
    { concurrency: 4 },
  );
  return threads.filter((thread) => thread !== null);
});

export function linkedPullRequests(threads: readonly OrchestrationV2ThreadShell[]) {
  const pullRequests = threads.flatMap((thread) =>
    visibleThreadPullRequests(thread.pullRequests ?? []).flatMap((pr) => {
      const url = httpsBrowserUrl(pr.url);
      return url === undefined
        ? []
        : [
            {
              url,
              number: pr.number,
              ...(pr.snapshot?.title ? { title: pr.snapshot.title.slice(0, 500) } : {}),
            },
          ];
    }),
  );
  return [...new Map(pullRequests.map((pr) => [pr.url, pr])).values()];
}

export const loadTicketWork = Effect.fn("JiraTicketWork.load")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const docs = path.join(ticketRoot(), ".my-docs");
  const raw = yield* fs
    .readFileString(path.join(docs, "_deploys", "ticket-badges.json"))
    .pipe(Effect.orElseSucceed(() => ""));
  const parsed = parseBadges(raw);
  const badges = Option.isSome(parsed) ? parsed.value : {};

  return Effect.fn("JiraTicketWork.read")(function* (
    key: string,
    fixVersions: ReadonlyArray<string>,
  ) {
    const [notes, threads] = yield* Effect.all(
      [
        fs.readFileString(path.join(docs, key, "notes.md")).pipe(Effect.orElseSucceed(() => "")),
        linkedJiraThreads(key).pipe(Effect.orElseSucceed(() => [])),
      ],
      { concurrency: 2 },
    );
    const local = metadata(notes);
    const parsedBadge = parseBadge(badges[key]);
    const badge = Option.isSome(parsedBadge) ? parsedBadge.value : undefined;
    const release = local.release ?? badge?.target?.release ?? null;
    const deployUrl = httpsBrowserUrl(badge?.url);
    const deploy = badge ? { ...badge, url: deployUrl } : undefined;
    return {
      release,
      fixVersions,
      linkedChatCount: threads.length,
      pullRequests: [
        ...new Map(
          [...local.pullRequests, ...linkedPullRequests(threads)].map((pr) => [pr.url, pr]),
        ).values(),
      ],
      ...(deploy === undefined ? {} : { deploy }),
    } satisfies JiraTicketWork;
  });
});
