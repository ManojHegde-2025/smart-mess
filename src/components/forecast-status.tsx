import type { Forecast } from "@/lib/types";

const labels: Record<NonNullable<Forecast["mlStatus"]>, string> = {
  selected: "ML model active",
  baseline_preferred: "Baseline performed better",
  insufficient_history: "More history needed",
  gapped_history: "History has missing days",
  unsupported_horizon: "Target beyond model horizon",
  not_configured: "ML not connected",
  unavailable: "ML unavailable · fallback active",
};

export function ForecastStatus({
  forecast: f,
  details = false,
}: {
  forecast: Forecast;
  details?: boolean;
}) {
  return (
    <div className="ml-status" data-testid={`ml-status-${f.meal}`}>
      <span
        className={`badge ${f.mlStatus === "selected" ? "green" : "amber"}`}
      >
        {f.mlStatus ? labels[f.mlStatus] : "Rolling average"}
      </span>
      {f.isSynthetic && (
        <span
          className="badge neutral synthetic-badge"
          data-testid={`synthetic-badge-${f.meal}`}
          style={{
            marginLeft: "6px",
            fontSize: "11px",
            fontWeight: "600",
            letterSpacing: "0.03em",
          }}
        >
          DEMO DATA — SYNTHETIC FORECAST
        </span>
      )}
      {details && (
        <>
          <p className="small muted">
            Forecast for {f.date} · Prepare {f.prepare ?? "—"} meals
          </p>
          {Boolean(f.evaluationDays) && (
            <div className="report-metrics">
              <span>
                Random Forest MAE <b>{f.candidateMae ?? "—"}</b>
              </span>
              <span>
                Baseline MAE <b>{f.baselineMae ?? "—"}</b>
              </span>
              <span>
                Held-out days <b>{f.evaluationDays}</b>
              </span>
              <span>
                Forecast horizon <b>{f.horizonDays} days</b>
              </span>
            </div>
          )}
          {f.historyThrough && (
            <p className="small muted">
              Completed data through {f.historyThrough}. Source: Python
              prediction service.
            </p>
          )}
          <p className="footnote">{f.note}</p>
        </>
      )}
    </div>
  );
}
