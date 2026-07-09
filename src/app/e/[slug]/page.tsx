import { Suspense } from "react";
import EventClient from "@/components/EventClient";

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Suspense fallback={<p className="sub">Loading…</p>}>
      <EventClient slug={slug} />
    </Suspense>
  );
}
