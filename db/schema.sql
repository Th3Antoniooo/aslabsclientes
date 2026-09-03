CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS modules (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  module_id text NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  can_view boolean NOT NULL DEFAULT false,
  can_create boolean NOT NULL DEFAULT false,
  can_edit boolean NOT NULL DEFAULT false,
  can_delete boolean NOT NULL DEFAULT false,
  PRIMARY KEY (role_id, module_id)
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  full_name text NOT NULL,
  company text,
  initials varchar(4),
  password_hash text NOT NULL,
  requires_worker_pin boolean NOT NULL DEFAULT false,
  role_id uuid NOT NULL REFERENCES roles(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'invited')),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  pin_failed_attempts integer NOT NULL DEFAULT 0,
  pin_locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS dni varchar(8);
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_dni_unique_idx ON users(dni) WHERE dni IS NOT NULL;
CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  type text NOT NULL DEFAULT 'info',
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  audience text NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'admin', 'client')),
  action_url text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS analysts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text UNIQUE,
  specialty text,
  license_number text,
  pin_hash text,
  pin_configured_at timestamptz,
  pin_last_used_at timestamptz,
  biotechnology_access boolean NOT NULL DEFAULT false,
  can_create_biotechnology_codes boolean NOT NULL DEFAULT false,
  can_use_equipment boolean NOT NULL DEFAULT true,
  code_creator_only boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analysts_status_name_idx ON analysts(status, full_name);
ALTER TABLE analysts ADD COLUMN IF NOT EXISTS can_create_biotechnology_codes boolean NOT NULL DEFAULT false;
ALTER TABLE analysts ADD COLUMN IF NOT EXISTS can_use_equipment boolean NOT NULL DEFAULT true;
ALTER TABLE analysts ADD COLUMN IF NOT EXISTS code_creator_only boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS operational_alert_acknowledgements (
  alert_key text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  acknowledged_by_analyst_id uuid REFERENCES analysts(id) ON DELETE SET NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (alert_key, user_id)
);
CREATE INDEX IF NOT EXISTS operational_alert_ack_user_time_idx
  ON operational_alert_acknowledgements(user_id, acknowledged_at DESC);

CREATE TABLE IF NOT EXISTS laboratory_worker_sessions (
  session_id uuid PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  analyst_id uuid NOT NULL REFERENCES analysts(id) ON DELETE CASCADE,
  activated_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS laboratory_worker_sessions_analyst_idx
  ON laboratory_worker_sessions(analyst_id, last_activity_at DESC);

CREATE TABLE IF NOT EXISTS service_catalog (
  id text PRIMARY KEY,
  category_id text NOT NULL,
  category_name text NOT NULL,
  name text NOT NULL,
  description text,
  estimated_duration text,
  icon text,
  group_name text,
  matrix_scope text,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_catalog_category_order_idx ON service_catalog(category_id, sort_order);

CREATE TABLE IF NOT EXISTS field_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  site_type text NOT NULL CHECK (site_type IN ('laboratory', 'sampling')),
  client_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  address text,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS field_sites_type_client_idx ON field_sites(site_type, client_user_id, active);

CREATE TABLE IF NOT EXISTS service_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  client_user_id uuid NOT NULL REFERENCES users(id),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  service_type_id text NOT NULL,
  service_type_name text NOT NULL,
  quote_reference text,
  zone_name text NOT NULL,
  sample_count integer NOT NULL DEFAULT 1 CHECK (sample_count BETWEEN 1 AND 500),
  priority text NOT NULL DEFAULT 'estandar' CHECK (priority IN ('estandar', 'rapida', 'urgente')),
  notes text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'in_progress', 'completed', 'rejected')),
  current_stage_position integer NOT NULL DEFAULT 0,
  sample_intake_mode text NOT NULL DEFAULT 'client_delivery'
    CHECK (sample_intake_mode IN ('client_delivery','aslabs_collection','aslabs_sampling','none')),
  sample_intake_scheduled_at timestamptz,
  requested_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  archived_at timestamptz,
  archived_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  archive_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS quote_reference text;
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS current_stage_position integer NOT NULL DEFAULT 0;
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS service_category_id text;
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS service_category_name text;
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS sampling_site_id uuid REFERENCES field_sites(id) ON DELETE SET NULL;
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS archived_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS archive_reason text;
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS sample_intake_scheduled_at timestamptz;
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS sample_intake_mode text NOT NULL DEFAULT 'client_delivery';
CREATE INDEX IF NOT EXISTS service_requests_client_time_idx ON service_requests(client_user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS service_requests_status_time_idx ON service_requests(status, requested_at DESC);
CREATE INDEX IF NOT EXISTS service_requests_archived_time_idx ON service_requests(archived_at DESC) WHERE archived_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS service_requests_sample_schedule_idx ON service_requests(sample_intake_scheduled_at) WHERE sample_intake_scheduled_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS service_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  catalog_service_id text NOT NULL,
  category_id text NOT NULL,
  category_name text NOT NULL,
  service_name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_id, catalog_service_id)
);
CREATE INDEX IF NOT EXISTS service_request_items_service_order_idx
  ON service_request_items(service_id, sort_order, created_at);

