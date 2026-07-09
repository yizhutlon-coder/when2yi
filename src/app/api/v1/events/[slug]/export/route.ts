import { NextResponse } from "next/server";
import { toCsv } from "@/lib/csv";
import { getEventRow, loadEventPayload } from "@/lib/eventData";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const ev = getEventRow(slug);
  if (!ev) return NextResponse.json({ error: "event not found" }, { status: 404 });
  const csv = toCsv(loadEventPayload(ev));
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${slug}.csv"`,
    },
  });
}
