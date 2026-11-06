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

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";
export const FALLBACK_GEMINI_MODEL = "gemini-3.5-flash-lite";

function promptFor(input: InsightInput) {
  return `You are the Generative AI intelligence layer of Smart Mess, a hostel mess management system.

Analyze ONLY the structured data provided below. Follow these strict operational rules:
1. Never invent measurements, statistics, or counts not present in the data.
2. Predictions (from the XGBoost forecasting engine) must be clearly distinguished from actual recorded attendance.
3. Never change, recalculate, or contradict the XGBoost numerical forecasts. XGBoost is the authoritative numerical forecasting engine; your job is to explain its outputs, contextualize them with historical patterns, and generate actionable recommendations.
4. Missing values must NOT be assumed to be zero unless explicitly marked as zero.
5. Do not claim that a trend exists without sufficient historical data.
6. Compare prepared versus served meal quantities using actual available numbers. Do NOT describe a difference as confirmed food waste unless the data clearly supports that conclusion (highlight it objectively as possible over-preparation or under-preparation).
7. Recommendations must be practical, actionable, and based strictly on the supplied operational information (e.g. adjusting tomorrow's preparation buffer, monitoring high-demand meals, considering leave patterns).
8. If the input data is insufficient to draw a reliable conclusion, clearly state that in the analysis.

Generate a concise manager-facing analysis with:
1. summary: A concise executive overview (1-2 sentences) of the current mess situation.
2. demandAnalysis: Explain the current XGBoost forecast, meal-wise demand patterns, and notable trends.
3. wasteAnalysis: Analysis of prepared versus served quantities, highlighting possible over-preparation or under-preparation where supported by data.
4. recommendation: One or two practical, actionable operational recommendations for the mess manager.
5. alerts: Up to five important operational alerts (e.g., prefix with "[WARNING]", "[CRITICAL]", or "[INFO]" to indicate severity). If there are no meaningful alerts, return an empty array.

Return ONLY valid JSON with these exact keys:
summary, demandAnalysis, wasteAnalysis, recommendation, alerts

SMART MESS DATA:
${JSON.stringify(input, null, 2)}`;
}

interface GeminiCandidate {
  content?: {
    parts?: Array<{ text?: string }>;
  };
}

interface GeminiErrorPayload {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

async function requestGemini(
  model: string,
  apiKey: string,
  prompt: string,
): Promise<Response> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  try {
    return await fetch(endpoint, {
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
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch (err: unknown) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.message.includes("timeout"))) {
      console.error(`[GenAI] Request timed out connecting to model "${model}".`);
      throw new ApiError(504, "Generative AI request timed out.", "GATEWAY_TIMEOUT");
    }
    const message = err instanceof Error ? err.message : "Network error";
    console.error(`[GenAI] Failed to connect to Gemini API for model "${model}": ${message}`);
    throw new ApiError(502, `Failed to connect to Generative AI service: ${message}`, "BAD_GATEWAY");
  }
}

async function parseGeminiError(response: Response, model: string): Promise<ApiError> {
  const payload = (await response.json().catch(() => null)) as GeminiErrorPayload | null;
  const rawMsg = payload?.error?.message || response.statusText || "Upstream request failed";
  // Safe sanitization: redact any keys or query parameter tokens if reflected by upstream
  const safeMsg = String(rawMsg).replace(/key=[^&\s]+/gi, "key=[REDACTED]");

  console.error(
    `[GenAI] Gemini API failed: HTTP ${response.status} (${response.statusText}) for model "${model}". Upstream message: "${safeMsg}"`,
  );

  if (response.status === 404) {
    return new ApiError(
      502,
      `Configured Gemini model "${model}" is unavailable or deprecated: ${safeMsg}`,
      "GENAI_MODEL_NOT_FOUND",
    );
  }
  if (response.status === 400 || response.status === 401 || response.status === 403) {
    return new ApiError(
      502,
      `Gemini API authentication failed (${response.status}): ${safeMsg}`,
      "GENAI_AUTH_FAILED",
    );
  }
  if (response.status === 429) {
    return new ApiError(
      429,
      `Gemini API quota or rate limit exceeded (${response.status}): ${safeMsg}`,
      "GENAI_RATE_LIMITED",
    );
  }
  if (response.status >= 500) {
    return new ApiError(
      502,
      `Gemini upstream service unavailable (${response.status}): ${safeMsg}`,
      "GENAI_ERROR",
    );
  }
  return new ApiError(
    502,
    `Generative AI service request failed (${response.status}): ${safeMsg}`,
    "GENAI_ERROR",
  );
}

