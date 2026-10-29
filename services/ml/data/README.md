# Synthetic Historical Meal Attendance Dataset

This directory contains a clearly labelled, reproducible synthetic dataset designed to test and demonstrate the Smart Mess meal-demand forecasting pipeline before real historical attendance data is obtained from the hostel office.

> **IMPORTANT**: This data is entirely synthetic and generated for demonstration, modeling, and automated testing purposes. It does not represent actual hostel attendance or individual student records.

---

## Dataset Overview

- **File**: `synthetic_meal_history.csv`
- **Total Days**: 120 consecutive calendar days
- **Date Range**: 2026-07-01 to 2026-10-28
- **Meals Covered**: Breakfast, Lunch, Dinner (3 meals/day)
- **Total Records**: 360 records (120 days × 3 meal sessions)
- **Mess ID**: `south-mess`
- **Synthetic Indicator**: Every row contains `is_synthetic=true`

---

## Schema & Column Definitions

| Column | Type | Description |
| :--- | :--- | :--- |
| `mess_id` | `text` | Hostel mess identifier (`south-mess`) |
| `date` | `date (YYYY-MM-DD)` | Service date of the meal session |
| `meal` | `text` | Meal period: `breakfast`, `lunch`, or `dinner` |
| `served` | `integer` | Aggregate meal attendance (non-negative integer, bounded by registered population) |
| `prepared` | `integer` | Kitchen preparation quantity (includes operational safety buffer; `prepared >= served`) |
| `registered_students` | `integer` | Total student population registered for the mess (fixed at 500) |
| `approved_leaves` | `integer` | Number of students with approved leave on that date |
| `day_of_week` | `text` | Full weekday name (Monday through Sunday) |
| `event_flag` | `text` | Calendar context tag (`regular`, `weekend`, `orientation`, `exams`, `fest`, `holiday_break`) |
| `is_synthetic` | `boolean` | Flag indicating synthetic data (`true`) |

---

## Assumptions & Modeling Logic

1. **Student Population Constraint**:
   - Total registered students = 500.
   - On-campus students = `registered_students - approved_leaves`.
   - `0 <= served <= on_campus <= 500`.

2. **Meal Attendance Variations**:
   - **Breakfast**:
     - Weekdays: ~70% attendance (~320–350 students).
     - Weekends: ~52% attendance (~240–270 students due to sleeping in / brunch).
   - **Lunch**:
     - Weekdays: ~88% attendance (~410–440 students).
     - Weekends: ~75% attendance (~350–380 students).
   - **Dinner**:
     - Weekdays: ~82% attendance (~380–410 students).
     - Weekends: ~72% attendance (~330–360 students due to weekend outings).

3. **Academic Calendar & Event Dynamics**:
   - **July 1–5 (Orientation / Opening)**: Lower breakfast (~62%), moderate leaves (30–45).
   - **August 15 (Independence Day)**: Holiday leave spike (60–90 leaves).
   - **September 11–13 (Annual College Fest)**: Peak dinner attendance (~88%), low leaves (8–15).
   - **September 21–26 (Mid-Term Exams)**: High lunch presence (~91%), minimal leaves (5–12).
   - **October 2 (Gandhi Jayanti)**: Holiday weekend leaves (80–120 leaves).
   - **October 17–22 (Dussehra / Autumn Break)**: Significant leave spike (180–240 students traveling home), sharply reducing mess attendance.
   - **October 23–28 (Post-Break Resumption)**: Normal attendance restored.

4. **Natural Daily Variation**:
   - Added Gaussian noise ($\sigma = 0.015$) to prevent unnatural, perfectly identical day-to-day numbers.
   - Preparation counts include an operational buffer ($\approx 5\text{--}8\%$).

5. **Reproducibility**:
   - Generated using NumPy's default random generator with a fixed seed (`seed = 42`).

---

## How to Regenerate the Dataset

From the repository root, run:

```bash
./services/ml/.venv/bin/python services/ml/data/generate_synthetic_data.py
```

Or using system Python (3.11+):

```bash
python3 services/ml/data/generate_synthetic_data.py
```

---

## How to Run the Forecasting Pipeline Against It

### 1. Python ML Service Standalone Verification
Run the verification script to confirm that the Random Forest model trains successfully on the 120-day dataset:

```bash
./services/ml/.venv/bin/python services/ml/demo_forecast.py
```

### 2. Next.js Manager Dashboard Integration
Enable synthetic forecast demo mode by running the application with `FORECAST_DEMO_DATA=true` or passing `?forecastSource=synthetic` to the overview endpoint:

```bash
# In .env.local or shell:
FORECAST_DEMO_DATA=true
npm run dev
```

The manager dashboard at `/manager` and `/manager/reports` will display predictions trained on the 120-day synthetic dataset, with an explicit badge: `DEMO DATA — SYNTHETIC FORECAST`.
