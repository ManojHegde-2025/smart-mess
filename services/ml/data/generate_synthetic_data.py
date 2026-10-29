#!/usr/bin/env python3
"""
Synthetic Historical Meal Data Generator for Smart Mess.

Generates ~120 consecutive days of realistic, clearly labelled synthetic meal attendance records
for testing and demonstrating ML demand forecasting before obtaining real attendance data from
the hostel office.

Reproducible via fixed random seed (42).
"""
import csv
from datetime import date, timedelta
from math import ceil
from pathlib import Path
import numpy as np

MESS_ID = "south-mess"
REGISTERED_STUDENTS = 500
START_DATE = date(2026, 7, 1)
END_DATE = date(2026, 10, 28)
MEALS = ["breakfast", "lunch", "dinner"]
SEED = 42

OUTPUT_DIR = Path(__file__).resolve().parent
CSV_PATH = OUTPUT_DIR / "synthetic_meal_history.csv"


def generate_records(seed: int = SEED) -> list[dict]:
    rng = np.random.default_rng(seed)
    total_days = (END_DATE - START_DATE).days + 1
    rows = []

    for day_idx in range(total_days):
        cur_date = START_DATE + timedelta(days=day_idx)
        dow = cur_date.weekday()
        day_name = cur_date.strftime("%A")
        is_weekend = dow >= 5

        # Calendar event modeling
        if date(2026, 10, 17) <= cur_date <= date(2026, 10, 22):
            event = "holiday_break"  # Dussehra / Autumn break
            leaves = int(rng.integers(180, 240))
        elif cur_date == date(2026, 8, 15):
            event = "holiday_independence_day"
            leaves = int(rng.integers(60, 90))
        elif cur_date == date(2026, 10, 2):
            event = "holiday_gandhi_jayanti"
            leaves = int(rng.integers(80, 120))
        elif date(2026, 9, 21) <= cur_date <= date(2026, 9, 26):
            event = "exams"  # Mid-term exams
            leaves = int(rng.integers(5, 12))
        elif date(2026, 9, 11) <= cur_date <= date(2026, 9, 13):
            event = "fest"  # Annual college fest
            leaves = int(rng.integers(8, 15))
        elif date(2026, 7, 1) <= cur_date <= date(2026, 7, 5):
            event = "orientation"  # Semester opening
            leaves = int(rng.integers(30, 45))
        elif is_weekend:
            event = "weekend"
            leaves = int(rng.integers(35, 60))
        else:
            event = "regular"
            leaves = int(rng.integers(15, 25))

        on_campus = max(0, REGISTERED_STUDENTS - leaves)

        # Baseline attendance proportion per meal
        # Breakfast: weekday ~70%, weekend ~52% (sleeping in/brunch)
        bf_rate = 0.52 if is_weekend else 0.70
        if event == "fest":
            bf_rate = 0.55
        elif event == "orientation":
            bf_rate = 0.62

        # Lunch: weekday ~88%, weekend ~75%
        lunch_rate = 0.75 if is_weekend else 0.88
        if event == "exams":
            lunch_rate = 0.91
        elif event == "orientation":
            lunch_rate = 0.82

        # Dinner: weekday ~82%, weekend ~72%
        dinner_rate = 0.72 if is_weekend else 0.82
        if event == "fest":
            dinner_rate = 0.88
        elif event == "orientation":
            dinner_rate = 0.76

        rates = {
            "breakfast": bf_rate,
            "lunch": lunch_rate,
            "dinner": dinner_rate,
        }

        for meal in MEALS:
            noise = float(rng.normal(0, 0.015))
            effective_rate = max(0.1, min(1.0, rates[meal] + noise))
            served = int(np.clip(round(on_campus * effective_rate), 0, on_campus))

            # Preparation includes an operational buffer (5-8%)
            prep_buffer = float(0.05 + rng.uniform(0.01, 0.03))
            prepared = min(
                REGISTERED_STUDENTS,
                max(served, int(ceil(served * (1.0 + prep_buffer)))),
            )

            rows.append(
                {
                    "mess_id": MESS_ID,
                    "date": cur_date.isoformat(),
                    "meal": meal,
                    "served": served,
                    "prepared": prepared,
                    "registered_students": REGISTERED_STUDENTS,
                    "approved_leaves": leaves,
                    "day_of_week": day_name,
                    "event_flag": event,
                    "is_synthetic": "true",
                }
            )

    return rows


def main():
    records = generate_records(SEED)
    print(f"Generating {len(records)} synthetic meal records...")

    fieldnames = [
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
    ]

    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(records)

    total_days = len(records) // len(MEALS)
    print(f"Successfully generated {CSV_PATH}")
    print(f"Total days: {total_days} consecutive days ({START_DATE} to {END_DATE})")
    print(f"Total records: {len(records)} ({total_days} days x {len(MEALS)} meals)")


if __name__ == "__main__":
    main()
