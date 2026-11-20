import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as ServerSettings from "../serverSettings.ts";

export class JiraNotConfiguredError extends Schema.TaggedError<JiraNotConfiguredError>()(
  "JiraNotConfiguredError",
  { cause: Schema.optional(Schema.Defect()) },
) {
  override get message() {
    return "Jira is not connected. Add the Jira connection under Settings → Event snoozing.";
  }
}

/** Jira REST access with the Jira snooze connection's site, email and token. */
export class JiraClient extends Context.Service<
  JiraClient,
  {
    /** Sends `request` (a path below the site origin, e.g. `/rest/api/3/myself`) with credentials. */
    readonly execute: (
      request: HttpClientRequest.HttpClientRequest,
    ) => Effect.Effect<
      { readonly status: number; readonly body: unknown; readonly origin: string },
      JiraNotConfiguredError | HttpClientError.HttpClientError
    >;
  }
>()("t3/personal/JiraClient") {}

const KEYCHAIN_TOKEN = "keychain:t3-code-jira-snooze";

const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const http = yield* HttpClient.HttpClient;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const credentials = Effect.fn("JiraClient.credentials")(function* () {
    const { jiraSnooze: config } = yield* settings.getSettings.pipe(
      Effect.mapError((cause) => new JiraNotConfiguredError({ cause })),
    );
    const origin = yield* Effect.try({
      try: () => new URL(config.baseUrl),
      catch: (cause) => new JiraNotConfiguredError({ cause }),
    });
    if (
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      typeof config.apiToken !== "string" ||
      !config.apiToken ||
      !config.email
    )
      return yield* new JiraNotConfiguredError({});
    const token =
      config.apiToken === KEYCHAIN_TOKEN
        ? (yield* spawner
            .string(
              ChildProcess.make(
                "/usr/bin/security",
                ["find-generic-password", "-s", "t3-code-jira-snooze", "-a", config.email, "-w"],
                { stdin: "ignore", stderr: "ignore" },
              ),
            )
            .pipe(Effect.mapError((cause) => new JiraNotConfiguredError({ cause })))).trim()
        : config.apiToken;
    if (!token) return yield* new JiraNotConfiguredError({});
    return {
      origin: origin.origin,
      authorization: `Basic ${Buffer.from(`${config.email}:${token}`).toString("base64")}`,
    };
  });

  const execute = Effect.fn("JiraClient.execute")(function* (
    request: HttpClientRequest.HttpClientRequest,
  ) {
    const { origin, authorization } = yield* credentials();
    const response = yield* http
      .execute(
        request.pipe(
          HttpClientRequest.prependUrl(origin),
          HttpClientRequest.setHeader("Accept", "application/json"),
          HttpClientRequest.setHeader("Authorization", authorization),
        ),
      )
      .pipe(
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
        Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      );
    const body =
      response.status === 204 ? null : yield* response.json.pipe(Effect.orElseSucceed(() => null));
    return { status: response.status, body, origin };
  });

  return JiraClient.of({ execute });
});

export const layer = Layer.effect(JiraClient, make);
