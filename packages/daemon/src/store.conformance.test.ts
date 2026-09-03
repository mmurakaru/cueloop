import { mkdtempSync, writeFileSync } from "node:fs";
import * as v from "valibot";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemorySessionStore, SessionStore, type SessionRepository } from "./store";
import { sessionsDir } from "./paths";
import { runSessionStoreConformance } from "./testing/store-conformance";

const homes = new WeakMap<SessionRepository, string>();

runSessionStoreConformance("file store", {
  open: (records) => {
    const home = mkdtempSync(join(tmpdir(), "cueloop-store-"));
    const store = new SessionStore(home);

    // records land on disk the way an earlier daemon would have written them;
    // the file name comes from the record's id when it has one
    records.forEach((record, index) => {
      const named = v.safeParse(v.object({ id: v.string() }), record);
      const id = named.success ? named.output.id : `bad_${index}`;

      writeFileSync(join(sessionsDir(home), `${id}.json`), JSON.stringify(record));
    });
    homes.set(store, home);

    return store;
  },
  restart: (store) => {
    const reopened = new SessionStore(homes.get(store)!);

    homes.set(reopened, homes.get(store)!);

    return reopened;
  },
});

runSessionStoreConformance("memory store", {
  open: (records) => new MemorySessionStore(records),
  // nothing persists past the instance: a restart recovers what it was seeded with
  restart: (store) => new MemorySessionStore(store.list()),
});
