"use client";

import { useMemo, useRef, useState } from "react";
import type { EventPayload } from "@/lib/eventData";
import { dayColumns, zonedEpoch } from "@/lib/slots";

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

  // Group availability per slot (firm yes / conditional yes / if-needed).
  const groupBySlot = useMemo(() => {
    const map = new Map<number, { yes: string[]; cond: string[]; ifNeeded: string[] }>();
    for (const r of respondents) {
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
  }, [respondents]);

  const maxCount = Math.max(1, respondents.length);
  const [hover, setHover] = useState<number | null>(null);

  // --- painting ---
  const drag = useRef<{ adding: boolean } | null>(null);
  const [draft, setDraft] = useState<MySlots | null>(null);
  const current = draft ?? mySlots ?? {};

  function applyCell(key: number) {
    if (!drag.current) return;
    setDraft((d) => {
      const base = { ...(d ?? mySlots ?? {}) };
      if (drag.current!.adding) base[String(key)] = paintTier;
      else delete base[String(key)];
      return base;
    });
  }

  function startPaint(key: number) {
    if (!editable) return;
    drag.current = { adding: !current[String(key)] };
    applyCell(key);
  }

  function endPaint() {
    if (!editable || !drag.current) return;
    drag.current = null;
    setDraft((d) => {
      if (d && onChange) onChange(d);
      return d;
    });
  }

  const hoverInfo = hover !== null ? groupBySlot.get(hover) : null;
  const allNames = respondents.map((r) => r.name);
  const unavailable =
    hoverInfo && allNames.filter((n) => !hoverInfo.yes.includes(n) && !hoverInfo.cond.includes(n) && !hoverInfo.ifNeeded.includes(n));

  function renderTable(kind: "mine" | "group") {
    return (
      <table className="avgrid" onPointerUp={endPaint} onPointerLeave={endPaint}>
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
                      className={`slot ${min % 60 === 0 ? "hour" : ""} ${tier === "yes" ? "mine-yes" : tier === "if_needed" ? "mine-if" : ""}`}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        startPaint(key);
                      }}
                      onPointerEnter={() => applyCell(key)}
                    />
                  );
                }
                const g = groupBySlot.get(key);
                const firm = g?.yes.length ?? 0;
                const soft = (g?.cond.length ?? 0) + (g?.ifNeeded.length ?? 0);
                const total = firm + soft;
                return (
                  <td
                    key={ci}
                    className={`slot ${min % 60 === 0 ? "hour" : ""}`}
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
    <div className="grids">
      {editable && (
        <div className="gridbox">
          <h2>Your availability</h2>
          <div className="legend">
            <span><span className="swatch" style={{ background: "var(--accent)" }} /> available</span>
            <span><span className="swatch" style={{ background: "var(--if-needed-hatch), var(--accent-soft)" }} /> if needed</span>
            <span>click &amp; drag to paint</span>
          </div>
          {renderTable("mine")}
        </div>
      )}
      <div className="gridbox">
        <h2>Group availability</h2>
        <div className="legend">
          <span><span className="swatch" style={{ background: heatColor(0, 1) }} /> 0</span>
          <span><span className="swatch" style={{ background: heatColor(Math.ceil(maxCount / 2), maxCount) }} /> some</span>
          <span><span className="swatch" style={{ background: heatColor(maxCount, maxCount) }} /> all {respondents.length || ""}</span>
          <span>cells show firm+flexible counts · times in {event.timezone}</span>
        </div>
        {renderTable("group")}
      </div>
      <div className="card hoverpanel">
        <h2>Slot details</h2>
        {hoverInfo ? (
          <>
            <div className="who"><b>Available:</b> {hoverInfo.yes.length ? hoverInfo.yes.map((n) => <span key={n} className="namechip">{n}</span>) : "—"}</div>
            <div className="who"><b>If needed (ping):</b> {[...hoverInfo.cond, ...hoverInfo.ifNeeded].length ? [...new Set([...hoverInfo.cond, ...hoverInfo.ifNeeded])].map((n) => <span key={n} className="namechip">{n}</span>) : "—"}</div>
            <div className="who"><b>Unavailable:</b> {unavailable && unavailable.length ? unavailable.map((n) => <span key={n} className="namechip">{n}</span>) : "—"}</div>
          </>
        ) : (
          <p className="sub" style={{ margin: 0 }}>Hover the group grid to see who can make it.</p>
        )}
      </div>
    </div>
  );
}
