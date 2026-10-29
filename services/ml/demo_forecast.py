#!/usr/bin/env python3
"""
Demonstrate ML Demand Forecasting on Synthetic Historical Data.

Loads `synthetic_meal_history.csv` and executes the existing production forecasting pipeline
in `services/ml/app.py` without modifying model code or hardcoding values.
"""
import csv
from datetime import date, timedelta
from pathlib import Path
import sys

# Ensure services/ml is in python path
current_dir = Path(__file__).resolve().parent
if str(current_dir) not in sys.path:
    sys.path.insert(0, str(current_dir))

from app import forecast, ForecastRequest, Observation

DATA_PATH = current_dir / "data" / "synthetic_meal_history.csv"


def load_synthetic_observations(meal: str) -> list[Observation]:
    if not DATA_PATH.exists():
        raise FileNotFoundError(f"Synthetic dataset not found at {DATA_PATH}. Run generate_synthetic_data.py first.")

    observations = []
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row["meal"] == meal:
                observations.append(
                    Observation(
                        date=date.fromisoformat(row["date"]),
                        count=int(row["served"]),
                    )
                )
    return sorted(observations, key=lambda o: o.date)


def run_demo(safety_buffer: float = 0.05, target_date: date | None = None) -> dict[str, dict]:
    results = {}
    meals = ["breakfast", "lunch", "dinner"]

    for meal in meals:
        history = load_synthetic_observations(meal)
        if not target_date:
            target = history[-1].date + timedelta(days=1)
        else:
            target = target_date

        req = ForecastRequest(
            history=history,
            target_date=target,
            safety_buffer=safety_buffer,
        )
        res = forecast(req)
        # Mark as synthetic demonstration result
        res["is_synthetic"] = True
        results[meal] = res

    return results


def main():
    print("=" * 70)
    print("SMART MESS: ML DEMAND FORECASTING (SYNTHETIC DATA DEMO)")
    print("=" * 70)

    results = run_demo(safety_buffer=0.05)

    for meal, res in results.items():
        print(f"\n[{meal.upper()} FORECAST]")
        print(f"  Target Date:       {res['history_through']} + {res['horizon_days']} day(s)")
        print(f"  Completed Days:    {res['sample_days']} days (through {res['history_through']})")
        print(f"  Model Selected:    {res['method']} ({res['status']})")
        print(f"  Predicted Count:   {res['predicted']} meals")
        print(f"  Prepare Buffer:    {res['prepare']} meals (with 5% buffer)")
        print(f"  Recent Variation:  {res['lower']} – {res['upper']} meals")
        if res.get("candidate_mae") is not None:
            print(f"  Candidate MAE:     {res['candidate_mae']} meals")
            print(f"  Baseline MAE:      {res['baseline_mae']} meals")
            print(f"  Holdout Days:      {res['evaluation_rows']} days")
        print(f"  Model Note:        {res['reason']}")

    print("\n" + "=" * 70)
    print("All forecasts generated via real Random Forest training on synthetic data.")
    print("=" * 70)


if __name__ == "__main__":
    main()
