"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { EventPayload } from "@/lib/eventData";
import AvailabilityGrid, { type MySlots, type Tier } from "./AvailabilityGrid";

interface Me {
  respondentId: string;
  editToken: string;
}
interface SummarySlot {
  slotKey: number;
  yes: number;
  ifNeeded: number;
  conditionalYes: number;
  names: { yes: string[]; ifNeeded: string[]; conditionalYes: string[] };
}
interface Summary {
  respondentCount: number;
  topSlots: SummarySlot[];
  missingRoster: string[];
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function slotLabel(payload: EventPayload, slotKey: number): string {
  if (payload.event.mode === "days") {
    const day = Math.floor(slotKey / 1440);
    const min = slotKey % 1440;
    const h = Math.floor(min / 60);
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${DAY_NAMES[day]} ${h12}:${String(min % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  }
  return new Date(slotKey * 1000).toLocaleString("en-US", {
    timeZone: payload.event.timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function EventClient({ slug }: { slug: string }) {
  const search = useSearchParams();
  const [payload, setPayload] = useState<EventPayload | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);

  const organizerToken =
    search.get("organizer") ??
    (typeof window !== "undefined" ? localStorage.getItem(`w2y:org:${slug}`) : null);
  const isNew = search.get("new") === "1";

  // --- data loading ---
  const refresh = useCallback(async () => {
    const [pRes, sRes] = await Promise.all([
      fetch(`/api/v1/events/${slug}`),
      fetch(`/api/v1/events/${slug}/summary?top=5`),
    ]);
    if (pRes.status === 404) {
      setNotFound(true);
      return;
    }
    setPayload(await pRes.json());
    if (sRes.ok) setSummary(await sRes.json());
  }, [slug]);

  useEffect(() => {
    refresh();
    const stored = localStorage.getItem(`w2y:me:${slug}`);
    if (stored) setMe(JSON.parse(stored));
  }, [slug, refresh]);

  // --- SSE live updates (§3.3) ---
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    const es = new EventSource(`/api/v1/events/${slug}/stream`);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => refreshRef.current(), 250);
    };
    for (const type of ["respondent.created", "respondent.updated", "respondent.deleted", "availability.updated", "event.updated"]) {
      es.addEventListener(type, bump);
    }
    return () => {
      es.close();
      if (timer) clearTimeout(timer);
    };
  }, [slug]);

  // --- sign in ---
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [commitment, setCommitment] = useState<"yes" | "conditional">("yes");
  const [pickedTags, setPickedTags] = useState<Set<string>>(new Set());

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch(`/api/v1/events/${slug}/respondents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        pin: pin || undefined,
        commitment,
        tagIds: [...pickedTags],
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Sign-in failed");
      return;
    }
    const nextMe = { respondentId: data.respondentId, editToken: data.editToken };
    localStorage.setItem(`w2y:me:${slug}`, JSON.stringify(nextMe));
    setMe(nextMe);
    refresh();
  }

  // --- painting / autosave ---
  const [paintTier, setPaintTier] = useState<Tier>("yes");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [localSlots, setLocalSlots] = useState<MySlots | null>(null);

  const myRespondent = useMemo(
    () => payload?.respondents.find((r) => r.id === me?.respondentId) ?? null,
    [payload, me]
  );
  useEffect(() => {
    // Respondent got deleted (moderation) → drop stale identity.
    if (payload && me && !myRespondent) {
      localStorage.removeItem(`w2y:me:${slug}`);
      setMe(null);
      setLocalSlots(null);
    }
  }, [payload, me, myRespondent, slug]);

  const mySlots: MySlots | null = me ? localSlots ?? (myRespondent?.availability as MySlots) ?? {} : null;

  function saveSlots(next: MySlots) {
    setLocalSlots(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (!me) return;
      await fetch(`/api/v1/events/${slug}/respondents/${me.respondentId}/availability`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-edit-token": me.editToken },
        body: JSON.stringify({
          slots: Object.entries(next).map(([k, tier]) => ({ slotKey: Number(k), tier })),
        }),
      });
    }, 500);
  }

  // --- organizer actions ---
  async function removeRespondent(rid: string) {
    if (!organizerToken) return;
    await fetch(`/api/v1/events/${slug}/respondents/${rid}`, {
      method: "DELETE",
      headers: { "x-organizer-token": organizerToken },
    });
  }

  if (notFound) return <p className="error">Event not found — check the link.</p>;
  if (!payload) return <p className="sub">Loading…</p>;

  const { event, tagGroups, respondents } = payload;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? (typeof window !== "undefined" ? window.location.origin : "");
  const shareUrl = `${baseUrl}/e/${slug}`;
  const deadlinePassed = !!event.deadline && Date.now() / 1000 > event.deadline;

  return (
    <>
      {isNew && organizerToken && (
        <div className="notice">
          <b>Save your organizer link</b> (shown once — it's the only way to edit this event):{" "}
          <code>{`${shareUrl}?organizer=${organizerToken}`}</code>
        </div>
      )}
      <h1>{event.name}</h1>
      {event.description && <p className="sub">{event.description}</p>}
      <div className="toolbar">
        <button className="small" onClick={() => navigator.clipboard.writeText(shareUrl)}>Copy share link</button>
        <a className="chip" href={`/api/v1/events/${slug}/export`}>CSV</a>
        <a className="chip" href="/api/docs?ui">API</a>
        {event.deadline && (
          <span className="sub" style={{ margin: 0 }}>
            {deadlinePassed ? "Responses closed" : `Respond by ${new Date(event.deadline * 1000).toLocaleString()}`}
          </span>
        )}
      </div>

      {!me && !deadlinePassed && (
        <form className="card" onSubmit={signIn}>
          <h2>Join in</h2>
          <div className="row">
            <label className="field">
              Your name
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label className="field">
              PIN <span style={{ fontWeight: 400, color: "var(--muted)" }}>(optional — protects your name)</span>
              <input type="text" value={pin} onChange={(e) => setPin(e.target.value)} />
            </label>
            <label className="field">
              Commitment
              <select value={commitment} onChange={(e) => setCommitment(e.target.value as "yes" | "conditional")}>
                <option value="yes">For sure going (when I&apos;m free)</option>
                <option value="conditional">Ping me if I&apos;m needed</option>
              </select>
            </label>
          </div>
          {tagGroups.map((g) => (
            <div key={g.id} style={{ marginBottom: 8 }}>
              <b style={{ fontSize: 13 }}>{g.name}</b>
              <div className="chips">
                {g.tags.map((t) => (
                  <span
                    key={t.id}
                    className={`chip ${pickedTags.has(t.id) ? "on" : ""}`}
                    onClick={() =>
                      setPickedTags((s) => {
                        const n = new Set(s);
                        if (n.has(t.id)) n.delete(t.id);
                        else {
                          if (!g.multiSelect) for (const other of g.tags) n.delete(other.id);
                          n.add(t.id);
                        }
                        return n;
                      })
                    }
                  >
                    {t.label}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {error && <p className="error">{error}</p>}
          <button className="primary" type="submit">Continue</button>
        </form>
      )}

      <AvailabilityGrid payload={payload} mySlots={deadlinePassed ? null : mySlots} paintTier={paintTier} onChange={saveSlots} />

      {me && !deadlinePassed && (
        <div className="toolbar" style={{ marginTop: 8 }}>
          <span className="sub" style={{ margin: 0 }}>Painting as:</span>
          <span className={`chip ${paintTier === "yes" ? "on" : ""}`} onClick={() => setPaintTier("yes")}>Available</span>
          <span className={`chip ${paintTier === "if_needed" ? "on" : ""}`} onClick={() => setPaintTier("if_needed")}>If needed</span>
        </div>
      )}

      <div className="row" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Best times{summary ? ` (${summary.respondentCount} responded)` : ""}</h2>
          {summary?.topSlots.length ? (
            <table className="plain">
              <thead>
                <tr><th>Slot</th><th>Sure</th><th>Ping-if-needed</th></tr>
              </thead>
              <tbody>
                {summary.topSlots.map((s) => (
                  <tr key={s.slotKey}>
                    <td>{slotLabel(payload, s.slotKey)}</td>
                    <td>{s.yes}</td>
                    <td>{s.conditionalYes + s.ifNeeded}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="sub" style={{ margin: 0 }}>No availability painted yet.</p>
          )}
          {summary && summary.missingRoster.length > 0 && (
            <p className="sub" style={{ marginTop: 10 }}>
              Waiting on: {summary.missingRoster.join(", ")}
            </p>
          )}
        </div>

        <div className="card">
          <h2>People ({respondents.length})</h2>
          <table className="plain">
            <tbody>
              {respondents.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.name}
                    {r.id === me?.respondentId && " (you)"}
                  </td>
                  <td className="sub">{r.commitment === "conditional" ? "ping if needed" : "for sure"}</td>
                  <td className="sub">
                    {r.tagIds
                      .map((id) => tagGroups.flatMap((g) => g.tags).find((t) => t.id === id)?.label)
                      .filter(Boolean)
                      .join(", ")}
                  </td>
                  <td>
                    {organizerToken && (
                      <button className="small danger" onClick={() => removeRespondent(r.id)}>remove</button>
                    )}
                  </td>
                </tr>
              ))}
              {respondents.length === 0 && (
                <tr><td className="sub">Nobody yet — share the link!</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
