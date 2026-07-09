import { z } from "zod";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const tagGroupInput = z.object({
  name: z.string().trim().min(1).max(40),
  multiSelect: z.boolean().default(true),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(40)).min(1).max(30),
});

export const createEventInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional(),
    mode: z.enum(["dates", "days"]),
    /** mode "dates": YYYY-MM-DD[]; mode "days": (0-6)[] */
    dates: z.array(z.string().regex(DATE_RE)).max(62).optional(),
    days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    startMin: z.number().int().min(0).max(1425).multipleOf(15),
    endMin: z.number().int().min(15).max(1440).multipleOf(15),
    timezone: z.string().min(1).max(64),
    deadline: z.number().int().positive().optional(),
    roster: z.array(z.string().trim().min(1).max(60)).max(100).optional(),
    tagGroups: z.array(tagGroupInput).max(10).optional(),
  })
  .refine((v) => v.endMin > v.startMin, { message: "endMin must be after startMin" })
  .refine((v) => (v.mode === "dates" ? (v.dates?.length ?? 0) > 0 : (v.days?.length ?? 0) > 0), {
    message: "provide dates[] for mode 'dates' or days[] for mode 'days'",
  })
  .refine((v) => !v.timezone || isValidTimezone(v.timezone), { message: "unknown timezone" });

export const patchEventInput = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    dates: z.array(z.string().regex(DATE_RE)).max(62).optional(),
    days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    startMin: z.number().int().min(0).max(1425).multipleOf(15).optional(),
    endMin: z.number().int().min(15).max(1440).multipleOf(15).optional(),
    deadline: z.number().int().positive().nullable().optional(),
    roster: z.array(z.string().trim().min(1).max(60)).max(100).nullable().optional(),
  })
  .strict();

export const signInInput = z.object({
  name: z.string().trim().min(1).max(60),
  pin: z.string().min(1).max(64).optional(),
  commitment: z.enum(["yes", "conditional"]).default("yes"),
  discordHandle: z.string().trim().max(64).optional(),
  tagIds: z.array(z.string()).max(100).optional(),
});

export const patchRespondentInput = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    commitment: z.enum(["yes", "conditional"]).optional(),
    discordHandle: z.string().trim().max(64).nullable().optional(),
    tagIds: z.array(z.string()).max(100).optional(),
  })
  .strict();

export const putAvailabilityInput = z.object({
  /** Full replacement, When2Meet-autosave style. */
  slots: z
    .array(
      z.object({
        slotKey: z.number().int(),
        tier: z.enum(["yes", "if_needed"]).default("yes"),
      })
    )
    .max(5000),
});

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export type CreateEventInput = z.infer<typeof createEventInput>;
export type SignInInput = z.infer<typeof signInInput>;
