-- Allow pending and cancelled leave request statuses
ALTER TABLE leaves DROP CONSTRAINT IF EXISTS leaves_status_check;
ALTER TABLE leaves ADD CONSTRAINT leaves_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'));
ALTER TABLE leaves ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE leaves ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS leaves_status_idx ON leaves(user_id, status);
