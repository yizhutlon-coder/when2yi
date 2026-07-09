/**
 * In-memory SSE pub/sub, keyed by event slug.
 * Single-process by design (spec §5: one Node process, one thing to deploy).
 * globalThis stash survives Next.js dev hot reloads.
 */

type Client = { send: (data: string) => void; close: () => void };

const globalForSse = globalThis as unknown as {
  __when2yi_sse?: Map<string, Set<Client>>;
};

const channels = globalForSse.__when2yi_sse ?? (globalForSse.__when2yi_sse = new Map());

export function subscribe(slug: string, client: Client): () => void {
  let set = channels.get(slug);
  if (!set) channels.set(slug, (set = new Set()));
  set.add(client);
  return () => {
    set.delete(client);
    if (set.size === 0) channels.delete(slug);
  };
}

/** Publish a change event to all viewers of an event page. */
export function publish(slug: string, type: string, payload: unknown = {}): void {
  const set = channels.get(slug);
  if (!set) return;
  const data = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of set) {
    try {
      client.send(data);
    } catch {
      set.delete(client);
    }
  }
}
