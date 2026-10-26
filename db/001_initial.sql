CREATE TABLE IF NOT EXISTS messes (
  id text PRIMARY KEY, name text NOT NULL
);
INSERT INTO messes(id,name) VALUES ('south-mess','South Mess') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY, college_id text NOT NULL UNIQUE, name text NOT NULL,
  role text NOT NULL CHECK (role IN ('student','manager')), mess_id text NOT NULL REFERENCES messes(id),
  pin_hash text NOT NULL, active boolean NOT NULL DEFAULT true, session_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS settings (
  mess_id text PRIMARY KEY REFERENCES messes(id), value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS meal_events (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), mess_id text NOT NULL REFERENCES messes(id),
  meal text NOT NULL CHECK (meal IN ('breakfast','lunch','dinner')), service_date date NOT NULL,
  scanned_at timestamptz NOT NULL DEFAULT now(), decision text NOT NULL CHECK (decision IN ('accepted','rejected')),
  reason text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_meal_per_student ON meal_events(user_id,service_date,meal) WHERE decision='accepted';
CREATE INDEX IF NOT EXISTS meal_events_daily ON meal_events(mess_id,service_date,meal);
CREATE TABLE IF NOT EXISTS ledger_entries (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), amount integer NOT NULL,
  kind text NOT NULL, note text NOT NULL, reference text NOT NULL UNIQUE,
  actor_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_user ON ledger_entries(user_id,created_at);
CREATE TABLE IF NOT EXISTS leaves (
  id uuid PRIMARY KEY, external_id text NOT NULL UNIQUE, user_id uuid NOT NULL REFERENCES users(id),
  starts_on date NOT NULL, ends_on date NOT NULL, status text NOT NULL CHECK (status IN ('approved','rejected')),
  source text NOT NULL DEFAULT 'warden', updated_at timestamptz NOT NULL DEFAULT now(), CHECK(starts_on<=ends_on)
);
CREATE INDEX IF NOT EXISTS leave_student ON leaves(user_id,starts_on,ends_on);
CREATE TABLE IF NOT EXISTS meal_usage (
  mess_id text NOT NULL REFERENCES messes(id), service_date date NOT NULL,
  meal text NOT NULL CHECK(meal IN ('breakfast','lunch','dinner')), prepared integer NOT NULL CHECK(prepared>=0),
  updated_by uuid REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(mess_id,service_date,meal)
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY, mess_id text NOT NULL REFERENCES messes(id), actor_id uuid REFERENCES users(id),
  action text NOT NULL, detail jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS login_attempts (
  key text PRIMARY KEY, count integer NOT NULL DEFAULT 1, window_start timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS integration_events (
  id uuid PRIMARY KEY, payload_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
-- Browser database clients must not access these tables. Next.js uses a private,
-- server-only database connection as the table-owning application role.
ALTER TABLE messes ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_events ENABLE ROW LEVEL SECURITY;