export async function generateMessInsights(rawInput: unknown): Promise<AiInsight> {
  const input = insightInputSchema.parse(rawInput);
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const configuredModel = process.env.GEMINI_MODEL?.trim();
  let primaryModel = configuredModel || DEFAULT_GEMINI_MODEL;

  // Protect against known decommissioned models that return 404
  if (primaryModel === "gemini-2.5-flash" || primaryModel === "gemini-2.0-flash") {
    console.warn(
      `[GenAI] Configured model "${primaryModel}" is deprecated by Google. Overriding to "${DEFAULT_GEMINI_MODEL}".`,
    );
    primaryModel = DEFAULT_GEMINI_MODEL;
  }

  if (!apiKey) {
    console.warn("[GenAI] Aborting insight generation: GEMINI_API_KEY is not configured.");
    throw new ApiError(
      503,
      "Generative AI is not configured. Set GEMINI_API_KEY in the server environment to enable live AI insights.",
      "SERVICE_UNAVAILABLE",
    );
  }

  console.info(
    `[GenAI] Requesting insights: model="${primaryModel}", apiKeyConfigured=true, mess="${input.messName}", date="${input.date}"`,
  );

  const prompt = promptFor(input);
  let response = await requestGemini(primaryModel, apiKey, prompt);

  // Automatic fallback on 404 (model not found/deprecated)
  if (response.status === 404 && primaryModel !== FALLBACK_GEMINI_MODEL) {
    const fallbackModel = primaryModel !== DEFAULT_GEMINI_MODEL ? DEFAULT_GEMINI_MODEL : FALLBACK_GEMINI_MODEL;
    console.warn(
      `[GenAI] Primary model "${primaryModel}" returned 404 Not Found. Attempting fallback to "${fallbackModel}"...`,
    );
    const fallbackResponse = await requestGemini(fallbackModel, apiKey, prompt);
    if (fallbackResponse.ok) {
      console.info(`[GenAI] Fallback model "${fallbackModel}" succeeded.`);
      response = fallbackResponse;
      primaryModel = fallbackModel;
    }
  }

  if (!response.ok) {
    throw await parseGeminiError(response, primaryModel);
  }

  const payload = (await response.json()) as { candidates?: GeminiCandidate[] };
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    console.error(`[GenAI] Model "${primaryModel}" returned no content.`);
    throw new ApiError(
      502,
      "Generative AI returned no content.",
      "GENAI_NO_CONTENT",
    );
  }

  let parsed: unknown;
  try {
    let cleaned = text.trim();
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }
    parsed = JSON.parse(cleaned);
  } catch {
    console.error(`[GenAI] Model "${primaryModel}" returned non-JSON text.`);
    throw new ApiError(
      502,
      "Generative AI returned invalid JSON.",
      "GENAI_INVALID_JSON",
    );
  }

  try {
    const validated = insightSchema.parse(parsed);
    console.info(`[GenAI] Successfully generated and validated insights with model "${primaryModel}".`);
    return validated;
  } catch (err) {
    console.error(`[GenAI] Insights validation error: ${err instanceof Error ? err.message : "Schema error"}`);
    throw new ApiError(
      502,
      "Generative AI response did not match expected structure.",
      "GENAI_INVALID_JSON",
    );
  }
}
