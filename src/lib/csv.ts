import type { EventPayload } from "./eventData";

function esc(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function slotLabel(payload: EventPayload, slotKey: number): string {
  if (payload.event.mode === "days") {
    const day = Math.floor(slotKey / 1440);
    const min = slotKey % 1440;
    const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const hh = String(Math.floor(min / 60)).padStart(2, "0");
    const mm = String(min % 60).padStart(2, "0");
    return `${names[day]} ${hh}:${mm}`;
  }
  return new Date(slotKey * 1000).toLocaleString("en-US", {
    timeZone: payload.event.timezone,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Rows = slots, columns = respondents. Cells: yes | if_needed | (blank). */
export function toCsv(payload: EventPayload): string {
  const header = ["slot", ...payload.respondents.map((r) => esc(r.name))].join(",");
  const commitmentRow = [
    "commitment",
    ...payload.respondents.map((r) => r.commitment),
  ].join(",");
  const lines = payload.slots.map((key) => {
    const cells = payload.respondents.map((r) => r.availability[String(key)] ?? "");
    return [esc(slotLabel(payload, key)), ...cells].join(",");
  });
  return [header, commitmentRow, ...lines].join("\n") + "\n";
}