CREATE TABLE IF NOT EXISTS worker_service_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analyst_id uuid NOT NULL REFERENCES analysts(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  assigned_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (analyst_id, service_id)
);
CREATE INDEX IF NOT EXISTS worker_service_assignments_analyst_idx
  ON worker_service_assignments(analyst_id, active, updated_at DESC);
CREATE INDEX IF NOT EXISTS worker_service_assignments_service_idx
  ON worker_service_assignments(service_id, active);

CREATE TABLE IF NOT EXISTS service_workflow_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  stage_key text NOT NULL,
  position integer NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'current', 'completed')),
  performed_by text,
  analyst_id uuid REFERENCES analysts(id),
  analyst text,
  observations text,
  started_at timestamptz,
  completed_at timestamptz,
  updated_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_id, stage_key),
  UNIQUE (service_id, position)
);
ALTER TABLE service_workflow_stages ADD COLUMN IF NOT EXISTS analyst_id uuid REFERENCES analysts(id);
CREATE INDEX IF NOT EXISTS service_workflow_service_position_idx ON service_workflow_stages(service_id, position);

CREATE TABLE IF NOT EXISTS service_stage_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL REFERENCES service_workflow_stages(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  data_url text NOT NULL,
  uploaded_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_stage_photos_stage_idx ON service_stage_photos(stage_id, created_at);

CREATE TABLE IF NOT EXISTS service_stage_events (
  id bigserial PRIMARY KEY,
  service_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  stage_id uuid REFERENCES service_workflow_stages(id) ON DELETE SET NULL,
  action text NOT NULL,
  from_position integer,
  to_position integer,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_stage_events_service_time_idx ON service_stage_events(service_id, created_at DESC);

CREATE TABLE IF NOT EXISTS service_final_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  version integer NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/pdf',
  file_size integer NOT NULL CHECK (file_size > 0),
  data_url text NOT NULL,
  notes text,
  is_current boolean NOT NULL DEFAULT true,
  approval_status text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  approval_requested_at timestamptz NOT NULL DEFAULT now(),
  approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  rejection_notes text,
  uploaded_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_id, version)
);
CREATE INDEX IF NOT EXISTS service_final_reports_service_time_idx
  ON service_final_reports(service_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS service_final_reports_one_current_idx
  ON service_final_reports(service_id) WHERE is_current = true;
ALTER TABLE service_final_reports ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pending';
ALTER TABLE service_final_reports ADD COLUMN IF NOT EXISTS approval_requested_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE service_final_reports ADD COLUMN IF NOT EXISTS approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE service_final_reports ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE service_final_reports ADD COLUMN IF NOT EXISTS rejection_notes text;
ALTER TABLE service_final_reports ADD COLUMN IF NOT EXISTS interpretation text;
ALTER TABLE service_final_reports ADD COLUMN IF NOT EXISTS observations text;
UPDATE service_final_reports SET approval_status='approved',approved_at=COALESCE(approved_at,created_at)
WHERE is_current=true AND approval_status='pending';
CREATE INDEX IF NOT EXISTS service_final_reports_approval_idx
  ON service_final_reports(approval_status, approval_requested_at DESC);

CREATE TABLE IF NOT EXISTS public_document_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash char(64) NOT NULL UNIQUE,
  document_type text NOT NULL CHECK (document_type IN ('sample_intake', 'final_report')),
  service_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  sample_intake_id uuid,
  final_report_id uuid REFERENCES service_final_reports(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_accessed_at timestamptz
);

CREATE TABLE IF NOT EXISTS email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  event_type text NOT NULL,
  service_id uuid REFERENCES service_requests(id) ON DELETE SET NULL,
  client_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  recipient_email text,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  provider_message_id text,
  provider_last_event text,
  preview_html text,
  error_message text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS provider_last_event text;
ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS preview_html text;

CREATE INDEX IF NOT EXISTS email_deliveries_service_idx ON email_deliveries(service_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_deliveries_status_idx ON email_deliveries(status, created_at);

CREATE TABLE IF NOT EXISTS service_analysis_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  service_item_id uuid REFERENCES service_request_items(id) ON DELETE SET NULL,
  sample_code text,
  parameter text NOT NULL,
  result_value text NOT NULL,
  unit text,
  minimum_value text,
  maximum_value text,
  reference_value text,
  method text,
  observations text,
  sort_order integer NOT NULL DEFAULT 0,
  recorded_by_user_id uuid NOT NULL REFERENCES users(id),
  recorded_by_analyst_id uuid REFERENCES analysts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_analysis_results_service_idx
  ON service_analysis_results(service_id, sort_order, created_at);
ALTER TABLE service_analysis_results ADD COLUMN IF NOT EXISTS identified_agent text;
ALTER TABLE service_analysis_results ADD COLUMN IF NOT EXISTS result_group_key text NOT NULL DEFAULT 'result-1';
ALTER TABLE service_analysis_results ADD COLUMN IF NOT EXISTS result_group_label text NOT NULL DEFAULT 'Resultado 1';

CREATE TABLE IF NOT EXISTS service_analysis_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  data_url text NOT NULL,
  uploaded_by_user_id uuid NOT NULL REFERENCES users(id),
  uploaded_by_analyst_id uuid REFERENCES analysts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_analysis_photos_service_idx
  ON service_analysis_photos(service_id, created_at);

CREATE TABLE IF NOT EXISTS laboratory_equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  equipment_type text NOT NULL,
  brand text,
  model text,
  serial_number text,
  location text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'inactive')),
  notes text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS laboratory_equipment_type_status_idx
  ON laboratory_equipment(equipment_type, status, code);

