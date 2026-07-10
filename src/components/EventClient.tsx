"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { EventPayload } from "@/lib/eventData";
import { viableBlocks, type ViableBlock } from "@/lib/composition";
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
  viability: { status: "none" | "viable" | "viable_if" | "unviable"; neededNames: string[] };
}
interface Summary {
  respondentCount: number;
  topSlots: SummarySlot[];
  missingRoster: string[];
  composition: { requirements: { tagId: string | null; min: number }[] } | null;
  viableCount: number;
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

function fmtMinOfDay(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "Mon Jul 20, 11:00 AM – 1:00 PM" for a contiguous block (end = last slot + 15 min). */
function blockLabel(payload: EventPayload, b: ViableBlock): string {
  if (payload.event.mode === "days") {
    const day = Math.floor(b.startKey / 1440);
    return `${DAY_NAMES[day]}, ${fmtMinOfDay(b.startKey % 1440)} – ${fmtMinOfDay((b.endKey % 1440) + 15)}`;
  }
  const tz = payload.event.timezone;
  const start = new Date(b.startKey * 1000);
  const end = new Date((b.endKey + 900) * 1000);
  const day = start.toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
  const t = (d: Date) => d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  return `${day}, ${t(start)} – ${t(end)}`;
}

function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

/** Paste-ready roster for Discord/Chat: time, role needs, then @-tagged people. */
function blockCopyText(payload: EventPayload, b: ViableBlock): string {
  const lines = [`${blockLabel(payload, b)} (${fmtDuration(b.minutes)})`];
  const roleStr = b.roles.map((r) => `${r.label} ${r.min}`).join(", ");
  const totalStr = b.totalMin > 0 ? `${roleStr ? " · " : ""}${b.totalMin}+ total` : "";
  if (roleStr || totalStr) lines.push(`${roleStr}${totalStr}`);
  if (b.attendees.length) lines.push(b.attendees.map((a) => `@${a.handle || a.name}`).join(" "));
  return lines.join("\n");
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

  const [copiedBlock, setCopiedBlock] = useState<number | null>(null);
  function copyBlock(b: ViableBlock, i: number) {
    navigator.clipboard?.writeText(blockCopyText(payload!, b));
    setCopiedBlock(i);
    setTimeout(() => setCopiedBlock((c) => (c === i ? null : c)), 1500);
  }

  // --- painting / autosave ---
  const [paintTier, setPaintTier] = useState<Tier>("yes");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [localSlots, setLocalSlots] = useState<MySlots | null>(null);

  // --- composition rule (organizer, §3.7) ---
  const [compDraft, setCompDraft] = useState<{ tagId: string | null; min: number }[]>([]);
  const [compAllowShift, setCompAllowShift] = useState(true);
  const [compNotice, setCompNotice] = useState("");
  useEffect(() => {
    setCompDraft(payload?.event.composition?.requirements ?? []);
    setCompAllowShift(payload?.event.composition?.allowRosterShift ?? true);
  }, [payload?.event.composition]);

  async function saveComposition() {
    if (!organizerToken) return;
    setCompNotice("Saving…");
    const res = await fetch(`/api/v1/events/${slug}/composition`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-organizer-token": organizerToken },
      body: JSON.stringify({ requirements: compDraft.filter((r) => r.min >= 1), allowRosterShift: compAllowShift }),
    });
    const data = await res.json();
    if (!res.ok) {
      setCompNotice(typeof data.error === "string" ? data.error : "Save failed");
      return;
    }
    setCompNotice(`Saved — ${data.changedSlots} slot${data.changedSlots === 1 ? "" : "s"} changed viability.`);
    refresh();
  }

  const myRespondent = useMemo(
    () => payload?.respondents.find((r) => r.id === me?.respondentId) ?? null,
    [payload, me]
  );

  // Contiguous viable blocks + swappability for the Best-times panel.
  const blocks = useMemo(() => {
    if (!payload?.event.composition) return [];
    const label = (id: string) =>
      payload.tagGroups.flatMap((g) => g.tags).find((t) => t.id === id)?.label ?? id;
    return viableBlocks(payload, payload.event.composition, label);
  }, [payload]);
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

      {organizerToken && (
        <details className="card">
          <summary>
            Composition rule{" "}
            <span className="hint">(organizer — edit anytime; everyone sees the result)</span>
          </summary>
          {compDraft.length === 0 && (
            <p className="sub" style={{ margin: "0 0 8px" }}>
              No rule set — every slot with availability just shows counts. Add requirements like
              “≥1 Tank, ≥1 Healer, ≥4 total” and viable slots get outlined and ranked first.
            </p>
          )}
          {compDraft.map((r, i) => (
            <div className="row" key={i} style={{ alignItems: "flex-end", gap: 8 }}>
              <label className="field" style={{ marginBottom: 8 }}>
                Requirement
                <select
                  value={r.tagId ?? ""}
                  onChange={(e) =>
                    setCompDraft((d) => d.map((x, j) => (j === i ? { ...x, tagId: e.target.value || null } : x)))
                  }
                >
                  <option value="">Any respondent (total)</option>
                  {tagGroups.map((g) => (
                    <optgroup key={g.id} label={g.name}>
                      {g.tags.map((t) => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="field" style={{ flex: "0 0 90px", marginBottom: 8 }}>
                At least
                <input
                  type="number"
                  min={1}
                  value={r.min}
                  onChange={(e) =>
                    setCompDraft((d) => d.map((x, j) => (j === i ? { ...x, min: Math.max(1, Number(e.target.value) || 1) } : x)))
                  }
                />
              </label>
              <button
                type="button"
                className="small danger"
                style={{ marginBottom: 12 }}
                onClick={() => setCompDraft((d) => d.filter((_, j) => j !== i))}
              >
                remove
              </button>
            </div>
          ))}
          <label className="field" style={{ marginTop: 12, marginBottom: 6, fontWeight: 600 }}>
            <input type="checkbox" checked={compAllowShift} onChange={(e) => setCompAllowShift(e.target.checked)} />{" "}
            Is swapping members during the event allowed?
            <span className="hint" style={{ display: "block", fontWeight: 400 }}>
              On (default): different people can cover different parts of a meeting. Off: a time only
              counts when one roster can staff the whole block start to finish.
            </span>
          </label>
          <div className="toolbar" style={{ marginTop: 4 }}>
            <button type="button" onClick={() => setCompDraft((d) => [...d, { tagId: null, min: 1 }])}>
              + Add requirement
            </button>
            <button type="button" className="primary" onClick={saveComposition}>Save rule</button>
            {compNotice && <span className="sub" style={{ margin: 0 }}>{compNotice}</span>}
          </div>
        </details>
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
          <h2>
            Best times{summary ? ` (${summary.respondentCount} responded)` : ""}
            {summary?.composition ? (
              <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 13 }}>
                {" "}· {summary.viableCount} viable
              </span>
            ) : null}
          </h2>
          {summary?.composition ? (
            blocks.length ? (
              <div className="blocks">
                {blocks.slice(0, 8).map((b, i) => (
                  <details key={i} className="blockrow">
                    <summary>
                      <span className="blocktime">{blockLabel(payload, b)}</span>
                      <span className="blockdur">{fmtDuration(b.minutes)}</span>
                      {b.wholeBlockStaffable ? (
                        <span className="vbadge v-ok-text">✓ staffable throughout</span>
                      ) : (
                        <span className="vbadge v-if-text">roster shifts</span>
                      )}
                      <button
                        type="button"
                        className="small blockcopy"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); copyBlock(b, i); }}
                      >
                        {copiedBlock === i ? "Copied!" : "Copy roster"}
                      </button>
                    </summary>
                    <div className="blockbody">
                      <div className="rolepills">
                        {b.roles.map((r) => (
                          <span key={r.label} className={`rolepill ${r.swappable ? "spare" : "tight"}`}>
                            {r.label} {r.available}/{r.min}
                            {r.swappable ? " · spare" : " · locked"}
                          </span>
                        ))}
                        {b.totalMin > 0 && (
                          <span className={`rolepill ${b.totalAvailable > b.totalMin ? "spare" : "tight"}`}>
                            Total {b.totalAvailable}/{b.totalMin}
                          </span>
                        )}
                      </div>
                      {b.wholeBlockStaffable ? (
                        <>
                          <div className="who">
                            <b>Must attend:</b>{" "}
                            {b.locked.length ? b.locked.map((n) => <span key={n} className="namechip">{n}</span>) : "—"}
                          </div>
                          <div className="who">
                            <b>Swappable:</b>{" "}
                            {b.swappable.length ? b.swappable.map((n) => <span key={n} className="namechip">{n}</span>) : "—"}
                          </div>
                        </>
                      ) : (
                        <p className="sub" style={{ margin: 0 }}>
                          Every 15-min slot here is viable, but no single roster covers the whole block — attendees differ across it.
                        </p>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <p className="sub" style={{ margin: 0 }}>No time block currently meets the composition rule.</p>
            )
          ) : summary?.topSlots.length ? (
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
