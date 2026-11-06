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

export const DEFAULT_PRIMARY_MODEL = "gemini-3.8-flash";
export const DEFAULT_FALLBACK_MODEL = "gemini-3.5-flash-lite";

// Backward compatibility alias exports
export const DEFAULT_GEMINI_MODEL = DEFAULT_PRIMARY_MODEL;
export const FALLBACK_GEMINI_MODEL = DEFAULT_FALLBACK_MODEL;

export const UNAVAILABLE_MESSAGE =
  "AI insights are temporarily unavailable. Your meal attendance and forecasting systems are still operational. Please try again shortly.";

export function getPrimaryModel(): string {
  const envModel = process.env.GEMINI_MODEL?.trim();
  if (envModel === "gemini-2.5-flash" || envModel === "gemini-2.0-flash") {
    console.warn(
      `[GenAI] Configured primary model "${envModel}" is deprecated by Google. Overriding to "${DEFAULT_PRIMARY_MODEL}".`,
    );
    return DEFAULT_PRIMARY_MODEL;
  }
  return envModel || DEFAULT_PRIMARY_MODEL;
}

export function getFallbackModel(): string {
  const envModel = process.env.GEMINI_FALLBACK_MODEL?.trim();
  if (envModel === "gemini-2.5-flash" || envModel === "gemini-2.0-flash") {
    console.warn(
      `[GenAI] Configured fallback model "${envModel}" is deprecated by Google. Overriding to "${DEFAULT_FALLBACK_MODEL}".`,
    );
    return DEFAULT_FALLBACK_MODEL;
  }
  return envModel || DEFAULT_FALLBACK_MODEL;
}

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  if (!Number.isNaN(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 3000); // capped at 3s to stay well within serverless limits
  }
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    const diff = dateMs - Date.now();
    if (diff > 0) return Math.min(diff, 3000);
  }
  return null;
}

export function calculateBackoffDelay(attempt: number, retryAfterHeader: string | null): number {
  const retryAfterMs = parseRetryAfter(retryAfterHeader);
  if (retryAfterMs !== null) return retryAfterMs;
  // Bounded exponential backoff with jitter:
  // attempt 1: ~400ms base + 0-200ms jitter (~400-600ms)
  // attempt 2: ~800ms base + 0-300ms jitter (~800-1100ms)
  const baseMs = 400 * Math.pow(2, attempt - 1);
  const jitterMs = Math.floor(Math.random() * (100 * attempt + 100));
  return Math.min(baseMs + jitterMs, 2000);
}

export async function extractSafeErrorMessage(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as GeminiErrorPayload | null;
  const rawMsg = payload?.error?.message || response.statusText || "Upstream request failed";
  return String(rawMsg).replace(/key=[^&\s]+/gi, "key=[REDACTED]");
}

async function requestGemini(
  model: string,
  apiKey: string,
  prompt: string,
  timeoutMs = 6500,
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
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (err: unknown) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.message.includes("timeout"))) {
      throw new ApiError(504, `Request timed out connecting to model "${model}".`, "GATEWAY_TIMEOUT");
    }
    const message = err instanceof Error ? err.message : "Network error";
    throw new ApiError(502, `Failed to connect to Generative AI service (${model}): ${message}`, "BAD_GATEWAY");
  }
}

