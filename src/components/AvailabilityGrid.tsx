"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EventPayload } from "@/lib/eventData";
import { dayColumns, zonedEpoch } from "@/lib/slots";
import { viabilityBySlot } from "@/lib/composition";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type Tier = "yes" | "if_needed";
export type MySlots = Record<string, Tier>;

interface Props {
  payload: EventPayload;
  /** null → group heatmap only (not signed in yet) */
  mySlots: MySlots | null;
  paintTier: Tier;
  onChange?: (next: MySlots) => void;
}

function timeLabel(min: number): string {
  const h = Math.floor(min / 60);
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ampm}`;
}

function heatColor(count: number, max: number): string {
  if (count <= 0 || max <= 0) return "var(--heat-0)";
  // Single-hue white→blue ramp (colorblind-safe): interpolate lightness.
  const t = count / max;
  const l = 100 - t * 58; // 100% → 42%
  return `hsl(224 76% ${l}%)`;
}

export default function AvailabilityGrid({ payload, mySlots, paintTier, onChange }: Props) {
  const { event, respondents } = payload;
  const editable = mySlots !== null && !!onChange;

  const columns = useMemo(() => {
    const mins = dayColumns(event);
    if (event.mode === "days") {
      return (event.days as number[]).map((d) => ({
        label: DAY_NAMES[d],
        sub: "",
        keys: mins.map((m) => d * 1440 + m),
        mins,
      }));
    }
    return (event.days as string[]).map((dateStr) => ({
      label: new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" }),
      sub: new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      keys: mins.map((m) => zonedEpoch(dateStr, m, event.timezone)),
      mins,
    }));
  }, [event]);

  // Composition viability per slot (spec §3.7). Independent of the tag-count lens.
  const composition = event.composition;
  const viability = useMemo(() => viabilityBySlot(payload, composition), [payload, composition]);

  // Tag-count lens (§3.11): "show overlap counting only Healers".
  const allTags = useMemo(() => payload.tagGroups.flatMap((g) => g.tags), [payload.tagGroups]);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [viableOnly, setViableOnly] = useState(false);

  const filteredRespondents = useMemo(
    () => (tagFilter ? respondents.filter((r) => r.tagIds.includes(tagFilter)) : respondents),
    [respondents, tagFilter]
  );

  // Group availability per slot (firm yes / conditional yes / if-needed).
  const groupBySlot = useMemo(() => {
    const map = new Map<number, { yes: string[]; cond: string[]; ifNeeded: string[] }>();
    for (const r of filteredRespondents) {
      for (const [k, tier] of Object.entries(r.availability)) {
        const key = Number(k);
        let rec = map.get(key);
        if (!rec) map.set(key, (rec = { yes: [], cond: [], ifNeeded: [] }));
        if (tier === "if_needed") rec.ifNeeded.push(r.name);
        else if (r.commitment === "conditional") rec.cond.push(r.name);
        else rec.yes.push(r.name);
      }
    }
    return map;
  }, [filteredRespondents]);

  const maxCount = Math.max(1, filteredRespondents.length);
  const [hover, setHover] = useState<number | null>(null);

  // Horizontal scroll controls: the thin native scrollbar is hard to grab on
  // touch (and the paint cells eat swipes), so offer ◀ ▶ buttons when the grid
  // is wider than its box. Both grids scroll together to stay column-aligned.
  const gridsRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const check = () => {
      let over = false;
      gridsRef.current?.querySelectorAll<HTMLElement>(".gridbox").forEach((b) => {
        if (b.scrollWidth > b.clientWidth + 2) over = true;
      });
      setOverflowing(over);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [columns]);

  function scrollGrids(dir: 1 | -1) {
    const boxes = [...(gridsRef.current?.querySelectorAll<HTMLElement>(".gridbox") ?? [])];
    if (!boxes.length) return;
    // Absolute target off the first grid so both grids land at the same column.
    const target = boxes[0].scrollLeft + dir * Math.max(176, boxes[0].clientWidth * 0.8);
    boxes.forEach((b) => b.scrollTo({ left: target, behavior: "smooth" }));
  }

  // --- painting: When2Meet-style rectangular drag ---
  // The anchor is the cell where the drag started; as the pointer moves we
  // repaint the whole rectangle from that anchor to the cell under the pointer,
  // rebuilding from the pre-drag snapshot each time so cells revert when the
  // rectangle shrinks. `result` lives in the ref (not draft state) so the
  // pointerup commit is immune to render batching / stale closures.
  const drag = useRef<
    { adding: boolean; anchor: { ci: number; row: number }; base: MySlots; result: MySlots } | null
  >(null);
  const [draft, setDraft] = useState<MySlots | null>(null);
  const current = draft ?? mySlots ?? {};

  function paintTo(ci: number, row: number) {
    const d = drag.current;
    if (!d) return;
    const c0 = Math.min(d.anchor.ci, ci), c1 = Math.max(d.anchor.ci, ci);
    const r0 = Math.min(d.anchor.row, row), r1 = Math.max(d.anchor.row, row);
    const next: MySlots = { ...d.base };
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        const key = columns[c]?.keys[r];
        if (key == null) continue;
        if (d.adding) next[String(key)] = paintTier;
        else delete next[String(key)];
      }
    }
    d.result = next;
    setDraft(next);
  }

  function startPaint(ci: number, row: number, key: number) {
    if (!editable) return;
    const base = { ...(mySlots ?? {}) };
    drag.current = { adding: !base[String(key)], anchor: { ci, row }, base, result: base };
    paintTo(ci, row);
  }

  // Resolve the cell under the pointer via hit-testing so a single move handler
  // works for both mouse (pointerenter would do) and touch (implicit pointer
  // capture keeps events on the origin cell, so enter never fires elsewhere).
  function movePaint(e: React.PointerEvent) {
    if (!drag.current) return;
    const cell = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-ci]");
    if (!cell) return;
    const ci = Number(cell.dataset.ci), row = Number(cell.dataset.row);
    if (Number.isNaN(ci) || Number.isNaN(row)) return;
    paintTo(ci, row);
  }

  function endPaint() {
    const d = drag.current;
    if (!editable || !d) return;
    drag.current = null;
    if (onChange) onChange(d.result);
    setDraft(null);
  }

  // Touch uses tap-to-toggle (single cell) instead of drag-paint, so the page
  // still scrolls normally under a finger. `tap` records the touch-down cell/pos
  // and we toggle only if the finger didn't travel (a tap, not a scroll).
  const tap = useRef<{ x: number; y: number; key: number } | null>(null);
  function toggleCell(key: number) {
    if (!editable || !onChange) return;
    const base = { ...(mySlots ?? {}) };
    if (base[String(key)]) delete base[String(key)];
    else base[String(key)] = paintTier;
    onChange(base);
  }

  const hoverInfo = hover !== null ? groupBySlot.get(hover) : null;
  const allNames = respondents.map((r) => r.name);
  const unavailable =
    hoverInfo && allNames.filter((n) => !hoverInfo.yes.includes(n) && !hoverInfo.cond.includes(n) && !hoverInfo.ifNeeded.includes(n));

  function renderTable(kind: "mine" | "group") {
    return (
      <table
        className={`avgrid avgrid-${kind}`}
        onPointerUp={kind === "mine" ? endPaint : undefined}
        onPointerMove={kind === "mine" ? movePaint : undefined}
      >
        <thead>
          <tr>
            <th />
            {columns.map((c, i) => (
              <th key={i}>
                {c.label}
                {c.sub && <div style={{ fontWeight: 400 }}>{c.sub}</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {columns[0]?.mins.map((min, row) => (
            <tr key={min}>
              <td className="timelabel">{min % 60 === 0 ? timeLabel(min) : ""}</td>
              {columns.map((c, ci) => {
                const key = c.keys[row];
                if (kind === "mine") {
                  const tier = current[String(key)];
                  return (
                    <td
                      key={ci}
                      data-ci={ci}
                      data-row={row}
                      className={`slot ${min % 60 === 0 ? "hour" : ""} ${tier === "yes" ? "mine-yes" : tier === "if_needed" ? "mine-if" : ""}`}
                      onPointerDown={(e) => {
                        if (e.pointerType === "mouse" || e.pointerType === "pen") {
                          e.preventDefault();
                          // Keep receiving moves even if the pointer leaves the
                          // cell/table; guarded because it throws on inactive pointers.
                          try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
                          startPaint(ci, row, key);
                        } else {
                          // Touch: remember where the tap began; don't capture, so a
                          // drag scrolls the page instead of painting.
                          tap.current = { x: e.clientX, y: e.clientY, key };
                        }
                      }}
                      onPointerUp={(e) => {
                        if (e.pointerType === "mouse" || e.pointerType === "pen") return;
                        const t = tap.current;
                        tap.current = null;
                        if (t && Math.abs(e.clientX - t.x) < 10 && Math.abs(e.clientY - t.y) < 10) toggleCell(t.key);
                      }}
                    />
                  );
                }
                const g = groupBySlot.get(key);
                const firm = g?.yes.length ?? 0;
                const soft = (g?.cond.length ?? 0) + (g?.ifNeeded.length ?? 0);
                const total = firm + soft;
                const status = composition ? viability.get(key)?.status : undefined;
                const vClass =
                  status === "viable" ? "v-ok" : status === "viable_if" ? "v-if" : "";
                const dim = viableOnly && status !== undefined && status !== "viable";
                return (
                  <td
                    key={ci}
                    className={`slot ${min % 60 === 0 ? "hour" : ""} ${vClass} ${dim ? "v-dim" : ""}`}
                    style={{
                      background: g?.ifNeeded.length
                        ? `var(--if-needed-hatch), ${heatColor(firm, maxCount)}`
                        : heatColor(firm, maxCount),
                      color: firm / maxCount > 0.55 ? "#fff" : undefined,
                    }}
                    onPointerEnter={() => setHover(key)}
                    onPointerLeave={() => setHover((h) => (h === key ? null : h))}
                  >
                    {total > 0 ? (soft ? `${firm}+${soft}` : firm) : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <>
      {overflowing && (
        <div className="gridscroll">
          <button type="button" className="small" onClick={() => scrollGrids(-1)} aria-label="Scroll to earlier days">◀ Earlier</button>
          <span className="sub" style={{ margin: 0 }}>swipe or use these to see more days</span>
          <button type="button" className="small" onClick={() => scrollGrids(1)} aria-label="Scroll to later days">Later ▶</button>
        </div>
      )}
      <div className="grids" ref={gridsRef}>
      {editable && (
        <div className="gridbox">
          <h2>Your availability</h2>
          <div className="legend">
            <span><span className="swatch" style={{ background: "var(--accent)" }} /> available</span>
            <span><span className="swatch" style={{ background: "var(--if-needed-hatch), var(--accent-soft)" }} /> if needed</span>
            <span>drag to paint · tap a cell on touch</span>
          </div>
          {renderTable("mine")}
        </div>
      )}
      <div className="gridbox">
        <h2>Group availability</h2>
        <div className="legend">
          <span><span className="swatch" style={{ background: heatColor(0, 1) }} /> 0</span>
          <span><span className="swatch" style={{ background: heatColor(Math.ceil(maxCount / 2), maxCount) }} /> some</span>
          <span><span className="swatch" style={{ background: heatColor(maxCount, maxCount) }} /> all {filteredRespondents.length || ""}</span>
          {composition && <span><span className="swatch v-ok" /> composition met</span>}
          {composition && <span><span className="swatch v-if" /> met if pinged</span>}
          <span>cells show firm+flexible counts · times in {event.timezone}</span>
        </div>
        {(allTags.length > 0 || composition) && (
          <div className="gridcontrols">
            {allTags.length > 0 && (
              <label>
                Count only:{" "}
                <select value={tagFilter ?? ""} onChange={(e) => setTagFilter(e.target.value || null)}>
                  <option value="">Everyone</option>
                  {payload.tagGroups.map((grp) => (
                    <optgroup key={grp.id} label={grp.name}>
                      {grp.tags.map((t) => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            )}
            {composition && (
              <label>
                <input type="checkbox" checked={viableOnly} onChange={(e) => setViableOnly(e.target.checked)} />{" "}
                Dim non-viable slots
              </label>
            )}
          </div>
        )}
        {renderTable("group")}
      </div>
      <div className="card hoverpanel">
        <h2>Slot details</h2>
        {hoverInfo ? (
          <>
            {composition && hover !== null && (() => {
              const v = viability.get(hover);
              if (!v || v.status === "none") return null;
              const label =
                v.status === "viable" ? "Composition met" :
                v.status === "viable_if" ? "Met only if pinged" : "Composition not met";
              return (
                <div className={`who vstatus ${v.status === "viable" ? "v-ok-text" : v.status === "viable_if" ? "v-if-text" : "v-no-text"}`}>
                  <b>{label}</b>
                  {v.status === "viable_if" && v.neededNames.length > 0 && (
                    <> — needs {v.neededNames.map((n) => <span key={n} className="namechip">{n}</span>)}</>
                  )}
                </div>
              );
            })()}
            <div className="who"><b>Available:</b> {hoverInfo.yes.length ? hoverInfo.yes.map((n) => <span key={n} className="namechip">{n}</span>) : "—"}</div>
            <div className="who"><b>If needed (ping):</b> {[...hoverInfo.cond, ...hoverInfo.ifNeeded].length ? [...new Set([...hoverInfo.cond, ...hoverInfo.ifNeeded])].map((n) => <span key={n} className="namechip">{n}</span>) : "—"}</div>
            <div className="who"><b>Unavailable:</b> {unavailable && unavailable.length ? unavailable.map((n) => <span key={n} className="namechip">{n}</span>) : "—"}</div>
          </>
        ) : (
          <p className="sub" style={{ margin: 0 }}>Hover the group grid to see who can make it.</p>
        )}
      </div>
      </div>
    </>
  );
}
