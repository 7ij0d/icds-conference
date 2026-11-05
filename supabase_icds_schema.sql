-- ============================================================================
-- ICDS 4th Edition Dental Conference – PostgreSQL Schema for Libyan Spider Cloud DB (kuro_cloud)
-- Starts 100% clean and empty of any participants, supervisors, receipts, or fake data.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.icds_users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.icds_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.icds_supervisors (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  access_pin TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.icds_registration_days (
  id SERIAL PRIMARY KEY,
  day_key TEXT NOT NULL UNIQUE,
  day_name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.icds_day_supervisor_assignments (
  id SERIAL PRIMARY KEY,
  day_id INTEGER NOT NULL REFERENCES public.icds_registration_days(id) ON DELETE CASCADE,
  shift_number INTEGER NOT NULL DEFAULT 1 CHECK (shift_number IN (1, 2)),
  slot_number INTEGER NOT NULL CHECK (slot_number IN (1, 2, 3, 4)),
  supervisor_id INTEGER REFERENCES public.icds_supervisors(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(day_id, slot_number)
);

CREATE TABLE IF NOT EXISTS public.icds_participants (
  id SERIAL PRIMARY KEY,
  registration_number TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('student', 'doctor')),
  category_label TEXT NOT NULL,
  academic_year TEXT DEFAULT '',
  fee_amount NUMERIC(12, 2) NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'confirmed', 'flagged')),
  payment_confirmed_at TEXT DEFAULT '',
  payment_confirmed_by TEXT DEFAULT '',
  payment_notes TEXT DEFAULT '',
  supervisor_id INTEGER REFERENCES public.icds_supervisors(id) ON DELETE SET NULL,
  supervisor_name TEXT NOT NULL,
  registration_day_id INTEGER REFERENCES public.icds_registration_days(id) ON DELETE SET NULL,
  registration_day_name TEXT NOT NULL,
  shift_number INTEGER NOT NULL DEFAULT 1,
  shift_name TEXT NOT NULL DEFAULT 'الفترة الأولى',
  shift_time TEXT NOT NULL DEFAULT '9:30 ص – 11:30 ص',
  registration_date TEXT NOT NULL,
  registration_time TEXT NOT NULL,
  created_timestamp TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'تسجيل جديد',
  import_batch_id INTEGER,
  is_duplicate_override INTEGER NOT NULL DEFAULT 0,
  duplicate_note TEXT DEFAULT '',
  duplicate_reviewed INTEGER NOT NULL DEFAULT 0,
  extra_data TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS public.icds_receipts (
  id SERIAL PRIMARY KEY,
  participant_id INTEGER NOT NULL UNIQUE REFERENCES public.icds_participants(id) ON DELETE CASCADE,
  file_name TEXT DEFAULT '',
  original_name TEXT DEFAULT '',
  mime_type TEXT DEFAULT '',
  file_size INTEGER DEFAULT 0,
  storage_path TEXT DEFAULT '',
  external_receipt_ref TEXT DEFAULT '',
  uploaded_by_supervisor TEXT DEFAULT '',
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  verified_by TEXT DEFAULT '',
  verified_at TEXT DEFAULT '',
  review_note TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.icds_import_batches (
  id SERIAL PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  total_rows INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  skipped_rows INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,
  total_imported_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  imported_by TEXT NOT NULL,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.icds_audit_logs (
  id SERIAL PRIMARY KEY,
  actor_role TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  action_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT DEFAULT '',
  description TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_icds_participants_name_ar ON public.icds_participants(name_ar);
CREATE INDEX IF NOT EXISTS idx_icds_participants_name_en ON public.icds_participants(name_en);
CREATE INDEX IF NOT EXISTS idx_icds_participants_reg_num ON public.icds_participants(registration_number);
CREATE INDEX IF NOT EXISTS idx_icds_participants_day ON public.icds_participants(registration_day_id);
CREATE INDEX IF NOT EXISTS idx_icds_participants_sup ON public.icds_participants(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_icds_participants_cat ON public.icds_participants(category);

-- Ensure storage bucket for ICDS receipts exists
INSERT INTO storage.buckets (id, name, public, created_at, updated_at)
VALUES ('icds-receipts', 'icds-receipts', false, now(), now())
ON CONFLICT (id) DO NOTHING;

-- Grant permissions for PostgREST roles
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role, authenticator;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role, authenticator;
NOTIFY pgrst, 'reload schema';