export async function generateMessInsights(rawInput: unknown): Promise<AiInsight> {
  const input = insightInputSchema.parse(rawInput);
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    console.warn("[GenAI] Aborting insight generation: GEMINI_API_KEY is not configured.");
    throw new ApiError(
      503,
      "Generative AI is not configured. Set GEMINI_API_KEY in the server environment to enable live AI insights.",
      "SERVICE_UNAVAILABLE",
    );
  }

  const primaryModel = getPrimaryModel();
  const fallbackModel = getFallbackModel();
  const modelChain = primaryModel !== fallbackModel ? [primaryModel, fallbackModel] : [primaryModel];
  const prompt = promptFor(input);

  let successfulResponse: Response | null = null;
  let activeModel = primaryModel;
  let lastFailureStatus = 503;
  let lastFailureMessage = "";

  for (let mIdx = 0; mIdx < modelChain.length; mIdx++) {
    const currentModel = modelChain[mIdx];
    const isPrimary = currentModel === primaryModel;
    // Primary model gets 1 initial attempt + max 2 retries (3 total attempts).
    // Fallback model gets 1 initial attempt + 1 retry (2 total attempts).
    const maxAttempts = isPrimary ? 3 : 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.info(
        `[GenAI] [Attempt ${attempt}/${maxAttempts}] Requesting model "${currentModel}" (mess="${input.messName}", date="${input.date}")...`,
      );

      let response: Response;
      try {
        response = await requestGemini(currentModel, apiKey, prompt, 6500);
      } catch (err: unknown) {
        if (err instanceof ApiError && err.status === 504) {
          lastFailureStatus = 504;
          lastFailureMessage = err.message;
          console.warn(`[GenAI] [Attempt ${attempt}/${maxAttempts}] Model "${currentModel}" timed out.`);
          if (attempt < maxAttempts) {
            await sleep(400);
            continue;
          }
          break; // move to fallback
        }
        const msg = err instanceof Error ? err.message : "Network error";
        lastFailureStatus = 502;
        lastFailureMessage = msg;
        console.warn(`[GenAI] [Attempt ${attempt}/${maxAttempts}] Model "${currentModel}" connection failed: ${msg}`);
        if (attempt < maxAttempts) {
          await sleep(400);
          continue;
        }
        break; // move to fallback
      }

      if (response.ok) {
        console.info(
          `[GenAI] [Attempt ${attempt}/${maxAttempts}] Success: HTTP ${response.status} from model "${currentModel}".`,
        );
        successfulResponse = response;
        activeModel = currentModel;
        break;
      }

      const status = response.status;
      lastFailureStatus = status;
      const safeMsg = await extractSafeErrorMessage(response);
      lastFailureMessage = safeMsg;

      // DO NOT RETRY client errors or authentication failures
      if (status === 400 || status === 401 || status === 403) {
        console.error(
          `[GenAI] Non-retryable client/auth error HTTP ${status} for model "${currentModel}". Message: "${safeMsg}"`,
        );
        throw new ApiError(
          502,
          `Gemini API authentication failed (${status}): ${safeMsg}`,
          "GENAI_AUTH_FAILED",
        );
      }

      // 404: Model not found or deprecated. Do NOT retry this model; switch immediately to fallback.
      if (status === 404) {
        console.warn(
          `[GenAI] Model "${currentModel}" returned HTTP 404 (Not Found). Message: "${safeMsg}". Skipping retries for this model.`,
        );
        if (isPrimary && fallbackModel !== currentModel) {
          console.warn(`[GenAI] Transitioning immediately to fallback model "${fallbackModel}"...`);
        }
        break;
      }

      // 429: Rate limit / quota exceeded
      if (status === 429) {
        console.error(
          `[GenAI] Rate limit exceeded for model "${currentModel}": HTTP 429. Message: "${safeMsg}"`,
        );
        throw new ApiError(
          429,
          `Gemini API quota or rate limit exceeded (${status}): ${safeMsg}`,
          "GENAI_RATE_LIMITED",
        );
      }

      // 503 Service Unavailable: High demand or capacity spike
      if (status === 503) {
        console.warn(
          `[GenAI] [Attempt ${attempt}/${maxAttempts}] Model "${currentModel}" returned HTTP 503 (UNAVAILABLE): "${safeMsg}".`,
        );
        if (attempt < maxAttempts) {
          const delay = calculateBackoffDelay(attempt, response.headers.get("retry-after"));
          console.info(
            `[GenAI] Backing off for ${delay}ms before retry ${attempt + 1}/${maxAttempts} for model "${currentModel}"...`,
          );
          await sleep(delay);
          continue;
        } else if (isPrimary && fallbackModel !== currentModel) {
          console.warn(
            `[GenAI] Primary model "${currentModel}" exhausted ${maxAttempts} attempts on HTTP 503. Transitioning to fallback model "${fallbackModel}"...`,
          );
        }
        break;
      }

      // 502 / 504 or other 5xx upstream errors
      if (status >= 500) {
        console.warn(
          `[GenAI] [Attempt ${attempt}/${maxAttempts}] Model "${currentModel}" returned HTTP ${status}: "${safeMsg}".`,
        );
        if (attempt < maxAttempts) {
          const delay = calculateBackoffDelay(attempt, response.headers.get("retry-after"));
          console.info(`[GenAI] Backing off for ${delay}ms before retry for model "${currentModel}"...`);
          await sleep(delay);
          continue;
        }
        break;
      }

      // Any other unexpected error: stop retries for this model
      console.error(
        `[GenAI] Unexpected HTTP ${status} for model "${currentModel}": "${safeMsg}".`,
      );
      break;
    }

    if (successfulResponse) break;
  }

  // If all models and attempts were exhausted
  if (!successfulResponse) {
    console.error(
      `[GenAI] All models in chain (${modelChain.join(", ")}) exhausted without success. Last status: ${lastFailureStatus}. Last message: "${lastFailureMessage}".`,
    );
    if (lastFailureStatus === 503 || lastFailureStatus === 502 || lastFailureStatus === 504) {
      throw new ApiError(503, UNAVAILABLE_MESSAGE, "SERVICE_UNAVAILABLE");
    }
    throw new ApiError(
      502,
      `Generative AI service request failed (${lastFailureStatus}): ${lastFailureMessage || "Upstream unavailable"}`,
      "GENAI_ERROR",
    );
  }

  const payload = (await successfulResponse.json()) as { candidates?: GeminiCandidate[] };
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    console.error(`[GenAI] Model "${activeModel}" returned no content.`);
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
    console.error(`[GenAI] Model "${activeModel}" returned non-JSON text.`);
    throw new ApiError(
      502,
      "Generative AI returned invalid JSON.",
      "GENAI_INVALID_JSON",
    );
  }

  try {
    const validated = insightSchema.parse(parsed);
    console.info(`[GenAI] Successfully generated and validated insights with model "${activeModel}".`);
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
