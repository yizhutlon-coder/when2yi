import { getEventRow } from "@/lib/eventData";
import { subscribe } from "@/lib/sse";

type Ctx = { params: Promise<{ slug: string }> };

export const dynamic = "force-dynamic";

/** SSE stream of change events for one event page (§3.3). */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!getEventRow(slug)) return new Response("event not found", { status: 404 });

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const client = {
        send: (data: string) => controller.enqueue(encoder.encode(data)),
        close: () => controller.close(),
      };
      const unsubscribe = subscribe(slug, client);
      client.send(`event: hello\ndata: {}\n\n`);
      const ping = setInterval(() => {
        try {
          client.send(`: ping\n\n`);
        } catch {
          /* closed */
        }
      }, 25000);
      cleanup = () => {
        clearInterval(ping);
        unsubscribe();
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
