import { describe, expect, it } from "@effect/vitest";

import * as Effect from "effect/Effect";
import * as UrlParams from "effect/http/UrlParams";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as JiraClient from "./JiraClient.ts";

import { make, jiraListQuery } from "./JiraIssueTracker.ts";

const input = {
  cwd: "/work",
  scope: "RET",
  host: "sensoneosk.atlassian.net",
  state: "open",
  involvement: "assigned",
  viewer: "account",
  sort: "updated",
  limit: 50,
} as const;

describe("Sensoneo Jira queries", () => {
  it("uses Jira's viewer and keeps plain text within a quoted JQL value", () => {
    expect(jiraListQuery({ ...input, query: 'invoice" OR project = "GRE' })).toBe(
      'project = "RET" AND statusCategory != Done AND assignee = currentUser() AND text ~ "invoice\\" OR project = \\"GRE" ORDER BY updated DESC, key DESC',
    );
  });

  it("visits only the selected project for an exact key or project search", () => {
    expect(jiraListQuery({ ...input, query: "gre45" })).toBeNull();
    expect(jiraListQuery({ ...input, query: "DRSI" })).toBeNull();
    expect(jiraListQuery({ ...input, involvement: "all", state: "all", query: "ret45" })).toBe(
      'project = "RET" AND key = "RET-45" ORDER BY updated DESC, key DESC',
    );
  });
});

it.effect(
  "loads the full ticket and paginates comments without dropping content or crossing project scope",
  () =>
    Effect.gen(function* () {
      const tracker = yield* make;
      const detail = yield* tracker.getIssue({ ...input, key: "RET-45" });
      expect(detail.body).toBe("Description");
      expect(detail.jiraDetails?.fields).toEqual([
        { name: "Expected result", value: "Export succeeds" },
      ]);
      expect(detail.commentCount).toBe(31);
      expect(detail.comments).toHaveLength(30);
      expect(detail.comments[0]?.id).toBe("29");
      expect(detail.comments.at(-1)?.id).toBe("0");
      expect(detail.commentsCursor).toBe("30");
      const page = yield* tracker.getComments({
        ...input,
        key: "RET-45",
        cursor: detail.commentsCursor!,
      });
      expect(page.comments.map((comment) => comment.body)).toEqual(["Older comment"]);
      expect(page.nextCursor).toBeNull();
      const invalid = yield* tracker
        .getComments({ ...input, key: "GRE-45", cursor: "30" })
        .pipe(Effect.flip);
      expect(invalid.reason).toBe("not-found");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodePath.layer,
          SqlitePersistence.layerMemory,
          FileSystem.layerNoop({ readFileString: () => Effect.succeed("") }),
          Layer.mock(Orchestrator.OrchestratorV2)({}),
          Layer.mock(ProjectService.ProjectService)({}),
          Layer.succeed(JiraClient.JiraClient, {
            configuredHost: Effect.succeed(input.host),
            execute: (request) => {
              const isComments = request.url.endsWith("/comment");
              const older =
                Option.getOrNull(UrlParams.getFirst(request.urlParams, "startAt")) === "30";
              const paragraph = (text: string) => ({
                type: "doc",
                content: [{ type: "paragraph", content: [{ type: "text", text }] }],
              });
              return Effect.succeed({
                status: 200,
                origin: `https://${input.host}`,
                body: isComments
                  ? {
                      startAt: older ? 30 : 0,
                      total: 31,
                      comments: Array.from({ length: older ? 1 : 30 }, (_, i) => ({
                        id: String((older ? 30 : 0) + i),
                        body: paragraph(older ? "Older comment" : "Recent comment"),
                        created: "2026-11-25T10:00:00Z",
                      })),
                    }
                  : {
                      key: "RET-45",
                      fields: {
                        summary: "Export",
                        created: "2026-11-24T10:00:00Z",
                        updated: "2026-11-25T10:00:00Z",
                        status: { name: "In progress", statusCategory: { key: "indeterminate" } },
                        description: paragraph("Description"),
                        customfield_10211: paragraph("Export succeeds"),
                      },
                    },
              });
            },
          }),
        ),
      ),
    ),
);
