from datetime import date, timedelta

from fastapi.testclient import TestClient
import pytest

import app as forecasting
from app import app, forecast, ForecastRequest

client = TestClient(app)


def request_body(n=42):
    start = date(2026, 1, 1)
    return {"history": [{"date": str(start + timedelta(days=i)), "count": 100 + (i % 7)*5} for i in range(n)], "target_date": str(start + timedelta(days=n)), "safety_buffer": 0.05}


def test_service_requires_auth(monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "a"*40)
    assert client.post("/predict", json=request_body()).status_code == 401
    assert client.post("/predict", json=request_body(), headers={"x-api-key":"a"*40}).status_code == 200


def test_chronological_evaluation_and_model_selection():
    result = forecast(ForecastRequest(**request_body()))
    assert result["evaluation_rows"] >= 7
    assert result["prepare"] >= result["predicted"] >= 0
    if result["method"].startswith("Random Forest"):
        assert result["candidate_mae"] < result["baseline_mae"]
    else:
        assert result["candidate_mae"] >= result["baseline_mae"]


def test_cold_start_and_missing_days_use_baseline():
    body = request_body(7)
    result = forecast(ForecastRequest(**body))
    assert result["method"] == "7-day rolling baseline"
    assert result["mae"] is None
    body = request_body()
    body["history"].pop(4)
    assert forecast(ForecastRequest(**body))["method"] == "7-day rolling baseline"


def test_future_and_duplicate_observations_rejected():
    body = request_body()
    body["target_date"] = body["history"][-1]["date"]
    with pytest.raises(ValueError): ForecastRequest(**body)
    body = request_body()
    body["history"].append(body["history"][0])
    with pytest.raises(ValueError): ForecastRequest(**body)


@pytest.mark.parametrize("horizon", [1, 2, 7])
def test_weekly_pattern_selects_random_forest_at_requested_horizon(horizon):
    body = request_body(84)
    last_date = date.fromisoformat(body["history"][-1]["date"])
    body["target_date"] = str(last_date + timedelta(days=horizon))
    result = forecast(ForecastRequest(**body))
    assert result["status"] == "selected"
    assert result["candidate_mae"] < result["baseline_mae"]
    assert result["horizon_days"] == horizon
    assert result["evaluation_rows"] == 14
    assert result["lower"] <= result["predicted"] <= result["upper"]
    assert result["prepare"] >= result["predicted"]


def test_two_day_evaluation_does_not_read_intervening_actuals(monkeypatch):
    body = request_body(84)
    body["target_date"] = str(date.fromisoformat(body["history"][-1]["date"]) + timedelta(days=2))
    original = forecasting.project
    evaluations = []
    def capture(model, observed, last_date, horizon):
        if model is not None:
            evaluations.append((list(observed), last_date, horizon))
        return original(model, observed, last_date, horizon)
    monkeypatch.setattr(forecasting, "project", capture)
    forecast(ForecastRequest(**body))
    assert len(evaluations) >= 14
    for target, (observed, origin, horizon) in zip(range(70, 84), evaluations[:14]):
        assert horizon == 2
        assert len(observed) == target - 1
        assert origin == date.fromisoformat(body["history"][target - 2]["date"])
        assert observed == [row["count"] for row in body["history"][:target - 1]]


def test_constant_history_prefers_baseline_and_long_horizon_is_explicit():
    body = request_body(84)
    for row in body["history"]:
        row["count"] = 100
    result = forecast(ForecastRequest(**body))
    assert result["status"] == "baseline_preferred"
    assert result["baseline_mae"] == result["candidate_mae"] == 0
    body["target_date"] = str(date.fromisoformat(body["history"][-1]["date"]) + timedelta(days=8))
    result = forecast(ForecastRequest(**body))
    assert result["status"] == "unsupported_horizon"
    assert result["evaluation_rows"] == 0
