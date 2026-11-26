import { WatchError } from "./policy.ts";

export type CommandJournal = Record<string, { fingerprint: string; result?: unknown }>;
export function commandRunner(
  journal: CommandJournal,
  save: () => Promise<void>,
  audit: (key: string) => Promise<void>,
) {
  const inFlight = new Map<string, Promise<unknown>>();
  return async function once(key: string, fingerprint: string, execute: () => Promise<unknown>) {
    if (journal[key]?.fingerprint !== undefined && journal[key]!.fingerprint !== fingerprint)
      throw new WatchError(
        409,
        "This command ID belongs to a different draft. Review and try again.",
      );
    if (journal[key]?.result !== undefined) return journal[key]!.result;
    if (inFlight.has(key)) return inFlight.get(key)!;
    if (!journal[key] && Object.keys(journal).length >= 10000)
      throw new WatchError(503, "Gateway command storage is full. Rotate the Watch credential.");
    const pending = (async () => {
      journal[key] = { fingerprint };
      await save();
      const result = await execute();
      journal[key] = { fingerprint, result };
      await save();
      await audit(key);
      return result;
    })();
    inFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      inFlight.delete(key);
    }
  };
}
