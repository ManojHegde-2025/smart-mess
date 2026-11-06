# Smart Mess 🍽️

### Smart Hostel Mess Management & Meal Intelligence Platform

Smart Mess is a modern hostel mess management platform designed to simplify meal attendance, student account management, mess operations, and food-demand forecasting.

It brings student services, manager operations, QR-based meal verification, financial tracking, and AI-powered insights together in one application.

**Live Application:** https://smart-mess-psi.vercel.app/  
**GitHub Repository:** https://github.com/ManojHegde-2025/smart-mess

---

## ✨ Features

### 👨‍💼 Manager Dashboard
- Centralized mess operations dashboard.
- Real-time meal attendance statistics.
- Student account and balance management.
- Meal preparation and usage tracking.
- Operational settings and configurable meal policies.
- Reports and CSV exports.
- Audit logs and activity tracking.

### 🎓 Student Portal
- Personalized student dashboard.
- Current mess balance and transaction history.
- Meal attendance history.
- QR-based meal verification.
- Leave management.
- Add-on meal and food ordering.

### 📱 QR-Based Attendance
- Dynamic QR token generation.
- Student-side QR scanning using a device camera.
- QR image upload and token entry support.
- Duplicate meal attendance prevention.
- Server-side validation of student identity, meal availability, and attendance rules.

### 📊 Smart Meal Demand Forecasting
- XGBoost-based meal-demand forecasting.
- Separate forecasting for breakfast, lunch, and dinner.
- Historical attendance analysis.
- Model evaluation against a rolling-average baseline.
- Forecast fallback when sufficient historical data is unavailable.

### 🤖 AI-Powered Insights
Powered by Google's Gemini API.

- AI-generated operational insights.
- Meal-demand explanations.
- Preparation recommendations.
- Identification of important operational patterns.
- Manager-focused decision support.

### 🧪 Interactive Demo Mode
Explore the application using a deterministic synthetic dataset without affecting real production records.

- 84 days of synthetic meal history.
- 48 synthetic student accounts.
- Breakfast, lunch, and dinner activity.
- Demo forecasting and AI insights.
- Interactive manager experience.

Demo mode is isolated from the production database. Managers can switch between Live and Demo modes from the deployed application.

### 🔐 Security
- Role-based manager and student access.
- Secure PIN-based authentication.
- HTTP-only session cookies.
- Signed QR tokens.
- Server-side request validation.
- Duplicate attendance protection.
- Audited financial adjustments.
- Separation of synthetic demo data and genuine production data.

---

## 🖥️ Application Preview

**Production application:**  
https://smart-mess-psi.vercel.app/

The application includes:
- Manager workspace
- Student workspace
- Counter QR display
- Attendance management
- Reports and analytics
- AI insights and demand forecasting
- Live and Demo environments

---

## 🛠️ Technology Stack

| Category | Technologies |
|---|---|
| Frontend | Next.js, React, TypeScript |
| Styling | Tailwind CSS, custom CSS |
| Backend | Next.js API Routes |
| Database | PostgreSQL |
| ORM | Drizzle ORM |
| Authentication | JWT sessions using JOSE |
| Machine Learning | Python, FastAPI, XGBoost |
| Generative AI | Google Gemini API |
| Charts | Recharts |
| QR Scanning | html5-qrcode |
| Deployment | Vercel |
| Testing | Node.js tests, Playwright, Pytest |

---

## 🏗️ Architecture

```text
Smart Mess
│
├── src/
│   ├── app/                 # Application pages and API routes
│   ├── components/          # Reusable UI components
│   └── lib/                 # Authentication, database and business logic
│
├── db/                      # Database migrations
│
├── services/
│   └── ml/                  # Python FastAPI and XGBoost service
│
├── scripts/                 # Database and account utilities
│
├── tests/                   # Automated tests
│
├── .github/
│   └── workflows/           # GitHub Actions
│
├── public/                  # Static assets
│
├── package.json
└── README.md
```

### System Overview

The Next.js application provides the user interface, authentication, and API layer. PostgreSQL stores genuine operational records in Live mode.

The Python forecasting service processes historical meal attendance and generates demand predictions using XGBoost.

Gemini provides explanations and recommendations based on structured operational information.

Demo mode uses a separate synthetic dataset and does not write demo records to the production database.

---

## 🚀 Getting Started

### Prerequisites

Install the following before running the project:

- Node.js 24.x
- npm
- Python 3.12 (required for the ML service)
- PostgreSQL (required for persistent Live mode)

### 1. Clone the repository

```bash
git clone https://github.com/ManojHegde-2025/smart-mess.git

cd smart-mess
```

### 2. Install dependencies

```bash
npm ci
```

### 3. Configure environment variables

Create a local environment file:

```bash
cp .env.example .env.local
```

Configure the required variables for the mode you intend to run.

For persistent Live mode, the main configuration includes:

```env
APP_MODE=live
DATABASE_URL=your_postgresql_connection_url
SESSION_SECRET=your_session_secret
QR_SECRET=your_qr_secret
APP_URL=http://localhost:3000
APP_TIME_ZONE=Asia/Kolkata
```

Use separate, randomly generated values for `SESSION_SECRET` and `QR_SECRET`. Never commit `.env.local` or expose credentials.

For Gemini AI functionality, configure the server-side `GEMINI_API_KEY` and the supported `GEMINI_MODEL`.

For Python ML integration, configure the ML service URL and any required service authentication variables according to the project configuration.

Refer to `.env.example` and `ML_SETUP.md` for the complete configuration.

### 4. Run the application

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

### 5. Start the machine-learning service

Follow the instructions in `ML_SETUP.md` to install Python dependencies and start the FastAPI forecasting service.

The ML service is required for the integrated Python/XGBoost forecasting workflow.

---

## 🌐 Deployment

Smart Mess uses Vercel for the Next.js application.

Production:

https://smart-mess-psi.vercel.app/

The production environment uses:

- `APP_MODE=live`
- PostgreSQL for genuine operational records.
- Server-side authentication and API validation.
- The integrated forecasting and AI services when configured.

Demo mode is available through the manager's Live/Demo selector. It should not require changing the production environment variable.

Keep production and preview environment variables and database credentials appropriately isolated.

---

## 🧪 Testing

Run the main application checks:

```bash
npm run typecheck
npm test
npm run build
```

Run the Python ML tests:

```bash
python -m pytest services/ml -q
```

Run the browser checks:

```bash
npm run test:browser
```

For PostgreSQL integration tests, use a dedicated disposable test database and follow the instructions in the project configuration.

---

## 🔮 Future Improvements

Potential areas for further development include:

- Enhanced food-waste analytics.
- Additional forecasting features.
- Expanded institutional integrations.
- More detailed operational reporting.
- Improved notification workflows.
- Further accessibility and mobile experience improvements.

---

## 🔒 Data & Privacy

Smart Mess distinguishes between genuine operational records and synthetic demonstration data.

- Live mode uses the configured PostgreSQL database.
- Demo mode uses synthetic data.
- Demo operations must not modify production records.
- API credentials and database secrets must remain server-side.
- Real student information should never be committed to the public repository.

---

## 👨‍💻 Project

**Smart Mess** is a software project focused on improving hostel mess operations through automation, data analytics, and machine learning.

**Developer:** Manoj Hegde  
**GitHub:** https://github.com/ManojHegde-2025

---

## 📄 License

No license has been specified yet. All rights are reserved unless a license is added to this repository.

