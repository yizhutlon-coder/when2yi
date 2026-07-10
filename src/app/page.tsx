"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 25 }, (_, h) => h);

interface TagGroupDraft {
  name: string;
  options: string;
  multiSelect: boolean;
}

function hourLabel(h: number): string {
  if (h === 0 || h === 24) return "12:00 AM";
  if (h === 12) return "12:00 PM";
  return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`;
}

/** Simple multi-select month calendar. */
function MiniCalendar({ selected, onToggle }: { selected: Set<string>; onToggle: (d: string) => void }) {
  const today = new Date();
  const [view, setView] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const weeks = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const cells: (string | null)[] = Array(first.getDay()).fill(null);
    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(
        `${view.y}-${String(view.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
      );
    }
    const rows: (string | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [view]);

  const monthName = new Date(view.y, view.m, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  return (
    <div>
      <div className="cal-nav">
        <button type="button" className="small" onClick={() => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { ...v, m: v.m - 1 }))}>←</button>
        <b>{monthName}</b>
        <button type="button" className="small" onClick={() => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { ...v, m: v.m + 1 }))}>→</button>
      </div>
      <table className="cal">
        <thead>
          <tr>{DAY_NAMES.map((d) => <th key={d}>{d}</th>)}</tr>
        </thead>
        <tbody>
          {weeks.map((row, i) => (
            <tr key={i}>
              {row.map((d, j) =>
                d ? (
                  <td key={j} className={selected.has(d) ? "sel" : ""} onClick={() => onToggle(d)}>
                    {Number(d.slice(8))}
                  </td>
                ) : (
                  <td key={j} className="blank" />
                )
              )}
              {row.length < 7 && Array.from({ length: 7 - row.length }, (_, k) => <td key={`p${k}`} className="blank" />)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CreateEventPage() {
  const router = useRouter();
  const browserTz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const timezones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [browserTz];
    }
  }, [browserTz]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<"dates" | "days">("dates");
  const [dates, setDates] = useState<Set<string>>(new Set());
  const [days, setDays] = useState<Set<number>>(new Set());
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(17);
  const [timezone, setTimezone] = useState(browserTz);
  const [deadline, setDeadline] = useState("");
  const [roster, setRoster] = useState("");
  const [groups, setGroups] = useState<TagGroupDraft[]>([]);
  const [comp, setComp] = useState<{ group: number | null; option: string | null; min: number }[]>([]);
  const [allowRosterShift, setAllowRosterShift] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      // Only non-empty groups are sent; composition refers to groups by index, so
      // remap each requirement's index from the full list to the sent (filtered) list.
      const keptGroups = groups.filter((g) => g.name.trim() && g.options.trim());
      const keptIndex = new Map<number, number>();
      groups.forEach((g, gi) => {
        const ki = keptGroups.indexOf(g);
        if (ki >= 0) keptIndex.set(gi, ki);
      });
      const composition: { group: number | null; option: string | null; min: number }[] = [];
      for (const r of comp) {
        if (r.min < 1) continue;
        if (r.group === null || r.option === null) {
          composition.push({ group: null, option: null, min: r.min });
          continue;
        }
        const gi = keptIndex.get(r.group);
        if (gi !== undefined) composition.push({ group: gi, option: r.option, min: r.min });
      }

      const body = {
        name,
        description: description || undefined,
        mode,
        dates: mode === "dates" ? [...dates] : undefined,
        days: mode === "days" ? [...days] : undefined,
        startMin: startHour * 60,
        endMin: endHour * 60,
        timezone,
        deadline: deadline ? Math.floor(new Date(deadline).getTime() / 1000) : undefined,
        roster: roster.trim() ? roster.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
        tagGroups: keptGroups.map((g) => ({
          name: g.name.trim(),
          multiSelect: g.multiSelect,
          required: false,
          options: g.options.split(",").map((s) => s.trim()).filter(Boolean),
        })),
        composition: composition.length ? composition : undefined,
        allowRosterShift: composition.length ? allowRosterShift : undefined,
      };
      const res = await fetch("/api/v1/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Check the form — something is invalid.");
      localStorage.setItem(`w2y:org:${data.event.slug}`, data.organizerToken);
      router.push(`/e/${data.event.slug}?organizer=${data.organizerToken}&new=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Plan a new event</h1>
      <p className="sub">One link, no accounts. Paint availability, watch the heatmap — and every bit of it is scriptable via the <a href="/api/docs?ui">API</a>.</p>
      <form onSubmit={submit}>
        <div className="card">
          <label className="field">
            Event name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Game night" />
          </label>
          <label className="field">
            Description <span style={{ fontWeight: 400, color: "var(--muted)" }}>(optional)</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </label>
        </div>

        <div className="card">
          <h2>When could it happen?</h2>
          <div className="chips" style={{ marginBottom: 12 }}>
            <span className={`chip ${mode === "dates" ? "on" : ""}`} onClick={() => setMode("dates")}>Specific dates</span>
            <span className={`chip ${mode === "days" ? "on" : ""}`} onClick={() => setMode("days")}>Days of the week</span>
          </div>
          <div className="when-layout">
            <div className="when-picker">
              {mode === "dates" ? (
                <MiniCalendar
                  selected={dates}
                  onToggle={(d) => setDates((s) => { const n = new Set(s); if (n.has(d)) n.delete(d); else n.add(d); return n; })}
                />
              ) : (
                <div className="chips">
                  {DAY_NAMES.map((label, i) => (
                    <span key={i} className={`chip ${days.has(i) ? "on" : ""}`}
                      onClick={() => setDays((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}>
                      {label}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="when-times">
              <label className="field">
                No earlier than
                <select value={startHour} onChange={(e) => setStartHour(Number(e.target.value))}>
                  {HOURS.slice(0, 24).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                </select>
              </label>
              <label className="field">
                No later than
                <select value={endHour} onChange={(e) => setEndHour(Number(e.target.value))}>
                  {HOURS.slice(1).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                </select>
              </label>
              <label className="field">
                Time zone
                <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                  {timezones.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </label>
              {mode === "days" && <p className="sub" style={{ margin: 0 }}>Days-of-the-week events assume everyone shares this time zone (When2Meet parity).</p>}
            </div>
          </div>
        </div>

        <details className="card">
          <summary>Sign-up dropdowns <span className="hint">(optional — roles, potluck dishes, whatever)</span></summary>
          {groups.map((g, i) => (
            <div className="row" key={i} style={{ alignItems: "flex-end" }}>
              <label className="field">
                Group name
                <input type="text" value={g.name} placeholder="Role" onChange={(e) => setGroups((gs) => gs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              </label>
              <label className="field">
                Options (comma-separated)
                <input type="text" value={g.options} placeholder="Tank, Healer, DPS" onChange={(e) => setGroups((gs) => gs.map((x, j) => (j === i ? { ...x, options: e.target.value } : x)))} />
              </label>
              <label className="field" style={{ flex: "0 0 auto", minWidth: 0 }}>
                <input type="checkbox" checked={g.multiSelect} onChange={(e) => setGroups((gs) => gs.map((x, j) => (j === i ? { ...x, multiSelect: e.target.checked } : x)))} /> multi
              </label>
              <button type="button" className="small danger" style={{ marginBottom: 12 }} onClick={() => setGroups((gs) => gs.filter((_, j) => j !== i))}>remove</button>
            </div>
          ))}
          <button type="button" onClick={() => setGroups((gs) => [...gs, { name: "", options: "", multiSelect: true }])}>+ Add dropdown</button>
        </details>

        <details className="card">
          <summary>Composition rule <span className="hint">(optional — when is a slot “viable”? e.g. ≥1 Tank, ≥1 Healer, ≥4 total)</span></summary>
          <p className="sub" style={{ margin: "0 0 10px" }}>
            You (the host) set this; everyone else just sees which slots light up as viable. Role
            requirements reference the sign-up dropdown options above.
          </p>
          {comp.map((r, i) => (
            <div className="row" key={i} style={{ alignItems: "flex-end", gap: 8 }}>
              <label className="field" style={{ marginBottom: 8 }}>
                Requirement
                <select
                  value={r.group !== null && r.option !== null ? `${r.group}::${r.option}` : ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setComp((c) => c.map((x, j) => {
                      if (j !== i) return x;
                      if (!v) return { ...x, group: null, option: null };
                      const sep = v.indexOf("::");
                      return { ...x, group: Number(v.slice(0, sep)), option: v.slice(sep + 2) };
                    }));
                  }}
                >
                  <option value="">Any respondent (total)</option>
                  {groups.map((g, gi) => {
                    const opts = g.options.split(",").map((s) => s.trim()).filter(Boolean);
                    return opts.length ? (
                      <optgroup key={gi} label={g.name.trim() || `Group ${gi + 1}`}>
                        {opts.map((label) => <option key={label} value={`${gi}::${label}`}>{label}</option>)}
                      </optgroup>
                    ) : null;
                  })}
                </select>
              </label>
              <label className="field" style={{ flex: "0 0 90px", marginBottom: 8 }}>
                At least
                <input type="number" min={1} value={r.min} onChange={(e) => setComp((c) => c.map((x, j) => (j === i ? { ...x, min: Math.max(1, Number(e.target.value) || 1) } : x)))} />
              </label>
              <button type="button" className="small danger" style={{ marginBottom: 12 }} onClick={() => setComp((c) => c.filter((_, j) => j !== i))}>remove</button>
            </div>
          ))}
          <button type="button" onClick={() => setComp((c) => [...c, { group: null, option: null, min: 1 }])}>+ Add requirement</button>
          <label className="field" style={{ marginTop: 14, marginBottom: 0, fontWeight: 600 }}>
            <input type="checkbox" checked={allowRosterShift} onChange={(e) => setAllowRosterShift(e.target.checked)} />{" "}
            Is swapping members during the event allowed?
            <span className="hint" style={{ display: "block", fontWeight: 400 }}>
              On (default): different people can cover different parts of a meeting. Off: a time only
              counts when one roster can staff the whole block start to finish.
            </span>
          </label>
        </details>

        <details className="card">
          <summary>Extras <span className="hint">(optional)</span></summary>
          <div className="row">
            <label className="field">
              Response deadline
              <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </label>
            <label className="field">
              Expected people (comma-separated — shows who hasn&apos;t responded)
              <input type="text" value={roster} onChange={(e) => setRoster(e.target.value)} placeholder="Yi, Sam, Priya" />
            </label>
          </div>
        </details>

        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy} type="submit">
          {busy ? "Creating…" : "Create event"}
        </button>
      </form>
    </>
  );
}
