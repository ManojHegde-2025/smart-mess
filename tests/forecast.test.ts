import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { demandForecasts } from "../src/lib/forecast";
import { demoHistory } from "../src/lib/demo-history";

test("prediction boundary excludes partial/future data, authenticates, and shares identical requests", async () => {
  const saved = {
    url: process.env.ML_SERVICE_URL,
    key: process.env.ML_API_KEY,
  };
  const today = "2026-10-19";
  const received: { body: Record<string, any>; key: string | undefined }[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    received.push({ body, key: req.headers["x-api-key"] as string });
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        predicted: 39,
        prepare: 41,
        lower: 30,
        upper: 45,
        method: "Random Forest v2",
        mae: 1,
        baseline_mae: 8,
        candidate_mae: 1,
        evaluation_rows: 14,
        sample_days: body.history.length,
        horizon_days: 2,
        history_through: "2026-10-18",
        model_version: "rf-v2",
        status: "selected",
        reason: "Model improved holdout error.",
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as { port: number };
    process.env.ML_SERVICE_URL = `http://127.0.0.1:${address.port}`;
    process.env.ML_API_KEY = "test-key-is-long-enough-for-local-tests";
    const history = [
      ...demoHistory(today),
      {
        date: "2026-10-21",
        meal: "lunch" as const,
        served: 9999,
        prepared: 9999,
      },
    ];
    const [first, second] = await Promise.all([
      demandForecasts(history, today, 0.05),
      demandForecasts(history, today, 0.05),
    ]);
    assert.deepEqual(first, second);
    assert.equal(received.length, 3);
    for (const request of received) {
      assert.equal(request.key, process.env.ML_API_KEY);
      assert.equal(request.body.target_date, "2026-10-20");
      assert.equal(request.body.history.length, 84);
      assert.ok(
        request.body.history.every(
          (r: any) =>
            r.date < today && Object.keys(r).sort().join() === "count,date",
        ),
      );
    }
    assert.ok(
      first.every(
        (f) =>
          f.source === "python" &&
          f.mlStatus === "selected" &&
          f.horizonDays === 2,
      ),
    );
    await demandForecasts(history, today, 0.05);
    assert.equal(
      received.length,
      3,
      "Dashboard refresh should reuse identical forecasts",
    );
    const updated = history.map((r) =>
      r.date === "2026-10-18" ? { ...r, served: r.served + 1 } : r,
    );
    await demandForecasts(updated, today, 0.05);
    assert.equal(
      received.length,
      6,
      "New completed observations should invalidate the cache",
    );
  } finally {
    if (saved.url === undefined) delete process.env.ML_SERVICE_URL;
    else process.env.ML_SERVICE_URL = saved.url;
    if (saved.key === undefined) delete process.env.ML_API_KEY;
    else process.env.ML_API_KEY = saved.key;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("invalid ML output, failed authentication, and missing configuration stay visibly on the baseline", async () => {
  const saved = {
    url: process.env.ML_SERVICE_URL,
    key: process.env.ML_API_KEY,
  };
  let status = 200;
  const server = createServer((_req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ predicted: -9, method: "Random Forest" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    process.env.ML_SERVICE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    process.env.ML_API_KEY = "another-service-test-key-with-32-characters";
    const history = demoHistory("2026-10-19");
    let result = await demandForecasts(history, "2026-10-19", 0.05);
    assert.ok(
      result.every(
        (f) =>
          f.mlStatus === "unavailable" &&
          f.source === "local" &&
          f.predicted! >= 0,
      ),
    );
    status = 401;
    result = await demandForecasts(history, "2026-10-19", 0.1);
    assert.ok(result.every((f) => f.mlStatus === "unavailable"));
    delete process.env.ML_API_KEY;
    result = await demandForecasts(history, "2026-10-19", 0.05);
    assert.ok(result.every((f) => f.mlStatus === "not_configured"));
  } finally {
    if (saved.url === undefined) delete process.env.ML_SERVICE_URL;
    else process.env.ML_SERVICE_URL = saved.url;
    if (saved.key === undefined) delete process.env.ML_API_KEY;
    else process.env.ML_API_KEY = saved.key;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