CREATE TABLE IF NOT EXISTS laboratory_equipment_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_code text NOT NULL UNIQUE,
  equipment_id uuid NOT NULL REFERENCES laboratory_equipment(id) ON DELETE RESTRICT,
  equipment_type text NOT NULL,
  work_area text NOT NULL DEFAULT 'laboratory' CHECK (work_area IN ('laboratory', 'biotechnology')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'cancelled')),
  material_description text NOT NULL,
  storage_position text,
  started_at timestamptz NOT NULL DEFAULT now(),
  expected_end_at timestamptz,
  ended_at timestamptz,
  temperature_c numeric(7,2),
  pressure_bar numeric(7,3),
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 43200),
  rpm integer CHECK (rpm IS NULL OR rpm BETWEEN 0 AND 100000),
  operator_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  operator_analyst_id uuid REFERENCES analysts(id) ON DELETE SET NULL,
  operator_name text NOT NULL,
  observations text,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  updated_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX IF NOT EXISTS laboratory_equipment_runs_status_time_idx
  ON laboratory_equipment_runs(status, expected_end_at, started_at DESC);
CREATE INDEX IF NOT EXISTS laboratory_equipment_runs_equipment_time_idx
  ON laboratory_equipment_runs(equipment_id, started_at DESC);
ALTER TABLE laboratory_equipment_runs ADD COLUMN IF NOT EXISTS work_area text NOT NULL DEFAULT 'laboratory';

