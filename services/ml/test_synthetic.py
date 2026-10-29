"""
Tests for Synthetic Historical Meal Attendance Dataset and ML Pipeline Consumption.
"""
import csv
from datetime import date, timedelta
from pathlib import Path
import pytest

from app import forecast, ForecastRequest, Observation, MIN_ML_DAYS

DATA_PATH = Path(__file__).resolve().parent / "data" / "synthetic_meal_history.csv"


@pytest.fixture(scope="module")
def dataset_rows():
    assert DATA_PATH.exists(), f"Synthetic dataset missing at {DATA_PATH}"
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    return rows


def test_synthetic_dataset_schema_and_bounds(dataset_rows):
    assert len(dataset_rows) == 360, f"Expected 360 rows (120 days x 3 meals), got {len(dataset_rows)}"
    expected_headers = {
        "mess_id",
        "date",
        "meal",
        "served",
        "prepared",
        "registered_students",
        "approved_leaves",
        "day_of_week",
        "event_flag",
        "is_synthetic",
    }
    assert expected_headers.issubset(dataset_rows[0].keys())

    seen_keys = set()
    dates_by_meal = {"breakfast": [], "lunch": [], "dinner": []}

    for row in dataset_rows:
        assert row["is_synthetic"] == "true", "Synthetic indicator must be true"
        assert row["mess_id"] == "south-mess"
        assert row["meal"] in dates_by_meal

        key = (row["mess_id"], row["date"], row["meal"])
        assert key not in seen_keys, f"Duplicate found: {key}"
        seen_keys.add(key)

        served = int(row["served"])
        prepared = int(row["prepared"])
        students = int(row["registered_students"])
        leaves = int(row["approved_leaves"])

        assert 0 <= served <= students, f"Served {served} out of bounds (max {students})"
        assert prepared >= served, f"Prepared {prepared} must be >= served {served}"
        assert 0 <= leaves <= students, f"Leaves {leaves} out of bounds"

        dates_by_meal[row["meal"]].append(date.fromisoformat(row["date"]))

    # Verify consecutive days for all meals
    for meal, dates in dates_by_meal.items():
        assert len(dates) == 120, f"Expected 120 days for {meal}, got {len(dates)}"
        sorted_dates = sorted(dates)
        for i in range(1, len(sorted_dates)):
            expected_next = sorted_dates[i - 1] + timedelta(days=1)
            assert sorted_dates[i] == expected_next, f"Gap in dates for {meal}: {sorted_dates[i-1]} -> {sorted_dates[i]}"


@pytest.mark.parametrize("meal", ["breakfast", "lunch", "dinner"])
def test_ml_pipeline_consumes_synthetic_dataset_and_selects_random_forest(dataset_rows, meal):
    history = [
        Observation(date=date.fromisoformat(r["date"]), count=int(r["served"]))
        for r in dataset_rows
        if r["meal"] == meal
    ]
    history.sort(key=lambda o: o.date)
    assert len(history) == 120
    assert len(history) >= MIN_ML_DAYS

    target = history[-1].date + timedelta(days=1)
    req = ForecastRequest(history=history, target_date=target, safety_buffer=0.05)
    res = forecast(req)

    assert res["status"] == "selected", f"Random Forest should beat baseline on synthetic weekly pattern: {res['reason']}"
    assert res["method"] == "Random Forest v2"
    assert res["sample_days"] == 120
    assert res["evaluation_rows"] == 14
    assert res["candidate_mae"] < res["baseline_mae"]
    assert res["predicted"] > 0
    assert res["prepare"] >= res["predicted"]
    assert res["lower"] <= res["predicted"] <= res["upper"]


def test_fallback_behavior_on_insufficient_synthetic_slice(dataset_rows):
    # Truncate to 10 days (< 42 days)
    history = [
        Observation(date=date.fromisoformat(r["date"]), count=int(r["served"]))
        for r in dataset_rows
        if r["meal"] == "lunch"
    ][:10]
    target = history[-1].date + timedelta(days=1)
    res = forecast(ForecastRequest(history=history, target_date=target))
    assert res["status"] == "insufficient_history"
    assert res["method"] == "7-day rolling baseline"
    assert res["candidate_mae"] is None
