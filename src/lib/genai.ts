import { z } from "zod";
import { ApiError } from "./errors";

export const insightSchema = z.object({
  summary: z.string().min(1).max(1200),
  demandAnalysis: z.string().min(1).max(1200),
  wasteAnalysis: z.string().min(1).max(1200),
  recommendation: z.string().min(1).max(1200),
  alerts: z.array(z.string().min(1).max(300)).max(5),
});

export type AiInsight = z.infer<typeof insightSchema>;

export const insightInputSchema = z.object({
  messName: z.string().trim().min(1).max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  forecasts: z
    .array(
      z.object({
        meal: z.string().max(30),
        predicted: z.number().nullable(),
        prepare: z.number().nullable(),
        method: z.string().max(100),
        mae: z.number().nullable(),
        status: z.string().max(100).optional(),
      }),
    )
    .max(10),
  counts: z.record(z.string(), z.number().min(0).max(50000)),
  prepared: z.record(z.string(), z.number().min(0).max(50000)),
  leaveCount: z.number().min(0).max(50000),
  exceptionCount: z.number().min(0).max(50000),
  recentUsage: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        meal: z.string().max(30),
        prepared: z.number().min(0).max(50000),
        served: z.number().min(0).max(50000),
      }),
    )
    .max(60),
});

export type InsightInput = z.infer<typeof insightInputSchema>;

function promptFor(input: InsightInput) {
  return `You are the Generative AI intelligence layer of Smart Mess, a hostel mess management system.

Analyze only the structured data below. Never invent measurements. Treat forecast values as predictions, not actuals. XGBoost is the numerical forecasting engine; your job is to explain its output and turn operational data into useful recommendations.

Generate a concise manager-facing analysis with:
1. A one-sentence summary.
2. Demand analysis explaining the forecast and any notable trend.
3. Waste analysis using prepared versus served meals from the recent data.
4. One practical preparation/operations recommendation.
5. Up to five important alerts. If there are no meaningful alerts, return an empty array.

Return ONLY valid JSON with these keys:
summary, demandAnalysis, wasteAnalysis, recommendation, alerts

SMART MESS DATA:
${JSON.stringify(input, null, 2)}`;
}

export async function generateMessInsights(rawInput: unknown): Promise<AiInsight> {
  const input = insightInputSchema.parse(rawInput);
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  if (!apiKey) {
    throw new ApiError(
      503,
      "Generative AI is not configured. Set GEMINI_API_KEY in the server environment to enable live AI insights.",
      "SERVICE_UNAVAILABLE",
    );
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: "You are a careful operational analytics assistant. Follow the user's requested JSON format exactly and use only supplied data.",
            },
          ],
        },
        contents: [{ role: "user", parts: [{ text: promptFor(input) }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new ApiError(504, "Generative AI request timed out.", "GATEWAY_TIMEOUT");
    }
    throw new ApiError(502, "Failed to connect to Generative AI service.", "BAD_GATEWAY");
  }

  if (!response.ok) {
    throw new ApiError(
      502,
      "Generative AI service request failed.",
      "GENAI_ERROR",
    );
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new ApiError(
      502,
      "Generative AI returned no content.",
      "GENAI_NO_CONTENT",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError(
      502,
      "Generative AI returned invalid JSON.",
      "GENAI_INVALID_JSON",
    );
  }
  return insightSchema.parse(parsed);
}
