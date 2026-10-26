"""Per-meal aggregate forecasts, with horizon-matched chronological evaluation."""
from datetime import date, timedelta
from math import ceil, floor
import hmac
import os

import numpy as np
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, model_validator
from sklearn.ensemble import RandomForestRegressor

app = FastAPI(title="Smart Mess demand prediction", version="2.0.0")
MIN_ML_DAYS = 42
FEATURES = ["day_of_week", "weekend", "previous_day", "same_day_last_week", "mean_7_days", "mean_14_days", "weekly_trend"]


class Observation(BaseModel):
    date: date
    count: int = Field(ge=0, le=100_000)


class ForecastRequest(BaseModel):
    history: list[Observation] = Field(min_length=7, max_length=730)
    target_date: date
    safety_buffer: float = Field(default=0.05, ge=0, le=0.5)

    @model_validator(mode="after")
    def validate_dates(self):
        dates = [row.date for row in self.history]
        if len(set(dates)) != len(dates):
            raise ValueError("History dates must be unique")
        if self.target_date <= max(dates):
            raise ValueError("Target date must follow all observed dates")
        return self


def features(day: date, observed: list[float]) -> list[float]:
    recent = float(np.mean(observed[-7:]))
    return [day.weekday(), int(day.weekday() >= 5), observed[-1], observed[-7],
            recent, float(np.mean(observed[-14:])), recent - float(np.mean(observed[-14:-7]))]


def project(model, observed: list[float], last_date: date, horizon: int) -> float:
    """Fill unobserved intervening days with predictions, never future actuals."""
    values = list(observed)
    for step in range(1, horizon + 1):
        day = last_date + timedelta(days=step)
        estimate = (float(model.predict([features(day, values)])[0])
                    if model is not None else float(np.mean(values[-7:])))
        values.append(max(0.0, estimate))
    return values[-1]


def forecast(request: ForecastRequest) -> dict:
    rows = sorted(request.history, key=lambda row: row.date)
    values = [float(row.count) for row in rows]
    horizon = (request.target_date - rows[-1].date).days
    contiguous = all(rows[i].date == rows[i - 1].date + timedelta(days=1) for i in range(1, len(rows)))
    supported = 1 <= horizon <= 7
    predicted = (project(None, values, rows[-1].date, horizon)
                 if contiguous and supported else float(np.mean(values[-7:])))
    method = "7-day rolling baseline"
    status = "insufficient_history"
    reason = f"Random Forest needs at least {MIN_ML_DAYS} consecutive completed days per meal."
    candidate_mae = baseline_mae = None
    evaluation_rows = 0

    if not contiguous:
        status, reason = "gapped_history", "Missing service days are not assumed to be zero; using the observed-count baseline."
    elif not supported:
        status, reason = "unsupported_horizon", "The trained model supports targets up to seven days after the last completed observation."
    elif len(rows) >= MIN_ML_DAYS:
        holdout = min(14, max(7, len(rows) // 5))
        first_target = len(rows) - holdout
        # The candidate is trained only on observations available at the FIRST origin.
        train_end = first_target - horizon + 1
        x = [features(rows[i].date, values[:i]) for i in range(14, len(rows))]
        y = values[14:]
        model = RandomForestRegressor(n_estimators=96, max_depth=8,
                                      min_samples_leaf=2, random_state=42, n_jobs=1)
        model.fit(x[:train_end - 14], y[:train_end - 14])
        candidate_errors, baseline_errors = [], []
        for i in range(first_target, len(rows)):
            origin = i - horizon
            available = values[:origin + 1]
            candidate_errors.append(abs(values[i] - project(model, available, rows[origin].date, horizon)))
            baseline_errors.append(abs(values[i] - project(None, available, rows[origin].date, horizon)))
        candidate_mae = float(np.mean(candidate_errors))
        baseline_mae = float(np.mean(baseline_errors))
        evaluation_rows = holdout
        if candidate_mae < baseline_mae:
            model.fit(x, y)
            predicted = project(model, values, rows[-1].date, horizon)
            method = "Random Forest v2"
            status = "selected"
            reason = "Random Forest improved on the rolling baseline at the same forecast horizon."
        else:
            status = "baseline_preferred"
            reason = "The trained Random Forest did not beat the baseline on held-out days; the baseline was retained."

    spread = float(np.std(values[-7:]))
    count = max(0, round(predicted))
    return {
        "predicted": count, "prepare": max(count, ceil(predicted * (1 + request.safety_buffer))),
        "lower": max(0, min(count, floor(predicted - spread))),
        "upper": max(count, ceil(predicted + spread)), "method": method,
        "mae": round(candidate_mae if status == "selected" else baseline_mae, 2) if baseline_mae is not None else None,
        "baseline_mae": round(baseline_mae, 2) if baseline_mae is not None else None,
        "candidate_mae": round(candidate_mae, 2) if candidate_mae is not None else None,
        "evaluation_rows": evaluation_rows, "sample_days": len(rows), "horizon_days": horizon,
        "history_through": str(rows[-1].date), "status": status, "reason": reason,
        "model_version": "rf-v2" if status == "selected" else "rolling-v2",
        "features": FEATURES, "minimum_ml_days": MIN_ML_DAYS,
        "range_note": "Recent observed variation; not a calibrated confidence interval.",
        "evaluation_note": "Chronological holdout at the requested horizon; unobserved intervening days are predicted recursively. Lower MAE is better; historical results do not guarantee future accuracy.",
    }


@app.get("/health")
def health():
    return {"status": "ok", "service": "aggregate-demand", "version": "2.0.0"}


@app.post("/predict")
def predict(request: ForecastRequest, x_api_key: str = Header(default="")):
    expected = os.environ.get("ML_API_KEY", "")
    if len(expected) < 32 or not hmac.compare_digest(expected.encode(), x_api_key.encode()):
        raise HTTPException(401, "Valid service authentication is required")
    return forecast(request)
