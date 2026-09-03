import fs from 'node:fs/promises'
import { neon } from '@neondatabase/serverless'

async function loadLocalEnv() {
  const raw = await fs.readFile(new URL('../.env.local', import.meta.url), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!match || process.env[match[1]]) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[match[1]] = value.replace(/\\n/g, '\n')
  }
}

await loadLocalEnv()
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no está disponible')

const sql = neon(process.env.DATABASE_URL)
const schema = await fs.readFile(new URL('../db/schema.sql', import.meta.url), 'utf8')
for (const statement of schema.split(';').map((value) => value.trim()).filter(Boolean)) {
  await sql.query(statement)
}

await sql.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS requires_worker_pin boolean NOT NULL DEFAULT false`)
await sql.query(`ALTER TABLE users ALTER COLUMN email DROP NOT NULL`)
await sql.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS pin_failed_attempts integer NOT NULL DEFAULT 0`)
await sql.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS pin_locked_until timestamptz`)
await sql.query(`ALTER TABLE analysts ADD COLUMN IF NOT EXISTS pin_hash text`)
await sql.query(`ALTER TABLE analysts ADD COLUMN IF NOT EXISTS pin_configured_at timestamptz`)
await sql.query(`ALTER TABLE analysts ADD COLUMN IF NOT EXISTS pin_last_used_at timestamptz`)
await sql.query(`ALTER TABLE analysts ADD COLUMN IF NOT EXISTS biotechnology_access boolean NOT NULL DEFAULT false`)
await sql.query(`ALTER TABLE sample_intakes ADD COLUMN IF NOT EXISTS analysis_due_at timestamptz`)
await sql.query(`ALTER TABLE sample_intakes ADD COLUMN IF NOT EXISTS client_copy_printed_at timestamptz`)
await sql.query(`ALTER TABLE sample_intakes ADD COLUMN IF NOT EXISTS client_copy_printed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL`)
await sql.query(`ALTER TABLE sample_intakes ALTER COLUMN microbiologist_signature_data_url DROP NOT NULL`)
await sql.query(`ALTER TABLE sample_intakes ADD COLUMN IF NOT EXISTS received_by_analyst_id uuid REFERENCES analysts(id) ON DELETE SET NULL`)
await sql.query(`ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS sample_intake_scheduled_at timestamptz`)
await sql.query(`ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS sample_intake_mode text NOT NULL DEFAULT 'client_delivery'`)
await sql.query(`ALTER TABLE service_requests DROP CONSTRAINT IF EXISTS service_requests_sample_intake_mode_check`)
await sql.query(`ALTER TABLE service_requests ADD CONSTRAINT service_requests_sample_intake_mode_check CHECK (sample_intake_mode IN ('client_delivery','aslabs_collection','aslabs_sampling','none'))`)
await sql.query(`CREATE INDEX IF NOT EXISTS service_requests_sample_schedule_idx ON service_requests(sample_intake_scheduled_at) WHERE sample_intake_scheduled_at IS NOT NULL`)
await sql.query(`CREATE TABLE IF NOT EXISTS public_document_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),token_hash char(64) NOT NULL UNIQUE,
  document_type text NOT NULL CHECK (document_type IN ('sample_intake','final_report')),
  service_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  sample_intake_id uuid,final_report_id uuid REFERENCES service_final_reports(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),last_accessed_at timestamptz
)`)
await sql.query(`CREATE TABLE IF NOT EXISTS email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_key text NOT NULL UNIQUE,event_type text NOT NULL,
  service_id uuid REFERENCES service_requests(id) ON DELETE SET NULL,client_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  recipient_email text,subject text NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  provider_message_id text,error_message text,attempts integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now()
)`)
await sql.query(`ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS provider_last_event text`)
await sql.query(`ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS preview_html text`)
await sql.query(`CREATE INDEX IF NOT EXISTS email_deliveries_service_idx ON email_deliveries(service_id,created_at DESC)`)
await sql.query(`CREATE INDEX IF NOT EXISTS email_deliveries_status_idx ON email_deliveries(status,created_at)`)
await sql.query(`CREATE INDEX IF NOT EXISTS sample_intakes_due_idx ON sample_intakes(analysis_due_at,processing_status) WHERE analysis_due_at IS NOT NULL AND processing_status <> 'completed'`)
await sql.query(`ALTER TABLE service_catalog ADD COLUMN IF NOT EXISTS group_name text`)
await sql.query(`ALTER TABLE service_catalog ADD COLUMN IF NOT EXISTS matrix_scope text`)

await sql.query(
  `INSERT INTO modules (id,name,description,sort_order)
   VALUES ('procurement','Proveedores y compras','Órdenes de compra, cotizaciones y pagos a proveedores',75)
   ON CONFLICT (id) DO UPDATE SET
     name=EXCLUDED.name,description=EXCLUDED.description,sort_order=EXCLUDED.sort_order`,
)
await sql.query(
  `INSERT INTO roles (name,slug,description,is_system)
   VALUES ('Proveedor','supplier','Acceso exclusivo a órdenes de compra y envío de cotizaciones',true)
   ON CONFLICT (slug) DO UPDATE SET
     name=EXCLUDED.name,description=EXCLUDED.description,is_system=true,updated_at=NOW()`,
)
await sql.query(
  `INSERT INTO role_permissions (role_id,module_id,can_view,can_create,can_edit,can_delete)
   SELECT id,'procurement',true,true,true,true FROM roles WHERE slug='admin'
   ON CONFLICT (role_id,module_id) DO UPDATE SET
     can_view=true,can_create=true,can_edit=true,can_delete=true`,
)
await sql.query(
  `INSERT INTO role_permissions (role_id,module_id,can_view,can_create,can_edit,can_delete)
   SELECT id,'procurement',true,true,true,false FROM roles WHERE slug='supplier'
   ON CONFLICT (role_id,module_id) DO UPDATE SET
     can_view=true,can_create=true,can_edit=true,can_delete=false`,
)
await sql.query(
  `INSERT INTO role_permissions (role_id,module_id,can_view,can_create,can_edit,can_delete)
   SELECT id,'notifications',true,false,true,false FROM roles WHERE slug='supplier'
   ON CONFLICT (role_id,module_id) DO UPDATE SET
     can_view=true,can_create=false,can_edit=true,can_delete=false`,
)

await sql.query(
  `UPDATE analysts
   SET biotechnology_access = LOWER(full_name) IN (
         'jurith aguilar pichen',
         'madeleine isuiza flores',
         'renzo t.',
         'rosa cabanillas',
         'hasa'
       ) OR LOWER(full_name) LIKE '%hassan%',
       specialty = CASE
         WHEN LOWER(full_name) IN ('jurith aguilar pichen','madeleine isuiza flores','renzo t.','rosa cabanillas','hasa')
              OR LOWER(full_name) LIKE '%hassan%'
           THEN 'Biotecnología vegetal'
         ELSE specialty
       END,
       updated_at = NOW()`,
)

await sql.query(
  `INSERT INTO modules (id, name, description, sort_order)
   VALUES ('analysts', 'Analistas', 'Directorio de profesionales del laboratorio', 80)
   ON CONFLICT (id) DO UPDATE
   SET name = EXCLUDED.name, description = EXCLUDED.description, sort_order = EXCLUDED.sort_order`,
)
await sql.query(
  `INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
   SELECT id, 'analysts', true, true, true, true FROM roles WHERE slug = 'admin'
   ON CONFLICT (role_id, module_id) DO UPDATE
   SET can_view = true, can_create = true, can_edit = true, can_delete = true`,
)

await sql.query(
  `INSERT INTO modules (id, name, description, sort_order)
   VALUES ('lab_operations', 'Operaciones de laboratorio', 'Equipos, autoclavado, liberaciones y no conformidades', 45)
   ON CONFLICT (id) DO UPDATE
   SET name = EXCLUDED.name, description = EXCLUDED.description, sort_order = EXCLUDED.sort_order`,
)
await sql.query(
  `INSERT INTO roles (name, slug, description, is_system)
   VALUES ('Trabajador de laboratorio', 'laboratory-worker', 'Registra y actualiza operaciones internas del laboratorio', true)
   ON CONFLICT (slug) DO UPDATE
   SET name = EXCLUDED.name, description = EXCLUDED.description, is_system = true, updated_at = NOW()`,
)
await sql.query(
  `INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
   SELECT id, 'lab_operations', true, true, true, false FROM roles WHERE slug = 'laboratory-worker'
   ON CONFLICT (role_id, module_id) DO UPDATE
   SET can_view = true, can_create = true, can_edit = true, can_delete = false`,
)
await sql.query(
  `INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
   SELECT id, 'dashboard', true, false, false, false FROM roles WHERE slug = 'laboratory-worker'
   ON CONFLICT (role_id, module_id) DO UPDATE
   SET can_view = true, can_create = false, can_edit = false, can_delete = false`,
)
await sql.query(
  `INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
   SELECT id, 'notifications', true, false, true, false FROM roles WHERE slug = 'laboratory-worker'
   ON CONFLICT (role_id, module_id) DO UPDATE
   SET can_view = true, can_create = false, can_edit = true, can_delete = false`,
)
await sql.query(
  `INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
   SELECT id, 'lab_operations', true, true, true, true FROM roles WHERE slug = 'admin'
   ON CONFLICT (role_id, module_id) DO UPDATE
   SET can_view = true, can_create = true, can_edit = true, can_delete = true`,
)
await sql.query(
  `INSERT INTO laboratory_equipment (code, name, equipment_type, location, status, notes)
   VALUES ('AUT-001', 'Autoclave 01', 'autoclave', 'Laboratorio de microbiología', 'active', 'Equipo inicial para esterilización de medios de cultivo y material.')
   ON CONFLICT (code) DO NOTHING`,
)

const standardEquipment = [
  ['ESP-001', 'Espectrofotómetro 01', 'spectrophotometer', 'Laboratorio de análisis', 'Lecturas instrumentales y determinaciones colorimétricas.'],
  ['INC-001', 'Incubadora 01', 'incubator', 'Laboratorio de microbiología', 'Incubación controlada con alerta por tiempo excedido.'],
  ['SHK-001', 'Shaker incubador 01', 'shaker_incubator', 'Laboratorio de microbiología', 'Incubación con agitación y control de RPM.'],
  ['CEN-001', 'Centrífuga 01', 'centrifuge', 'Laboratorio de análisis', 'Separación por centrifugación con registro de RPM.'],
  ['HOR-001', 'Horno 01', 'oven', 'Laboratorio de análisis', 'Tratamiento térmico con control de temperatura y tiempo.'],
  ['CFL-001', 'Cabina de flujo laminar 01', 'flow_cabinet', 'Laboratorio de microbiología', 'Registro rápido de inicio y fin para análisis.'],
]
for (const item of standardEquipment) {
  await sql.query(
    `INSERT INTO laboratory_equipment (code,name,equipment_type,location,status,notes)
     VALUES ($1,$2,$3,$4,'active',$5)
     ON CONFLICT (code) DO UPDATE SET
       name=EXCLUDED.name,equipment_type=EXCLUDED.equipment_type,
       location=COALESCE(laboratory_equipment.location,EXCLUDED.location),
       notes=COALESCE(laboratory_equipment.notes,EXCLUDED.notes),updated_at=NOW()`,
    item,
  )
}

await sql.query(
  `INSERT INTO modules (id, name, description, sort_order)
   VALUES ('biotechnology', 'Biotecnología', 'Propagación in vitro, subcultivos, enraizamiento y productividad', 42)
   ON CONFLICT (id) DO UPDATE
   SET name=EXCLUDED.name,description=EXCLUDED.description,sort_order=EXCLUDED.sort_order`,
)
await sql.query(
  `INSERT INTO role_permissions (role_id,module_id,can_view,can_create,can_edit,can_delete)
   SELECT id,'biotechnology',true,true,true,true FROM roles WHERE slug='admin'
   ON CONFLICT (role_id,module_id) DO UPDATE
   SET can_view=true,can_create=true,can_edit=true,can_delete=true`,
)
await sql.query(
  `INSERT INTO role_permissions (role_id,module_id,can_view,can_create,can_edit,can_delete)
   SELECT id,'biotechnology',true,true,true,false FROM roles WHERE slug='laboratory-worker'
   ON CONFLICT (role_id,module_id) DO UPDATE
   SET can_view=true,can_create=true,can_edit=true,can_delete=false`,
)
await sql.query(
  `INSERT INTO biotechnology_settings (id,default_plants_per_bag)
   VALUES (1,4) ON CONFLICT (id) DO NOTHING`,
)
await sql.query(`ALTER TABLE biotechnology_cultivars ALTER COLUMN target_subcultures SET DEFAULT 10`)
await sql.query(`ALTER TABLE biotechnology_batches ALTER COLUMN target_subcultures SET DEFAULT 10`)
await sql.query(`ALTER TABLE biotechnology_batches ADD COLUMN IF NOT EXISTS archived_at timestamptz`)
await sql.query(`ALTER TABLE biotechnology_batches ADD COLUMN IF NOT EXISTS archived_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL`)
await sql.query(`ALTER TABLE biotechnology_batches ADD COLUMN IF NOT EXISTS rooting_bags integer NOT NULL DEFAULT 0 CHECK (rooting_bags >= 0)`)
await sql.query(`ALTER TABLE biotechnology_batches ADD COLUMN IF NOT EXISTS started_on date`)
await sql.query(`ALTER TABLE biotechnology_batches ADD COLUMN IF NOT EXISTS source_external_key text`)
await sql.query(`ALTER TABLE biotechnology_batches ADD COLUMN IF NOT EXISTS source_note text`)
await sql.query(`ALTER TABLE biotechnology_batches ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false`)
await sql.query(`ALTER TABLE biotechnology_batches DROP CONSTRAINT IF EXISTS biotechnology_batches_code_key`)
await sql.query(`DROP INDEX IF EXISTS biotechnology_batches_code_key`)
await sql.query(`CREATE UNIQUE INDEX IF NOT EXISTS biotechnology_batches_source_external_key_idx ON biotechnology_batches(source_external_key) WHERE source_external_key IS NOT NULL`)
await sql.query(`CREATE INDEX IF NOT EXISTS biotechnology_batches_code_idx ON biotechnology_batches(LOWER(code))`)
await sql.query(`ALTER TABLE biotechnology_cultivars DROP CONSTRAINT IF EXISTS biotechnology_cultivars_target_subcultures_check`)
await sql.query(`ALTER TABLE biotechnology_cultivars ADD CONSTRAINT biotechnology_cultivars_target_subcultures_check CHECK (target_subcultures BETWEEN 1 AND 20)`)
await sql.query(`ALTER TABLE biotechnology_batches DROP CONSTRAINT IF EXISTS biotechnology_batches_target_subcultures_check`)
await sql.query(`ALTER TABLE biotechnology_batches ADD CONSTRAINT biotechnology_batches_target_subcultures_check CHECK (target_subcultures BETWEEN 1 AND 20)`)
await sql.query(`ALTER TABLE biotechnology_batches DROP CONSTRAINT IF EXISTS biotechnology_batches_current_subculture_check`)
await sql.query(`ALTER TABLE biotechnology_batches ADD CONSTRAINT biotechnology_batches_current_subculture_check CHECK (current_subculture BETWEEN 0 AND 20)`)
await sql.query(`ALTER TABLE biotechnology_events DROP CONSTRAINT IF EXISTS biotechnology_events_subculture_number_check`)
await sql.query(`ALTER TABLE biotechnology_events ADD CONSTRAINT biotechnology_events_subculture_number_check CHECK (subculture_number BETWEEN 1 AND 20)`)
await sql.query(`ALTER TABLE biotechnology_assignments DROP CONSTRAINT IF EXISTS biotechnology_assignments_subculture_number_check`)
await sql.query(`ALTER TABLE biotechnology_assignments ADD CONSTRAINT biotechnology_assignments_subculture_number_check CHECK (subculture_number BETWEEN 1 AND 20)`)
await sql.query(`ALTER TABLE biotechnology_events ADD COLUMN IF NOT EXISTS collaborator_analyst_id uuid REFERENCES analysts(id) ON DELETE SET NULL`)
await sql.query(`ALTER TABLE biotechnology_events ADD COLUMN IF NOT EXISTS collaborator_name text`)
await sql.query(`ALTER TABLE biotechnology_events ADD COLUMN IF NOT EXISTS rooting_bags integer NOT NULL DEFAULT 0 CHECK (rooting_bags >= 0)`)
await sql.query(`ALTER TABLE crew_service_assignments ADD COLUMN IF NOT EXISTS progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100)`)
await sql.query(
  `INSERT INTO biotechnology_cultivars
     (crop_name,variety,multiplication_factor,target_subcultures,plants_per_bag)
   SELECT DISTINCT ON (LOWER(crop_name),LOWER(COALESCE(variety,'')))
          crop_name,COALESCE(variety,''),multiplication_factor,target_subcultures,plants_per_bag
   FROM biotechnology_batches
   ORDER BY LOWER(crop_name),LOWER(COALESCE(variety,'')),updated_at DESC
   ON CONFLICT DO NOTHING`,
)
await sql.query(
  `INSERT INTO biotechnology_cultivars
     (crop_name,variety,multiplication_factor,target_subcultures,plants_per_bag)
   VALUES
     ('Banano','Cavendish Williams',2.5,10,4),
     ('Banano','Valery',2.5,10,4),
     ('Banano','Baby Banano',2.5,10,4),
     ('Plátano','Dominico Harton',2.5,10,4),
     ('Plátano','Azul',2.5,10,4),
     ('Pitahaya','Rosada',2.5,10,4),
     ('Piña','Golden',2.5,10,4)
   ON CONFLICT DO NOTHING`,
)
await sql.query(
  `UPDATE biotechnology_cultivars
   SET target_subcultures=10,updated_at=NOW()
   WHERE target_subcultures=5
     AND (crop_name,variety) IN (
       ('Banano','Cavendish Williams'),('Banano','Valery'),('Banano','Baby Banano'),
       ('Plátano','Dominico Harton'),('Plátano','Azul'),('Pitahaya','Rosada'),('Piña','Golden')
     )`,
)
await sql.query(
  `UPDATE biotechnology_batches b SET cultivar_id=c.id
   FROM biotechnology_cultivars c
   WHERE b.cultivar_id IS NULL
     AND LOWER(c.crop_name)=LOWER(b.crop_name)
     AND LOWER(c.variety)=LOWER(COALESCE(b.variety,''))`,
)

const catalog = [
  ['soil-fertility', 'soil', 'Análisis de suelos', 'Fertilidad integral', 'Evaluación físico-química para planes de nutrición y manejo agronómico.', '7–10 días', '🌱', 10],
  ['soil-macronutrients', 'soil', 'Análisis de suelos', 'Macro y micronutrientes', 'Determinación de nutrientes disponibles y elementos esenciales.', '7–10 días', '🧪', 20],
  ['soil-salinity', 'soil', 'Análisis de suelos', 'Salinidad y sodicidad', 'Conductividad, sales solubles y riesgo de sodificación.', '6–9 días', '💧', 30],
  ['soil-heavy-metals', 'soil', 'Análisis de suelos', 'Metales pesados', 'Perfil de elementos traza y contaminantes en suelo.', '8–12 días', '🔬', 40],
  ['soil-texture', 'soil', 'Análisis de suelos', 'Textura y propiedades físicas', 'Textura, densidad y parámetros físicos relevantes.', '6–9 días', '🪨', 50],
  ['soil-carbon', 'soil', 'Análisis de suelos', 'Carbono y materia orgánica', 'Cuantificación de carbono orgánico y materia orgánica.', '6–9 días', '🌿', 60],
  ['water-irrigation', 'water', 'Análisis de aguas', 'Calidad para riego', 'Aptitud del agua para uso agrícola y riesgo salino.', '5–8 días', '💦', 10],
  ['water-potability', 'water', 'Análisis de aguas', 'Potabilidad', 'Parámetros físico-químicos y microbiológicos de consumo.', '5–8 días', '🚰', 20],
  ['water-microbiology', 'water', 'Análisis de aguas', 'Microbiología del agua', 'Indicadores microbiológicos y control sanitario.', '4–7 días', '🦠', 30],
  ['micro-coliformes-totales', 'microbiology', 'Análisis microbiológicos', 'Recuento de coliformes totales', 'Determinación cuantitativa de coliformes totales en la matriz analizada.', '4–7 días', '🧫', 10],
  ['micro-coliformes-termotolerantes', 'microbiology', 'Análisis microbiológicos', 'Recuento de coliformes termotolerantes', 'Determinación cuantitativa de coliformes termotolerantes.', '4–7 días', '🧫', 20],
  ['micro-bacterias-heterotrofas', 'microbiology', 'Análisis microbiológicos', 'Recuento de bacterias heterótrofas', 'Recuento de microorganismos heterótrofos cultivables.', '4–7 días', '🦠', 30],
  ['micro-aerobios-mesofilos', 'microbiology', 'Análisis microbiológicos', 'Recuento de aerobios mesófilos', 'Recuento de microorganismos aerobios mesófilos viables.', '4–7 días', '🦠', 40],
  ['micro-escherichia-coli', 'microbiology', 'Análisis microbiológicos', 'Detección y recuento de Escherichia coli', 'Detección o cuantificación de Escherichia coli según la matriz.', '4–7 días', '🔬', 50],
  ['micro-enterobacterias', 'microbiology', 'Análisis microbiológicos', 'Recuento de enterobacterias', 'Determinación cuantitativa de enterobacterias cultivables.', '4–7 días', '🧫', 60],
  ['micro-pseudomonas', 'microbiology', 'Análisis microbiológicos', 'Recuento de Pseudomonas spp.', 'Determinación cuantitativa de Pseudomonas spp. cultivables.', '5–8 días', '🦠', 70],
  ['micro-staphylococcus', 'microbiology', 'Análisis microbiológicos', 'Recuento de Staphylococcus aureus', 'Detección y recuento de Staphylococcus aureus en la matriz indicada.', '5–8 días', '🔬', 80],
  ['micro-mohos-levaduras', 'microbiology', 'Análisis microbiológicos', 'Recuento de mohos y levaduras', 'Determinación cuantitativa de mohos y levaduras viables.', '5–8 días', '🍄', 90],
  ['micro-personalizado', 'microbiology', 'Análisis microbiológicos', 'Recuento microbiológico personalizado', 'Método cuantitativo definido según la matriz y la cotización.', 'Según alcance', '🧪', 100],
  ['water-heavy-metals', 'water', 'Análisis de aguas', 'Metales pesados', 'Detección de contaminantes metálicos en matrices acuosas.', '7–10 días', '🔬', 40],
  ['water-effluent', 'water', 'Análisis de aguas', 'Efluentes y aguas residuales', 'Caracterización de descargas y control de tratamiento.', '7–10 días', '🏭', 50],
  ['soil-microbial-profile', 'soil-microbiology', 'Microbiología del suelo', 'Perfil microbiológico', 'Caracterización de la actividad y población microbiana del suelo.', '8–12 días', '🦠', 10],
  ['soil-beneficial-microorganisms', 'soil-microbiology', 'Microbiología del suelo', 'Microorganismos benéficos', 'Aislamiento y evaluación de microorganismos de interés agrícola.', '12–18 días', '🧫', 20],
  ['bacterial-formulation-application', 'soil-microbiology', 'Microbiología del suelo', 'Formulación bacteriana y aplicación', 'Producción, control, formulación y aplicación supervisada en campo.', 'Según programa', '🧬', 30],
  ['phytopathology-diagnosis', 'phytopathology', 'Fitopatología', 'Diagnóstico fitopatológico', 'Identificación de agentes asociados a síntomas en plantas.', '7–12 días', '🍃', 10],
  ['phytopathology-culture', 'phytopathology', 'Fitopatología', 'Aislamiento y cultivo', 'Aislamiento de hongos o bacterias para identificación.', '10–15 días', '🧫', 20],
  ['phytopathogenic-fungi', 'phytopathology', 'Fitopatología', 'Análisis de hongos fitopatógenos', 'Detección, aislamiento e identificación de hongos asociados a enfermedades de cultivos.', '8–14 días', '🍄', 30],
  ['phytopathogenic-bacteria', 'phytopathology', 'Fitopatología', 'Análisis de bacterias fitopatógenas', 'Detección, aislamiento e identificación de bacterias causantes de enfermedades vegetales.', '8–14 días', '🦠', 40],
  ['foliar-nutrition', 'foliar', 'Análisis foliar', 'Perfil nutricional foliar', 'Diagnóstico del estado nutricional del cultivo.', '6–9 días', '🌿', 10],
  ['food-microbiology', 'food', 'Alimentos', 'Microbiología de alimentos', 'Control microbiológico de productos y materias primas.', '5–8 días', '🥬', 10],
  ['food-physchem', 'food', 'Alimentos', 'Análisis físico-químico', 'Caracterización físico-química de alimentos.', '6–10 días', '⚗️', 20],
  ['general-ph', 'general-samples', 'Análisis de muestras generales', 'Determinación de pH', 'Medición de pH en muestras generales según la matriz recibida.', '3–5 días', '🧪', 10],
  ['general-conductivity', 'general-samples', 'Análisis de muestras generales', 'Conductividad', 'Determinación de conductividad eléctrica en muestras generales.', '3–5 días', '⚡', 20],
  ['general-acidity', 'general-samples', 'Análisis de muestras generales', 'Acidez', 'Determinación de acidez de acuerdo con la naturaleza de la muestra.', '3–5 días', '💧', 30],
  ['general-ammonia', 'general-samples', 'Análisis de muestras generales', 'Amoniaco', 'Cuantificación de amoniaco en la matriz indicada en la cotización.', '4–7 días', '⚗️', 40],
  ['general-custom', 'general-samples', 'Análisis de muestras generales', 'Análisis personalizado', 'Parámetros y alcance definidos en la cotización según la muestra y necesidad del cliente.', 'Según alcance', '🔬', 50],
  ['dna', 'biotechnology', 'Biotecnología', 'Extracción de DNA', 'Extracción, control de calidad, trazabilidad y envío.', '5–8 días', '🧬', 10],
]

for (const item of catalog) {
  await sql.query(
    `INSERT INTO service_catalog
     (id, category_id, category_name, name, description, estimated_duration, icon, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (id) DO UPDATE SET
       category_id = EXCLUDED.category_id,
       category_name = EXCLUDED.category_name,
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       estimated_duration = EXCLUDED.estimated_duration,
       icon = EXCLUDED.icon,
       sort_order = EXCLUDED.sort_order,
       active = true,
       updated_at = NOW()`,
    item,
  )
}

const bacterialFormulationCatalog = [
  ['bacterial-formulation-bacillus-subtilis', 'Formulación bacteriana de Bacillus subtilis', 'Producción de biomasa, control de pureza y viabilidad, estandarización de concentración, formulación, acondicionamiento y liberación del producto. No incluye aplicación en campo.', 'Según formulación', 'Bacillus subtilis', 910],
  ['bacterial-formulation-bacillus-cereus', 'Formulación bacteriana de Bacillus cereus', 'Producción y formulación controlada de Bacillus cereus, con verificación microbiológica, acondicionamiento y liberación. No incluye aplicación en campo.', 'Según formulación', 'Bacillus cereus', 920],
  ['bacterial-formulation-bacillus-thuringiensis', 'Formulación bacteriana de Bacillus thuringiensis', 'Producción, estandarización y formulación de Bacillus thuringiensis con control de calidad microbiológico. No incluye aplicación en campo.', 'Según formulación', 'Bacillus thuringiensis', 930],
  ['bacterial-formulation-bacillus-megaterium', 'Formulación bacteriana de Bacillus megaterium', 'Producción de biomasa y formulación de Bacillus megaterium, con control de concentración, pureza y acondicionamiento final. No incluye aplicación en campo.', 'Según formulación', 'Bacillus megaterium', 940],
  ['bacterial-formulation-bacillus-amyloliquefaciens', 'Formulación bacteriana de Bacillus amyloliquefaciens', 'Producción y formulación de Bacillus amyloliquefaciens con estandarización microbiológica y liberación del formulado. No incluye aplicación en campo.', 'Según formulación', 'Bacillus amyloliquefaciens', 950],
  ['bacterial-formulation-bacillus-velezensis', 'Formulación bacteriana de Bacillus velezensis', 'Producción y formulación de Bacillus velezensis con control de pureza, viabilidad y concentración. No incluye aplicación en campo.', 'Según formulación', 'Bacillus velezensis', 960],
  ['bacterial-formulation-pseudomonas-putida', 'Formulación bacteriana de Pseudomonas putida', 'Producción, estandarización y formulación de Pseudomonas putida con control de calidad y acondicionamiento final. No incluye aplicación en campo.', 'Según formulación', 'Pseudomonas putida', 970],
  ['bacterial-formulation-pseudomonas-fluorescens', 'Formulación bacteriana de Pseudomonas fluorescens', 'Producción, estandarización y formulación de Pseudomonas fluorescens con control microbiológico. No incluye aplicación en campo.', 'Según formulación', 'Pseudomonas fluorescens', 980],
  ['bacterial-formulation-azotobacter-chroococcum', 'Formulación bacteriana de Azotobacter chroococcum', 'Producción y formulación de Azotobacter chroococcum con control de concentración, pureza y viabilidad. No incluye aplicación en campo.', 'Según formulación', 'Azotobacter chroococcum', 990],
  ['bacterial-formulation-azospirillum-brasilense', 'Formulación bacteriana de Azospirillum brasilense', 'Producción y formulación de Azospirillum brasilense con estandarización y control microbiológico. No incluye aplicación en campo.', 'Según formulación', 'Azospirillum brasilense', 1000],
  ['bacterial-formulation-consortium', 'Formulación de consorcio bacteriano', 'Desarrollo de una formulación con dos o más cepas compatibles, incluyendo producción, estandarización, control de calidad y acondicionamiento. No incluye aplicación en campo.', 'Según alcance', 'Consorcios bacterianos compatibles', 1010],
  ['bacterial-formulation-custom', 'Formulación bacteriana personalizada', 'Formulación de una especie o cepa bacteriana definida en la cotización, con alcance, concentración y presentación acordados. No incluye aplicación en campo.', 'Según alcance', 'Cepas bacterianas compatibles con el alcance', 1020],
]

for (const [id, name, description, duration, matrixScope, sortOrder] of bacterialFormulationCatalog) {
  await sql.query(
    `INSERT INTO service_catalog
     (id,category_id,category_name,name,description,estimated_duration,icon,group_name,matrix_scope,sort_order,active)
     VALUES ($1,'research','Investigación y desarrollo',$2,$3,$4,'🧫','Formulación bacteriana',$5,$6,true)
     ON CONFLICT (id) DO UPDATE SET
       category_id=EXCLUDED.category_id,
       category_name=EXCLUDED.category_name,
       name=EXCLUDED.name,
       description=EXCLUDED.description,
       estimated_duration=EXCLUDED.estimated_duration,
       icon=EXCLUDED.icon,
       group_name=EXCLUDED.group_name,
       matrix_scope=EXCLUDED.matrix_scope,
       sort_order=EXCLUDED.sort_order,
       active=true,
       updated_at=NOW()`,
    [id, name, description, duration, matrixScope, sortOrder],
  )
}

const physicochemicalCatalog = [
  ['general-ph', 'Mediciones básicas', 'Agua, suelo, alimentos y muestras generales', 'pH', 'Medición de acidez o alcalinidad según la matriz recibida.', '3–5 días', '🧪', 10],
  ['general-conductivity', 'Mediciones básicas', 'Agua, suelo y muestras generales', 'Conductividad eléctrica', 'Medición de la capacidad conductora y estimación del contenido iónico de la muestra.', '3–5 días', '⚡', 20],
  ['physchem-temperature', 'Mediciones básicas', 'Agua y muestras líquidas', 'Temperatura', 'Registro de temperatura de la muestra o determinación durante el ensayo.', '1–3 días', '🌡️', 30],
  ['physchem-turbidity', 'Mediciones básicas', 'Agua y muestras líquidas', 'Turbidez', 'Cuantificación de partículas suspendidas por medición nefelométrica.', '3–5 días', '💧', 40],
  ['physchem-color', 'Mediciones básicas', 'Agua y muestras líquidas', 'Color aparente o verdadero', 'Evaluación de color según la naturaleza y preparación de la muestra.', '3–5 días', '🎨', 50],
  ['physchem-salinity', 'Mediciones básicas', 'Agua, suelo y extractos', 'Salinidad', 'Determinación del contenido salino de la muestra.', '3–5 días', '🧂', 60],
  ['physchem-redox', 'Mediciones básicas', 'Agua, suelo y lodos', 'Potencial de óxido-reducción', 'Medición del potencial redox para caracterizar las condiciones oxidantes o reductoras.', '3–5 días', '⚡', 70],
  ['physchem-density', 'Mediciones básicas', 'Líquidos, alimentos y muestras generales', 'Densidad o gravedad específica', 'Determinación de densidad según el estado y naturaleza de la muestra.', '3–5 días', '⚖️', 80],

  ['general-acidity', 'Acidez, alcalinidad y dureza', 'Agua, alimentos y muestras generales', 'Acidez titulable', 'Determinación de acidez de acuerdo con la naturaleza de la muestra.', '3–5 días', '💧', 110],
  ['physchem-alkalinity', 'Acidez, alcalinidad y dureza', 'Agua y muestras líquidas', 'Alcalinidad total', 'Capacidad de neutralización ácida expresada según la matriz analizada.', '3–5 días', '⚗️', 120],
  ['physchem-carbonate-bicarbonate', 'Acidez, alcalinidad y dureza', 'Agua, suelo y extractos', 'Carbonatos y bicarbonatos', 'Determinación diferenciada de carbonatos y bicarbonatos.', '4–6 días', '⚗️', 130],
  ['physchem-total-hardness', 'Acidez, alcalinidad y dureza', 'Agua y muestras líquidas', 'Dureza total', 'Cuantificación de dureza total, usualmente expresada como carbonato de calcio.', '4–6 días', '💎', 140],
  ['physchem-calcium-hardness', 'Acidez, alcalinidad y dureza', 'Agua y muestras líquidas', 'Dureza cálcica', 'Determinación de la fracción de dureza asociada al calcio.', '4–6 días', '💎', 150],

  ['physchem-ammonium', 'Formas de nitrógeno', 'Agua, suelo, fertilizantes y muestras generales', 'Amonio (NH₄⁺)', 'Cuantificación de amonio en la matriz indicada en la cotización.', '4–7 días', '🧪', 210],
  ['general-ammonia', 'Formas de nitrógeno', 'Agua y muestras generales', 'Amoniaco (NH₃)', 'Cuantificación de amoniaco en la matriz indicada en la cotización.', '4–7 días', '⚗️', 220],
  ['physchem-nitrite', 'Formas de nitrógeno', 'Agua, suelo y extractos', 'Nitritos (NO₂⁻)', 'Determinación de nitritos en muestras líquidas o extractos preparados.', '4–7 días', '🧪', 230],
  ['physchem-nitrate', 'Formas de nitrógeno', 'Agua, suelo, material vegetal y extractos', 'Nitratos (NO₃⁻)', 'Cuantificación de nitratos según la matriz analizada.', '4–7 días', '🧪', 240],
  ['physchem-nitrate-nitrite', 'Formas de nitrógeno', 'Agua y extractos', 'Nitrato + nitrito', 'Determinación conjunta de nitrógeno como nitrato y nitrito.', '4–7 días', '🧪', 250],
  ['physchem-total-nitrogen', 'Formas de nitrógeno', 'Agua, suelo, alimentos y muestras generales', 'Nitrógeno total', 'Cuantificación del contenido total de nitrógeno en la muestra.', '5–8 días', '🌿', 260],
  ['physchem-kjeldahl-nitrogen', 'Formas de nitrógeno', 'Agua, suelo, alimentos y muestras orgánicas', 'Nitrógeno Kjeldahl total', 'Determinación de nitrógeno orgánico y amoniacal mediante digestión.', '5–8 días', '🧪', 270],

  ['physchem-npk', 'Nutrientes y fertilidad', 'Suelo, sustratos, fertilizantes y material vegetal', 'Perfil NPK', 'Perfil conjunto de nitrógeno, fósforo y potasio para una misma muestra.', '6–9 días', '🌱', 310],
  ['physchem-phosphorus-total', 'Nutrientes y fertilidad', 'Agua, suelo, fertilizantes y muestras generales', 'Fósforo total', 'Cuantificación del contenido total de fósforo.', '5–8 días', '🧪', 320],
  ['physchem-phosphorus-available', 'Nutrientes y fertilidad', 'Suelo y sustratos', 'Fósforo disponible', 'Determinación de la fracción de fósforo disponible según las características del suelo.', '5–8 días', '🌱', 330],
  ['physchem-orthophosphate', 'Nutrientes y fertilidad', 'Agua y extractos', 'Ortofosfatos', 'Cuantificación de fósforo reactivo en forma de ortofosfato.', '4–7 días', '💧', 340],
  ['physchem-potassium', 'Nutrientes y fertilidad', 'Agua, suelo, material vegetal y fertilizantes', 'Potasio', 'Cuantificación de potasio total, soluble o disponible según la matriz.', '5–8 días', '🌿', 350],
  ['physchem-calcium', 'Nutrientes y fertilidad', 'Agua, suelo, material vegetal y fertilizantes', 'Calcio', 'Determinación de calcio en la muestra o extracto correspondiente.', '5–8 días', '🧪', 360],
  ['physchem-magnesium', 'Nutrientes y fertilidad', 'Agua, suelo, material vegetal y fertilizantes', 'Magnesio', 'Determinación de magnesio en la muestra o extracto correspondiente.', '5–8 días', '🧪', 370],
  ['physchem-sulfur', 'Nutrientes y fertilidad', 'Suelo, material vegetal y fertilizantes', 'Azufre', 'Cuantificación de azufre total o disponible según el alcance cotizado.', '5–8 días', '🌿', 380],
  ['physchem-aluminum', 'Nutrientes y fertilidad', 'Suelo, sustratos y extractos', 'Aluminio', 'Determinación de aluminio total o intercambiable según la matriz y el método cotizado.', '5–8 días', '🧪', 385],
  ['physchem-boron', 'Nutrientes y fertilidad', 'Agua, suelo, material vegetal y fertilizantes', 'Boro', 'Cuantificación de boro, elemento relevante en nutrición y calidad de agua de riego.', '5–8 días', '🌱', 390],
  ['physchem-micronutrients', 'Nutrientes y fertilidad', 'Suelo, material vegetal y fertilizantes', 'Micronutrientes Fe, Mn, Zn y Cu', 'Perfil de hierro, manganeso, zinc y cobre para diagnóstico nutricional.', '6–9 días', '🔬', 400],

  ['physchem-chloride', 'Iones, sales y sodicidad', 'Agua, suelo, fertilizantes y extractos', 'Cloruros', 'Cuantificación del ion cloruro en la matriz indicada.', '4–7 días', '🧂', 510],
  ['physchem-sulfate', 'Iones, sales y sodicidad', 'Agua, suelo, fertilizantes y extractos', 'Sulfatos', 'Cuantificación del ion sulfato en la matriz indicada.', '4–7 días', '🧪', 520],
  ['physchem-fluoride', 'Iones, sales y sodicidad', 'Agua y muestras líquidas', 'Fluoruros', 'Determinación de fluoruros en muestras de agua o matrices compatibles.', '4–7 días', '💧', 530],
  ['physchem-sodium', 'Iones, sales y sodicidad', 'Agua, suelo, material vegetal y extractos', 'Sodio', 'Cuantificación de sodio soluble, intercambiable o total según la matriz.', '5–8 días', '🧂', 540],
  ['physchem-soluble-salts', 'Iones, sales y sodicidad', 'Agua, suelo y extractos', 'Sales solubles totales', 'Evaluación de la carga salina soluble de la muestra.', '4–7 días', '🧂', 550],
  ['physchem-sar', 'Iones, sales y sodicidad', 'Agua de riego y extractos de suelo', 'Relación de adsorción de sodio (RAS)', 'Cálculo del riesgo de sodicidad a partir de sodio, calcio y magnesio.', '5–8 días', '💦', 560],
  ['physchem-rsc', 'Iones, sales y sodicidad', 'Agua de riego', 'Carbonato de sodio residual', 'Cálculo del riesgo asociado a carbonatos y bicarbonatos frente a calcio y magnesio.', '5–8 días', '💦', 570],
  ['physchem-exchangeable-bases', 'Iones, sales y sodicidad', 'Suelo y sustratos', 'Bases intercambiables', 'Perfil de calcio, magnesio, potasio y sodio intercambiables.', '6–9 días', '🌱', 580],
  ['physchem-cec', 'Iones, sales y sodicidad', 'Suelo y sustratos', 'Capacidad de intercambio catiónico', 'Determinación de la capacidad del suelo o sustrato para retener cationes.', '6–9 días', '🪨', 590],
  ['physchem-base-saturation', 'Iones, sales y sodicidad', 'Suelo y sustratos', 'Saturación de bases', 'Cálculo del porcentaje de ocupación de la capacidad de intercambio por bases.', '6–9 días', '🌱', 600],
  ['physchem-exchangeable-acidity', 'Iones, sales y sodicidad', 'Suelo y sustratos', 'Acidez intercambiable', 'Determinación de acidez intercambiable y aluminio cuando corresponda.', '6–9 días', '🧪', 610],

  ['physchem-tds', 'Sólidos y propiedades físicas', 'Agua y muestras líquidas', 'Sólidos disueltos totales', 'Cuantificación gravimétrica o instrumental de sólidos disueltos.', '4–7 días', '💧', 710],
  ['physchem-tss', 'Sólidos y propiedades físicas', 'Agua, efluentes y muestras líquidas', 'Sólidos suspendidos totales', 'Cuantificación de sólidos retenidos en suspensión.', '4–7 días', '🧪', 720],
  ['physchem-total-solids', 'Sólidos y propiedades físicas', 'Agua, lodos y muestras generales', 'Sólidos totales', 'Determinación de la masa total de residuos tras secado.', '4–7 días', '⚖️', 730],
  ['physchem-volatile-fixed-solids', 'Sólidos y propiedades físicas', 'Agua, lodos y muestras generales', 'Sólidos fijos y volátiles', 'Fraccionamiento gravimétrico de sólidos por ignición.', '5–8 días', '🔥', 740],
  ['physchem-settleable-solids', 'Sólidos y propiedades físicas', 'Efluentes, lodos y muestras líquidas', 'Sólidos sedimentables', 'Medición del material que sedimenta bajo condiciones definidas.', '4–7 días', '⌛', 750],
  ['physchem-moisture', 'Sólidos y propiedades físicas', 'Suelo, alimentos y muestras sólidas', 'Humedad', 'Determinación del contenido de humedad de la muestra.', '3–5 días', '💧', 760],
  ['physchem-dry-matter', 'Sólidos y propiedades físicas', 'Suelo, alimentos, biomasa y muestras sólidas', 'Materia seca', 'Cuantificación de la fracción remanente después del secado.', '3–5 días', '🌾', 770],
  ['physchem-ash', 'Sólidos y propiedades físicas', 'Alimentos, biomasa, suelo y muestras sólidas', 'Cenizas', 'Cuantificación del residuo mineral después de la ignición.', '4–7 días', '🔥', 780],

  ['physchem-organic-matter', 'Materia orgánica y carga', 'Suelo, compost, sustratos y muestras orgánicas', 'Materia orgánica', 'Estimación o cuantificación del contenido de materia orgánica.', '5–8 días', '🌿', 810],
  ['physchem-organic-carbon', 'Materia orgánica y carga', 'Suelo, compost, lodos y muestras orgánicas', 'Carbono orgánico', 'Cuantificación del carbono asociado a la fracción orgánica.', '5–8 días', '🌱', 820],
  ['physchem-dissolved-oxygen', 'Materia orgánica y carga', 'Agua y muestras líquidas', 'Oxígeno disuelto', 'Determinación del oxígeno disponible en la fase líquida.', '3–5 días', '💧', 830],
  ['physchem-bod5', 'Materia orgánica y carga', 'Agua y efluentes', 'Demanda bioquímica de oxígeno (DBO₅)', 'Estimación de materia orgánica biodegradable mediante consumo de oxígeno.', '6–8 días', '🧪', 840],
  ['physchem-cod', 'Materia orgánica y carga', 'Agua y efluentes', 'Demanda química de oxígeno (DQO)', 'Estimación de carga oxidable mediante digestión química.', '4–7 días', '⚗️', 850],
  ['physchem-oils-greases', 'Materia orgánica y carga', 'Agua, efluentes y muestras generales', 'Aceites y grasas', 'Cuantificación de sustancias extraíbles asociadas a aceites y grasas.', '5–8 días', '🫧', 860],
  ['physchem-custom', 'Parámetros personalizados', 'Cualquier matriz compatible', 'Análisis fisicoquímico personalizado', 'Parámetro, método y alcance definidos en la cotización para una necesidad específica.', 'Según alcance', '🔬', 990],
]

for (const item of physicochemicalCatalog) {
  const [id, groupName, matrixScope, name, description, duration, icon, sortOrder] = item
  await sql.query(
    `INSERT INTO service_catalog
     (id, category_id, category_name, name, description, estimated_duration, icon, group_name, matrix_scope, sort_order)
     VALUES ($1,'physicochemical','Análisis fisicoquímicos',$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (id) DO UPDATE SET
       category_id = EXCLUDED.category_id,
       category_name = EXCLUDED.category_name,
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       estimated_duration = EXCLUDED.estimated_duration,
       icon = EXCLUDED.icon,
       group_name = EXCLUDED.group_name,
       matrix_scope = EXCLUDED.matrix_scope,
       sort_order = EXCLUDED.sort_order,
       active = true,
       updated_at = NOW()`,
    [id, name, description, duration, icon, groupName, matrixScope, sortOrder],
  )
}

const expandedMicrobiologyCatalog = [
  ['micro-listeria-spp', 'Patógenos e indicadores', 'Alimentos, superficies y muestras ambientales', 'Detección de Listeria spp.', 'Detección cualitativa mediante enriquecimiento, aislamiento y confirmación de colonias sospechosas.', '5–8 días', '🧫', 110],
  ['micro-listeria-monocytogenes', 'Patógenos e indicadores', 'Alimentos, superficies y muestras ambientales', 'Detección de Listeria monocytogenes', 'Detección y confirmación de Listeria monocytogenes en la matriz indicada.', '5–8 días', '🔬', 120],
  ['micro-salmonella', 'Patógenos e indicadores', 'Alimentos, agua, superficies y muestras ambientales', 'Detección de Salmonella spp.', 'Detección cualitativa mediante preenriquecimiento, enriquecimiento selectivo, aislamiento y confirmación.', '5–8 días', '🦠', 130],
  ['micro-bacillus-cereus', 'Patógenos e indicadores', 'Alimentos y muestras ambientales', 'Recuento de Bacillus cereus', 'Detección o recuento de Bacillus cereus presuntivo y confirmado según el alcance.', '5–8 días', '🧫', 140],
  ['micro-clostridium-perfringens', 'Patógenos e indicadores', 'Alimentos, agua y muestras ambientales', 'Recuento de Clostridium perfringens', 'Determinación de microorganismos anaerobios sulfito reductores y confirmación cuando corresponda.', '5–8 días', '🦠', 150],
  ['micro-enterococcus', 'Patógenos e indicadores', 'Agua y muestras ambientales', 'Recuento de enterococos', 'Cuantificación de enterococos como indicador microbiológico de la matriz analizada.', '4–7 días', '🧫', 160],
  ['micro-vibrio', 'Patógenos e indicadores', 'Alimentos, agua y productos hidrobiológicos', 'Detección de Vibrio spp.', 'Aislamiento y confirmación de Vibrio spp. de interés según la muestra.', '5–8 días', '🔬', 170],
  ['micro-bacterias-acido-lacticas', 'Microorganismos tecnológicos', 'Alimentos, fermentos y formulaciones', 'Recuento de bacterias ácido-lácticas', 'Cuantificación de bacterias ácido-lácticas viables en cultivos, alimentos o formulaciones.', '5–8 días', '🧫', 210],
  ['micro-bacillus-spp', 'Microorganismos tecnológicos', 'Suelo, formulaciones y muestras generales', 'Recuento de Bacillus spp.', 'Cuantificación de Bacillus spp. viables, incluyendo formas vegetativas o esporuladas según alcance.', '5–8 días', '🦠', 220],
  ['micro-azotobacter', 'Microorganismos tecnológicos', 'Suelo, bioinsumos y formulaciones', 'Recuento de Azotobacter spp.', 'Cuantificación de microorganismos fijadores de nitrógeno de vida libre.', '6–9 días', '🌱', 230],
  ['micro-phosphate-solubilizers', 'Microorganismos tecnológicos', 'Suelo, bioinsumos y formulaciones', 'Microorganismos solubilizadores de fósforo', 'Recuento o evaluación de microorganismos con capacidad de solubilización de fosfatos.', '6–10 días', '🌿', 240],
  ['micro-suspension-concentration', 'Preparaciones microbiológicas', 'Cultivos, bioinsumos y suspensiones', 'Concentración de suspensión microbiana', 'Preparación o verificación de concentración celular, viabilidad y pureza de una suspensión.', '4–7 días', '🧪', 310],
  ['micro-sterility', 'Preparaciones microbiológicas', 'Medios, materiales, formulaciones y productos', 'Prueba de esterilidad', 'Verificación de ausencia de crecimiento microbiano bajo las condiciones definidas.', '5–10 días', '✨', 320],
  ['micro-pure-culture-control', 'Preparaciones microbiológicas', 'Cepas y cultivos de laboratorio', 'Control de pureza de cultivo', 'Evaluación de homogeneidad colonial y ausencia de contaminación del cultivo recibido.', '4–7 días', '🔬', 330],
]

const researchCatalog = [
  ['research-dna-detection', 'Biología molecular', 'Tejidos, cultivos, alimentos y muestras ambientales', 'Detección de DNA objetivo', 'Diseño o aplicación de una estrategia para detectar una secuencia de DNA definida en la muestra.', 'Según proyecto', '🧬', 10],
  ['research-pcr', 'Biología molecular', 'DNA extraído o muestras compatibles', 'PCR convencional', 'Amplificación de una región objetivo con controles y documentación del resultado.', '5–10 días', '🧬', 20],
  ['research-qpcr', 'Biología molecular', 'DNA extraído o muestras compatibles', 'PCR en tiempo real (qPCR)', 'Detección o cuantificación relativa/absoluta según el ensayo y los controles definidos.', '7–12 días', '📈', 30],
  ['research-primer-design', 'Biología molecular', 'Proyecto de investigación', 'Diseño y evaluación de primers', 'Diseño in silico, revisión de especificidad y propuesta de condiciones de amplificación.', 'Según proyecto', '🧬', 40],
  ['research-molecular-identification', 'Biología molecular', 'Aislados bacterianos, fúngicos u otras muestras', 'Identificación molecular de microorganismos', 'Extracción, amplificación de marcador, análisis y emisión de interpretación técnica.', 'Según proyecto', '🔬', 50],
  ['research-molecular-identification-genome', 'Biología molecular', 'Aislados bacterianos, fúngicos u otros microorganismos', 'Identificación molecular de microorganismos — secuenciamiento del genoma', 'Extracción y control de calidad del DNA, preparación documental y logística internacional. La etapa operativa final corresponde al envío a China para secuenciamiento del genoma.', 'Según logística internacional', '🧬', 60],
  ['research-molecular-identification-16s', 'Biología molecular', 'Aislados bacterianos y arqueanos', 'Identificación molecular de microorganismos — 16S rRNA', 'Extracción de DNA, amplificación de la región 16S rRNA, control de calidad, secuenciamiento, análisis bioinformático e informe de identificación.', '12–20 días', '🧬', 70],
  ['research-molecular-identification-its', 'Biología molecular', 'Aislados fúngicos y levaduras', 'Identificación molecular de microorganismos — región ITS', 'Extracción de DNA, amplificación de la región ITS, control de calidad, secuenciamiento, análisis bioinformático e informe de identificación.', '12–20 días', '🍄', 80],
  ['research-bacterial-suspension', 'Cultivos y suspensiones', 'Cepas bacterianas y bioinsumos', 'Desarrollo de suspensiones bacterianas', 'Propagación, ajuste de concentración, control de pureza y viabilidad de suspensiones.', 'Según proyecto', '🧪', 110],
  ['research-bacterial-culture', 'Cultivos y suspensiones', 'Cepas bacterianas', 'Cultivo de bacterias', 'Activación, propagación y conservación temporal bajo condiciones definidas.', 'Según proyecto', '🦠', 120],
  ['research-pure-culture', 'Cultivos y suspensiones', 'Aislados bacterianos o fúngicos', 'Obtención de cultivos puros', 'Aislamiento sucesivo, selección colonial y verificación de pureza del cultivo.', 'Según proyecto', '🧫', 130],
  ['research-strain-isolation', 'Cultivos y suspensiones', 'Suelo, plantas, agua y muestras ambientales', 'Aislamiento de cepas de interés', 'Recuperación y selección de microorganismos con características definidas por el proyecto.', 'Según proyecto', '🔬', 140],
  ['research-growth-curve', 'Cultivos y suspensiones', 'Cepas y formulaciones', 'Curva de crecimiento microbiano', 'Seguimiento temporal de biomasa o viabilidad para definir fases y condiciones de producción.', 'Según proyecto', '📊', 150],
  ['research-inoculum-standardization', 'Cultivos y suspensiones', 'Cultivos bacterianos o fúngicos', 'Estandarización de inóculo', 'Ajuste de concentración y verificación de viabilidad para ensayos o aplicaciones.', 'Según proyecto', '🧪', 160],
  ['research-antagonism', 'Ensayos funcionales', 'Aislados y microorganismos objetivo', 'Ensayo de antagonismo microbiano', 'Evaluación comparativa de inhibición o interacción entre microorganismos bajo condiciones controladas.', 'Según proyecto', '🧫', 210],
  ['research-biofilm', 'Ensayos funcionales', 'Cepas, materiales y formulaciones', 'Formación o inhibición de biopelículas', 'Ensayo exploratorio para medir formación, adherencia o inhibición de biopelículas.', 'Según proyecto', '🔬', 220],
  ['research-formulation-stability', 'Ensayos funcionales', 'Bioinsumos y formulaciones', 'Estabilidad y viabilidad de formulaciones', 'Seguimiento de concentración viable, contaminación y comportamiento durante almacenamiento.', 'Según proyecto', '📈', 230],
  ['research-concrete-bioremediation-beads', 'Biomateriales y bioremediación', 'Prototipo de material cementicio', 'Perlas bacterianas para bioremediación de concreto', 'Desarrollo experimental de portadores con piedra pómez, bacterias y lactato de calcio para evaluar biomineralización y sellado de fisuras.', 'Según proyecto', '🪨', 310],
  ['research-biomineralization', 'Biomateriales y bioremediación', 'Suelo, agregados y materiales cementicios', 'Ensayo de biomineralización', 'Evaluación de precipitación mineral inducida por microorganismos y condiciones del medio.', 'Según proyecto', '🧱', 320],
  ['research-bioremediation-screening', 'Biomateriales y bioremediación', 'Suelo, agua, efluentes y materiales', 'Tamizaje de microorganismos para bioremediación', 'Selección preliminar de aislados por tolerancia o actividad frente al objetivo del proyecto.', 'Según proyecto', '🌿', 330],
  ['research-pilot-scale', 'Desarrollo experimental', 'Proyecto de investigación', 'Ensayo piloto y escalamiento', 'Diseño y ejecución controlada de una prueba piloto con criterios de seguimiento y cierre.', 'Según proyecto', '⚗️', 410],
  ['research-protocol-development', 'Desarrollo experimental', 'Proyecto de investigación', 'Desarrollo y optimización de protocolo', 'Comparación de variables, documentación de condiciones y selección del procedimiento más adecuado.', 'Según proyecto', '📋', 420],
  ['research-custom', 'Desarrollo experimental', 'Cualquier matriz compatible', 'Investigación personalizada', 'Alcance, fases, entregables y criterios definidos conjuntamente en la cotización del proyecto.', 'Según proyecto', '🔎', 490],
]

for (const [categoryId, categoryName, items] of [
  ['microbiology', 'Análisis microbiológicos', expandedMicrobiologyCatalog],
  ['research', 'Investigación y desarrollo', researchCatalog],
]) {
  for (const item of items) {
    const [id, groupName, matrixScope, name, description, duration, icon, sortOrder] = item
    await sql.query(
      `INSERT INTO service_catalog
       (id,category_id,category_name,name,description,estimated_duration,icon,group_name,matrix_scope,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         category_id=EXCLUDED.category_id,category_name=EXCLUDED.category_name,name=EXCLUDED.name,
         description=EXCLUDED.description,estimated_duration=EXCLUDED.estimated_duration,icon=EXCLUDED.icon,
         group_name=EXCLUDED.group_name,matrix_scope=EXCLUDED.matrix_scope,sort_order=EXCLUDED.sort_order,
         active=true,updated_at=NOW()`,
      [id, categoryId, categoryName, name, description, duration, icon, groupName, matrixScope, sortOrder],
    )
  }
}

await sql.query(
  `INSERT INTO service_request_items
     (service_id, catalog_service_id, category_id, category_name, service_name, sort_order)
   SELECT s.id, s.service_type_id,
          COALESCE(s.service_category_id, 'legacy'),
          COALESCE(s.service_category_name, 'Servicios de laboratorio'),
          s.service_type_name,
          0
   FROM service_requests s
   WHERE NOT EXISTS (
     SELECT 1 FROM service_request_items item WHERE item.service_id = s.id
   )
   ON CONFLICT (service_id, catalog_service_id) DO NOTHING`,
)

await sql.query(
  `UPDATE service_requests
   SET service_category_id = COALESCE(service_category_id, CASE WHEN service_type_id = 'dna' THEN 'biotechnology' ELSE 'legacy' END),
       service_category_name = COALESCE(service_category_name, CASE WHEN service_type_id = 'dna' THEN 'Biotecnología' ELSE 'Servicios de laboratorio' END)
   WHERE service_category_id IS NULL OR service_category_name IS NULL`,
)

console.log('Esquema actualizado sin borrar datos operativos.')
