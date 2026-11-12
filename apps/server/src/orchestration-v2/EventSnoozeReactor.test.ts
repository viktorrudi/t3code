import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import { HttpClient, HttpClientResponse } from "effect/http";
import { ChildProcessSpawner } from "effect/process";
import * as ServerSettings from "../serverSettings.ts";
import * as EventSnoozeReactor from "./EventSnoozeReactor.ts";

it.effect(
  "reads the newest Jira comment with API or Keychain credentials and preserves read failures",
  () =>
    Effect.gen(function* () {
      let status = 200;
      let malformed = false;
      let keychainReads = 0;
      const http = HttpClient.make((request) =>
        Effect.sync(() => {
          assert.equal(request.url, "https://jira.example.test/rest/api/3/issue/RET-1234/comment");
          assert.deepInclude(request.urlParams.params, ["orderBy", "-created"]);
          assert.deepInclude(request.urlParams.params, ["maxResults", "1"]);
          assert.equal(
            request.headers.authorization,
            `Basic ${Buffer.from("person@example.test:fixture-token").toString("base64")}`,
          );
          return HttpClientResponse.fromWeb(
            request,
            Response.json(
              malformed ? {} : { comments: [{ created: "2026-11-12T10:00:00.000+0000" }] },
              { status },
            ),
          );
        }),
      );
      const settings = yield* ServerSettings.ServerSettingsService.pipe(
        Effect.provide(
          ServerSettings.layerTest({
            jiraSnooze: {
              baseUrl: "https://jira.example.test",
              email: "person@example.test",
              apiToken: "fixture-token",
            },
          }),
        ),
      );
      const source = yield* EventSnoozeReactor.JiraSnoozeComments.pipe(
        Effect.provide(
          EventSnoozeReactor.layerJiraComments.pipe(
            Layer.provide(Layer.succeed(ServerSettings.ServerSettingsService, settings)),
            Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
            Layer.provide(
              Layer.mock(ChildProcessSpawner.ChildProcessSpawner)({
                string: () =>
                  Effect.sync(() => {
                    keychainReads++;
                    return "fixture-token\n";
                  }),
              }),
            ),
          ),
        ),
      );
      assert.equal(yield* source.latest("RET-1234"), "2026-11-12T10:00:00.000+0000");
      assert.equal(keychainReads, 0);
      yield* settings.updateSettings({ jiraSnooze: { apiToken: "keychain:t3-code-jira-snooze" } });
      assert.equal(yield* source.latest("RET-1234"), "2026-11-12T10:00:00.000+0000");
      assert.equal(keychainReads, 1);
      status = 403;
      assert.isTrue(Result.isFailure(yield* source.latest("RET-1234").pipe(Effect.result)));
      status = 200;
      malformed = true;
      assert.isTrue(Result.isFailure(yield* source.latest("RET-1234").pipe(Effect.result)));
    }),
);
