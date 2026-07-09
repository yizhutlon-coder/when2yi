import { NextResponse } from "next/server";
import { computeSummary, getEventRow, loadEventPayload } from "@/lib/eventData";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const ev = getEventRow(slug);
  if (!ev) return NextResponse.json({ error: "event not found" }, { status: 404 });
  const url = new URL(req.url);
  const topN = Math.min(50, Math.max(1, Number(url.searchParams.get("top") ?? 10) || 10));
  return NextResponse.json(computeSummary(loadEventPayload(ev), topN));
}