CREATE TABLE IF NOT EXISTS laboratory_equipment_run_services (
  run_id uuid NOT NULL REFERENCES laboratory_equipment_runs(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE RESTRICT,
  stage_id uuid REFERENCES service_workflow_stages(id) ON DELETE SET NULL,
  PRIMARY KEY (run_id, service_id)
);
ALTER TABLE laboratory_equipment_run_services ADD COLUMN IF NOT EXISTS stage_id uuid REFERENCES service_workflow_stages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS laboratory_equipment_run_services_service_idx
  ON laboratory_equipment_run_services(service_id, run_id);
CREATE INDEX IF NOT EXISTS laboratory_equipment_run_services_stage_idx
  ON laboratory_equipment_run_services(stage_id, run_id) WHERE stage_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS laboratory_equipment_run_events (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES laboratory_equipment_runs(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('started', 'finished', 'cancelled', 'updated')),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  actor_analyst_id uuid REFERENCES analysts(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS laboratory_equipment_run_events_run_time_idx
  ON laboratory_equipment_run_events(run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS laboratory_equipment_run_nonconformities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_code text NOT NULL UNIQUE,
  run_id uuid NOT NULL UNIQUE REFERENCES laboratory_equipment_runs(id) ON DELETE CASCADE,
  detected_at timestamptz NOT NULL DEFAULT now(),
  description text NOT NULL,
  immediate_action text NOT NULL,
  root_cause text,
  corrective_action text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'closed')),
  responsible_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  responsible_analyst_id uuid REFERENCES analysts(id) ON DELETE SET NULL,
  responsible_name text NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS equipment_run_nonconformities_status_time_idx
  ON laboratory_equipment_run_nonconformities(status, detected_at DESC);

CREATE TABLE IF NOT EXISTS autoclave_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_code text NOT NULL UNIQUE,
  equipment_id uuid NOT NULL REFERENCES laboratory_equipment(id) ON DELETE RESTRICT,
  service_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE RESTRICT,
  load_type text NOT NULL CHECK (load_type IN ('culture_media', 'material', 'mixed')),
  load_description text NOT NULL,
  cycle_number text,
  program_name text,
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  temperature_c numeric(6,2) NOT NULL,
  pressure_bar numeric(7,3) NOT NULL,
  holding_minutes integer NOT NULL CHECK (holding_minutes BETWEEN 0 AND 1440),
  operator_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  operator_name text NOT NULL,
  chemical_indicator text NOT NULL DEFAULT 'not_applicable'
    CHECK (chemical_indicator IN ('conforming', 'nonconforming', 'not_applicable', 'pending')),
  biological_indicator text NOT NULL DEFAULT 'not_applicable'
    CHECK (biological_indicator IN ('conforming', 'nonconforming', 'not_applicable', 'pending')),
  result text NOT NULL DEFAULT 'pending'
    CHECK (result IN ('conforming', 'nonconforming', 'pending')),
  observations text,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  updated_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at >= started_at)
);
CREATE INDEX IF NOT EXISTS autoclave_cycles_service_time_idx
  ON autoclave_cycles(service_id, started_at DESC);
CREATE INDEX IF NOT EXISTS autoclave_cycles_equipment_time_idx
  ON autoclave_cycles(equipment_id, started_at DESC);

CREATE TABLE IF NOT EXISTS autoclave_material_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_code text NOT NULL UNIQUE,
  cycle_id uuid NOT NULL UNIQUE REFERENCES autoclave_cycles(id) ON DELETE RESTRICT,
  released_at timestamptz NOT NULL,
  released_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  released_by_name text NOT NULL,
  material_condition text NOT NULL,
  packaging_integrity text NOT NULL DEFAULT 'conforming'
    CHECK (packaging_integrity IN ('conforming', 'nonconforming', 'not_applicable')),
  chemical_indicator_result text NOT NULL DEFAULT 'not_applicable'
    CHECK (chemical_indicator_result IN ('conforming', 'nonconforming', 'not_applicable', 'pending')),
  biological_indicator_result text NOT NULL DEFAULT 'not_applicable'
    CHECK (biological_indicator_result IN ('conforming', 'nonconforming', 'not_applicable', 'pending')),
  release_result text NOT NULL DEFAULT 'pending'
    CHECK (release_result IN ('released', 'rejected', 'pending')),
  observations text,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  updated_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS autoclave_releases_time_idx
  ON autoclave_material_releases(released_at DESC);

CREATE TABLE IF NOT EXISTS autoclave_nonconformities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_code text NOT NULL UNIQUE,
  cycle_id uuid NOT NULL REFERENCES autoclave_cycles(id) ON DELETE RESTRICT,
  release_id uuid REFERENCES autoclave_material_releases(id) ON DELETE SET NULL,
  detected_at timestamptz NOT NULL,
  description text NOT NULL,
  immediate_action text NOT NULL,
  root_cause text,
  corrective_action text,
  responsible_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  responsible_name text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'closed')),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  updated_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS autoclave_nonconformities_cycle_status_idx
  ON autoclave_nonconformities(cycle_id, status, detected_at DESC);

CREATE TABLE IF NOT EXISTS laboratory_operation_events (
  id bigserial PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('equipment', 'autoclave_cycle', 'material_release', 'nonconformity')),
  entity_id uuid NOT NULL,
  action text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS laboratory_operation_events_entity_time_idx
  ON laboratory_operation_events(entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS laboratory_service_processes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  process_code text NOT NULL UNIQUE,
  service_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE RESTRICT,
  process_type text NOT NULL,
  title text NOT NULL,
  analysis_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  analysis_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('draft', 'in_progress', 'completed')),
  current_step_position integer NOT NULL DEFAULT 0 CHECK (current_step_position >= 0),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  updated_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(analysis_codes) = 'array'),
  CHECK (jsonb_typeof(analysis_names) = 'array')
);
CREATE INDEX IF NOT EXISTS laboratory_service_processes_service_idx
  ON laboratory_service_processes(service_id, process_type, created_at DESC);

