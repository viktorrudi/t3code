import {
  THREAD_ANNOTATIONS_FILE,
  ThreadTicket,
  type ThreadTicketAnnotations,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as ServerConfig from "../config.ts";

/** Ticket chips per thread, read from a file an external script keeps current. */
export class ThreadTickets extends Context.Service<
  ThreadTickets,
  {
    readonly changes: Stream.Stream<ThreadTicketAnnotations>;
    readonly refresh: Effect.Effect<void>;
  }
>()("t3/personal/ThreadTickets") {}

const EMPTY: ThreadTicketAnnotations = { threads: {} };
const decodeTicket = Schema.decodeUnknownOption(ThreadTicket);

/** Drops malformed entries one by one so a single bad ticket never hides the rest. */
export function parseThreadAnnotations(text: string): ThreadTicketAnnotations {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return EMPTY;
  }
  if (!Predicate.isObject(parsed) || !Predicate.isObject(parsed.threads)) return EMPTY;
  const threads: Record<string, ReadonlyArray<ThreadTicket>> = {};
  for (const [threadId, entry] of Object.entries(parsed.threads)) {
    if (!Predicate.isObject(entry) || !Array.isArray(entry.tickets)) continue;
    const tickets = entry.tickets.flatMap((ticket) => Option.toArray(decodeTicket(ticket)));
    if (tickets.length > 0) threads[threadId] = tickets;
  }
  return { threads };
}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { stateDir } = yield* ServerConfig.ServerConfig;
  // A dedicated directory keeps the watch away from the database's constant writes.
  const directory = path.join(stateDir, "annotations");
  const filePath = path.join(directory, THREAD_ANNOTATIONS_FILE);
  yield* fileSystem.makeDirectory(directory, { recursive: true }).pipe(Effect.ignore);

  const read = fileSystem.readFileString(filePath).pipe(
    Effect.map(parseThreadAnnotations),
    Effect.orElseSucceed(() => EMPTY),
  );
  const annotations = yield* SubscriptionRef.make(yield* read);
  const refresh = read.pipe(Effect.flatMap((next) => SubscriptionRef.set(annotations, next)));
  yield* fileSystem.watch(directory).pipe(
    Stream.filter((event) => path.basename(event.path) === THREAD_ANNOTATIONS_FILE),
    Stream.debounce(Duration.millis(100)),
    Stream.runForEach(() => refresh),
    Effect.ignoreCause({ log: true }),
    Effect.forkScoped,
  );
  return ThreadTickets.of({ changes: SubscriptionRef.changes(annotations), refresh });
});

export const layer = Layer.effect(ThreadTickets, make);
