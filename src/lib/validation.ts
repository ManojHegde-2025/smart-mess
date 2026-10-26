import { z } from "zod";
import { isDate } from "./domain";
export const mealSchema = z.enum(["breakfast", "lunch", "dinner"]);
export const dateSchema = z
  .string()
  .refine(isDate, "Use a valid YYYY-MM-DD date");
export const loginSchema = z.object({
  collegeId: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-zA-Z0-9_-]+$/),
  pin: z.string().regex(/^\d{6,12}$/),
});
export const scanSchema = z.object({ token: z.string().min(5).max(4096) });
export const usageSchema = z.object({
  date: dateSchema,
  meal: mealSchema,
  prepared: z.number().int().min(0).max(100000),
});
export const ledgerSchema = z.object({
  userId: z.string().uuid(),
  amount: z
    .number()
    .int()
    .min(-100000000)
    .max(100000000)
    .refine((n) => n !== 0),
  note: z.string().trim().min(3).max(300),
  requestId: z.string().uuid(),
});
export const addonSchema = z.object({
  addonId: z.string().max(40),
  quantity: z.number().int().min(1).max(10),
  requestId: z.string().uuid(),
});
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const window = z
  .object({ start: clock, end: clock })
  .refine((w) => w.start < w.end, "End time must follow start time");
export const settingsSchema = z
  .object({
    messName: z.string().trim().min(2).max(80),
    windows: z.object({ breakfast: window, lunch: window, dinner: window }),
    prices: z.object({
      breakfast: z.number().int().min(0).max(100000),
      lunch: z.number().int().min(0).max(100000),
      dinner: z.number().int().min(0).max(100000),
    }),
    safetyBuffer: z.number().min(0).max(0.5),
    leavePolicy: z.enum(["flag", "block"]),
    addons: z
      .array(
        z.object({
          id: z
            .string()
            .regex(/^[a-z0-9-]+$/)
            .max(40),
          name: z.string().trim().min(1).max(80),
          price: z.number().int().min(0).max(100000),
        }),
      )
      .max(10),
  })
  .refine(
    (s) => new Set(s.addons.map((a) => a.id)).size === s.addons.length,
    "Add-on IDs must be unique",
  )
  .refine(
    (s) =>
      s.windows.breakfast.end <= s.windows.lunch.start &&
      s.windows.lunch.end <= s.windows.dinner.start,
    "Meal windows must not overlap",
  );
export const wardenSchema = z
  .object({
    eventId: z.string().uuid(),
    collegeId: z.string().min(2).max(40),
    startsOn: dateSchema,
    endsOn: dateSchema,
    status: z.enum(["approved", "rejected"]),
    leaveId: z.string().min(1).max(100),
  })
  .refine((v) => v.startsOn <= v.endsOn, "Invalid leave dates");