CREATE TABLE IF NOT EXISTS laboratory_process_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  process_id uuid NOT NULL REFERENCES laboratory_service_processes(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  title text NOT NULL,
  document_code text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'current', 'completed')),
  step_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  observations text,
  completed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  completed_by_name text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (process_id, step_key),
  UNIQUE (process_id, position),
  CHECK (jsonb_typeof(step_data) = 'object')
);
CREATE INDEX IF NOT EXISTS laboratory_process_steps_process_position_idx
  ON laboratory_process_steps(process_id, position);

CREATE TABLE IF NOT EXISTS laboratory_process_events (
  id bigserial PRIMARY KEY,
  process_id uuid NOT NULL REFERENCES laboratory_service_processes(id) ON DELETE CASCADE,
  step_id uuid REFERENCES laboratory_process_steps(id) ON DELETE SET NULL,
  action text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS laboratory_process_events_process_time_idx
  ON laboratory_process_events(process_id, created_at DESC);

CREATE TABLE IF NOT EXISTS biotechnology_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_plants_per_bag integer NOT NULL DEFAULT 4 CHECK (default_plants_per_bag BETWEEN 1 AND 20),
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS biotechnology_cultivars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crop_name text NOT NULL,
  variety text NOT NULL DEFAULT '',
  multiplication_factor numeric(8,3) NOT NULL DEFAULT 2.500 CHECK (multiplication_factor > 0),
  target_subcultures integer NOT NULL DEFAULT 10 CHECK (target_subcultures BETWEEN 1 AND 20),
  plants_per_bag integer NOT NULL DEFAULT 4 CHECK (plants_per_bag BETWEEN 1 AND 20),
  active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS biotechnology_cultivars_name_variety_idx
  ON biotechnology_cultivars(LOWER(crop_name), LOWER(variety));

CREATE TABLE IF NOT EXISTS biotechnology_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  crop_name text NOT NULL DEFAULT 'Banano',
  variety text,
  source_material text,
  initial_plants integer NOT NULL CHECK (initial_plants > 0),
  multiplication_factor numeric(8,3) NOT NULL DEFAULT 2.500 CHECK (multiplication_factor > 0),
  target_subcultures integer NOT NULL DEFAULT 10 CHECK (target_subcultures BETWEEN 1 AND 20),
  current_stage text NOT NULL DEFAULT 'introduction' CHECK (current_stage IN ('introduction','multiplication','rooting','field_ready','completed')),
  current_subculture integer NOT NULL DEFAULT 0 CHECK (current_subculture BETWEEN 0 AND 20),
  current_viable_plants integer NOT NULL CHECK (current_viable_plants >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed')),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  updated_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS biotechnology_batches_stage_updated_idx
  ON biotechnology_batches(status, current_stage, updated_at DESC);
ALTER TABLE biotechnology_batches ADD COLUMN IF NOT EXISTS assigned_analyst_id uuid REFERENCES analysts(id) ON DELETE SET NULL;
ALTER TABLE biotechnology_batches ADD COLUMN IF NOT EXISTS assigned_analyst_name text;
ALTER TABLE biotechnology_batches ADD COLUMN IF NOT EXISTS plants_per_bag integer NOT NULL DEFAULT 4 CHECK (plants_per_bag BETWEEN 1 AND 20);
ALTER TABLE biotechnology_batches ADD COLUMN IF NOT EXISTS cultivar_id uuid REFERENCES biotechnology_cultivars(id) ON DELETE SET NULL;
ALTER TABLE biotechnology_batches ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE biotechnology_batches ADD COLUMN IF NOT EXISTS archived_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE biotechnology_batches ADD COLUMN IF NOT EXISTS rooting_bags integer NOT NULL DEFAULT 0 CHECK (rooting_bags >= 0);
ALTER TABLE biotechnology_batches ADD COLUMN IF NOT EXISTS started_on date;
ALTER TABLE biotechnology_batches ADD COLUMN IF NOT EXISTS current_stage_started_on date;
UPDATE biotechnology_batches SET current_stage_started_on=started_on WHERE current_stage_started_on IS NULL;
ALTER TABLE biotechnology_batches DROP CONSTRAINT IF EXISTS biotechnology_batches_current_stage_check;
ALTER TABLE biotechnology_batches ADD CONSTRAINT biotechnology_batches_current_stage_check
  CHECK (current_stage IN ('introduction','multiplication','rooting','field_ready','completed'));
ALTER TABLE biotechnology_batches ADD COLUMN IF NOT EXISTS source_external_key text;
ALTER TABLE biotechnology_batches ADD COLUMN IF NOT EXISTS source_note text;
ALTER TABLE biotechnology_batches ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS biotechnology_batches_source_external_key_idx
  ON biotechnology_batches(source_external_key) WHERE source_external_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS biotechnology_batches_code_idx ON biotechnology_batches(LOWER(code));
CREATE INDEX IF NOT EXISTS biotechnology_batches_assigned_idx
  ON biotechnology_batches(assigned_analyst_id, status) WHERE assigned_analyst_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS biotechnology_batches_archived_idx
  ON biotechnology_batches(archived_at DESC) WHERE archived_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS biotechnology_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES biotechnology_batches(id) ON DELETE RESTRICT,
  stage text NOT NULL CHECK (stage IN ('introduction','multiplication','rooting')),
  subculture_number integer CHECK (subculture_number BETWEEN 1 AND 20),
  performed_at timestamptz NOT NULL,
  input_plants integer NOT NULL CHECK (input_plants >= 0),
  bags_processed integer NOT NULL DEFAULT 0 CHECK (bags_processed >= 0),
  plants_per_bag integer NOT NULL CHECK (plants_per_bag BETWEEN 1 AND 20),
  expected_output_plants numeric(14,2) NOT NULL DEFAULT 0 CHECK (expected_output_plants >= 0),
  viable_output_plants integer NOT NULL CHECK (viable_output_plants >= 0),
  contaminated_plants integer NOT NULL DEFAULT 0 CHECK (contaminated_plants >= 0),
  discarded_plants integer NOT NULL DEFAULT 0 CHECK (discarded_plants >= 0),
  medium_code text,
  medium_lot text,
  observations text,
  worker_analyst_id uuid NOT NULL REFERENCES analysts(id),
  worker_name text NOT NULL,
  recorded_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((stage = 'multiplication' AND subculture_number IS NOT NULL) OR (stage <> 'multiplication' AND subculture_number IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS biotechnology_events_batch_stage_cycle_idx
  ON biotechnology_events(batch_id, stage, COALESCE(subculture_number, 0));
CREATE INDEX IF NOT EXISTS biotechnology_events_worker_time_idx
  ON biotechnology_events(worker_analyst_id, performed_at DESC);
ALTER TABLE biotechnology_events ADD COLUMN IF NOT EXISTS collaborator_analyst_id uuid REFERENCES analysts(id) ON DELETE SET NULL;
ALTER TABLE biotechnology_events ADD COLUMN IF NOT EXISTS collaborator_name text;
ALTER TABLE biotechnology_events ADD COLUMN IF NOT EXISTS rooting_bags integer NOT NULL DEFAULT 0 CHECK (rooting_bags >= 0);

CREATE TABLE IF NOT EXISTS biotechnology_weekly_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES biotechnology_batches(id) ON DELETE RESTRICT,
  analyst_id uuid NOT NULL REFERENCES analysts(id) ON DELETE RESTRICT,
  analyst_name text NOT NULL,
  week_start date NOT NULL,
  assigned_bags integer NOT NULL CHECK (assigned_bags BETWEEN 1 AND 1000000),
  plants_per_bag integer NOT NULL CHECK (plants_per_bag BETWEEN 1 AND 20),
  estimated_plants integer NOT NULL CHECK (estimated_plants >= 0),
  actual_bags integer CHECK (actual_bags IS NULL OR actual_bags BETWEEN 0 AND 1000000),
  actual_plants integer CHECK (actual_plants IS NULL OR actual_plants >= 0),
  completed_at timestamptz,
  registered_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, analyst_id, week_start)
);
CREATE INDEX IF NOT EXISTS biotechnology_weekly_assignments_worker_week_idx
  ON biotechnology_weekly_assignments(analyst_id, week_start DESC);
CREATE INDEX IF NOT EXISTS biotechnology_weekly_assignments_batch_week_idx
  ON biotechnology_weekly_assignments(batch_id, week_start DESC);

CREATE TABLE IF NOT EXISTS biotechnology_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES biotechnology_batches(id) ON DELETE RESTRICT,
  analyst_id uuid NOT NULL REFERENCES analysts(id) ON DELETE RESTRICT,
  analyst_name text NOT NULL,
  period_type text NOT NULL DEFAULT 'day' CHECK (period_type IN ('day','week')),
  scheduled_for date NOT NULL,
  stage text NOT NULL CHECK (stage IN ('introduction','multiplication','rooting')),
  subculture_number integer CHECK (subculture_number BETWEEN 1 AND 20),
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','in_progress','completed','cancelled')),
  started_at timestamptz,
  ended_at timestamptz,
  input_bags integer CHECK (input_bags IS NULL OR input_bags BETWEEN 0 AND 1000000),
  output_bags integer CHECK (output_bags IS NULL OR output_bags BETWEEN 0 AND 1000000),
  introduced_plants integer CHECK (introduced_plants IS NULL OR introduced_plants BETWEEN 0 AND 10000000),
  plants_per_bag integer NOT NULL CHECK (plants_per_bag BETWEEN 1 AND 20),
  input_plants integer CHECK (input_plants IS NULL OR input_plants >= 0),
  output_plants integer CHECK (output_plants IS NULL OR output_plants >= 0),
  expected_output_plants numeric(14,2) CHECK (expected_output_plants IS NULL OR expected_output_plants >= 0),
  equipment_run_id uuid REFERENCES laboratory_equipment_runs(id) ON DELETE SET NULL,
  equipment_code text,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  completed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((stage='multiplication' AND subculture_number IS NOT NULL) OR (stage<>'multiplication' AND subculture_number IS NULL)),
  CHECK (ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX IF NOT EXISTS biotechnology_assignments_worker_status_idx
  ON biotechnology_assignments(analyst_id,status,scheduled_for DESC);
CREATE INDEX IF NOT EXISTS biotechnology_assignments_batch_status_idx
  ON biotechnology_assignments(batch_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS sample_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE RESTRICT,
  sample_code text NOT NULL UNIQUE,
  intake_type text NOT NULL CHECK (intake_type IN ('client_delivery','aslabs_collection')),
  received_at timestamptz NOT NULL DEFAULT now(),
  analysis_due_at timestamptz,
  sample_description text NOT NULL,
  collected_by_name text NOT NULL,
  client_representative_name text NOT NULL,
  client_signature_data_url text NOT NULL,
  microbiologist_name text NOT NULL,
  received_by_analyst_id uuid REFERENCES analysts(id) ON DELETE SET NULL,
  microbiologist_signature_data_url text,
  material_conforming boolean NOT NULL,
  sample_conforming boolean NOT NULL,
  nonconformity_notes text,
  satisfaction_rating integer CHECK (satisfaction_rating BETWEEN 1 AND 5),
  satisfaction_notes text,
  client_copy_printed_at timestamptz,
  client_copy_printed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  storage_location text CHECK (storage_location IN ('refrigerator','room_temperature_table','other')),
  storage_detail text,
  processing_status text NOT NULL DEFAULT 'stored' CHECK (processing_status IN ('stored','processing','completed')),
  processing_started_at timestamptz,
  processing_ended_at timestamptz,
  processing_by_analyst_id uuid REFERENCES analysts(id) ON DELETE SET NULL,
  processing_by_name text,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  updated_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sample_conforming OR nonconformity_notes IS NOT NULL),
  CHECK (material_conforming OR nonconformity_notes IS NOT NULL),
  CHECK (processing_ended_at IS NULL OR processing_started_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS sample_intakes_service_time_idx ON sample_intakes(service_id,received_at DESC);
CREATE INDEX IF NOT EXISTS sample_intakes_processing_idx ON sample_intakes(processing_status,processing_started_at);

CREATE TABLE IF NOT EXISTS zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  crop text NOT NULL DEFAULT 'Por definir',
  area_ha numeric(12, 3),
  color varchar(7) NOT NULL DEFAULT '#2f6b4f',
  coordinates jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(coordinates) = 'array')
);
CREATE INDEX IF NOT EXISTS zones_client_created_idx ON zones(client_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS zone_backups (
  id bigserial PRIMARY KEY,
  zone_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  event text NOT NULL DEFAULT 'created',
  recorded_by_user_id uuid REFERENCES users(id),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zone_backups_zone_time_idx ON zone_backups(zone_id, recorded_at DESC);

ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS zone_id uuid REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS service_requests_zone_idx ON service_requests(zone_id) WHERE zone_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS workers (
  id text PRIMARY KEY,
  full_name text NOT NULL,
  initials varchar(4) NOT NULL,
  task text NOT NULL,
  zone text NOT NULL,
  status text NOT NULL,
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  accuracy_m integer,
  assigned_client_email text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS location_updates (
  id bigserial PRIMARY KEY,
  worker_id text NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  accuracy_m integer,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS location_updates_worker_time_idx ON location_updates(worker_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS crew_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  initials varchar(4) NOT NULL,
  role_title text,
  phone text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crew_members_status_name_idx ON crew_members(status, full_name);

CREATE TABLE IF NOT EXISTS field_crews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  operational_state text NOT NULL DEFAULT 'available'
    CHECK (operational_state IN ('available', 'at_laboratory', 'en_route', 'sampling', 'applying', 'returning', 'paused')),
  status_text text,
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  home_laboratory_site_id uuid REFERENCES field_sites(id) ON DELETE SET NULL,
  current_site_id uuid REFERENCES field_sites(id) ON DELETE SET NULL,
  current_lat double precision,
  current_lng double precision,
  accuracy_m integer,
  active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS field_crews_active_seen_idx ON field_crews(active, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS crew_memberships (
  crew_id uuid NOT NULL REFERENCES field_crews(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES crew_members(id) ON DELETE CASCADE,
  role text,
  active boolean NOT NULL DEFAULT true,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (crew_id, member_id)
);

CREATE TABLE IF NOT EXISTS crew_service_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_id uuid NOT NULL REFERENCES field_crews(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  assignment_type text NOT NULL DEFAULT 'sampling'
    CHECK (assignment_type IN ('sampling', 'application', 'logistics', 'laboratory')),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'en_route', 'on_site', 'completed', 'paused')),
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  scheduled_at timestamptz,
  notes text,
  assigned_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (crew_id, service_id, assignment_type)
);
CREATE INDEX IF NOT EXISTS crew_service_assignments_service_idx ON crew_service_assignments(service_id, status);
CREATE INDEX IF NOT EXISTS crew_service_assignments_crew_idx ON crew_service_assignments(crew_id, status);

CREATE TABLE IF NOT EXISTS crew_location_updates (
  id bigserial PRIMARY KEY,
  crew_id uuid NOT NULL REFERENCES field_crews(id) ON DELETE CASCADE,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  accuracy_m integer,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crew_location_updates_crew_time_idx ON crew_location_updates(crew_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS dna_orders (
  id text PRIMARY KEY,
  client_email text NOT NULL,
  client_name text NOT NULL,
  sample_count integer NOT NULL,
  matrix text NOT NULL,
  protocol text NOT NULL,
  estimated_delivery date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dna_steps (
  order_id text NOT NULL REFERENCES dna_orders(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  position integer NOT NULL,
  title text NOT NULL,
  detail text NOT NULL,
  state text NOT NULL CHECK (state IN ('done', 'current', 'pending')),
  event_time text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, step_key)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  supplier_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text,
  required_at date,
  delivery_address text,
  delivery_instructions text,
  status text NOT NULL DEFAULT 'pending_quote'
    CHECK (status IN ('pending_quote', 'submitted', 'reviewed', 'in_process', 'accepted', 'rejected')),
  admin_notes text,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_orders_supplier_status_idx
  ON purchase_orders(supplier_user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product text NOT NULL,
  description text,
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'unidad',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_order_items_order_idx
  ON purchase_order_items(purchase_order_id, sort_order, created_at);

CREATE TABLE IF NOT EXISTS supplier_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL UNIQUE REFERENCES purchase_orders(id) ON DELETE CASCADE,
  supplier_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  delivery_mode text NOT NULL,
  delivery_term text,
  validity_days integer CHECK (validity_days IS NULL OR validity_days BETWEEN 1 AND 365),
  currency text NOT NULL DEFAULT 'PEN' CHECK (currency IN ('PEN', 'USD')),
  subtotal numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  igv_rate numeric(5,2) NOT NULL DEFAULT 18 CHECK (igv_rate BETWEEN 0 AND 100),
  igv_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (igv_amount >= 0),
  total numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  notes text,
  file_name text,
  file_mime_type text,
  file_size integer,
  file_data_url text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES supplier_quotes(id) ON DELETE CASCADE,
  product text NOT NULL,
  description text,
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'unidad',
  unit_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  line_total numeric(14,2) NOT NULL DEFAULT 0 CHECK (line_total >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_quote_items_quote_idx
  ON supplier_quote_items(quote_id, sort_order, created_at);

CREATE TABLE IF NOT EXISTS supplier_payment_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  file_size integer NOT NULL CHECK (file_size > 0),
  data_url text NOT NULL,
  payment_reference text,
  payment_date date,
  notes text,
  uploaded_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_payment_receipts_order_idx
  ON supplier_payment_receipts(purchase_order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  client_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id uuid REFERENCES service_requests(id) ON DELETE SET NULL,
  subject text NOT NULL,
  category text NOT NULL DEFAULT 'general'
    CHECK (category IN ('general','order','sample','results','documents','technical')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_tickets_client_time_idx
  ON support_tickets(client_user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_status_time_idx
  ON support_tickets(status, last_message_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_messages_ticket_time_idx
  ON support_messages(ticket_id, created_at);
