import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import { promisify } from 'node:util'
import { neon } from '@neondatabase/serverless'

const scrypt = promisify(crypto.scrypt)

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

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const derived = await scrypt(password, salt, 64)
  return `scrypt$${salt}$${Buffer.from(derived).toString('hex')}`
}

await loadLocalEnv()
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no está disponible')
if (process.env.ASLABS_ALLOW_DATA_RESET !== 'CONFIRM_RESET_ALL_OPERATIONAL_DATA') {
  throw new Error(
    'Seed destructivo bloqueado. Usa scripts/migrate-db.mjs para cambios normales. '
    + 'Solo define ASLABS_ALLOW_DATA_RESET=CONFIRM_RESET_ALL_OPERATIONAL_DATA si realmente deseas borrar todos los datos operativos.',
  )
}
if (!process.env.ASLABS_ADMIN_PASSWORD || !process.env.ASLABS_CLIENT_PASSWORD) {
  throw new Error('Define ASLABS_ADMIN_PASSWORD y ASLABS_CLIENT_PASSWORD para ejecutar el seed')
}

const sql = neon(process.env.DATABASE_URL)
const schema = await fs.readFile(new URL('../db/schema.sql', import.meta.url), 'utf8')
for (const statement of schema.split(';').map((value) => value.trim()).filter(Boolean)) {
  await sql.query(statement)
}

const modules = [
  ['dashboard', 'Resumen', 'Indicadores y actividad general', 10],
  ['orders', 'Órdenes', 'Servicios y solicitudes de análisis', 20],
  ['tracking', 'Muestreo en campo', 'Ubicación y actividad de cuadrillas', 30],
  ['dna', 'Extracción de DNA', 'Trazabilidad del proceso de DNA', 40],
  ['zones', 'Zonas de campo', 'Cartografía y lotes', 50],
  ['results', 'Resultados', 'Informes y resultados analíticos', 60],
  ['users', 'Usuarios y accesos', 'Usuarios, roles y permisos', 70],
  ['analysts', 'Analistas', 'Directorio de profesionales del laboratorio', 80],
  ['notifications', 'Notificaciones', 'Centro de avisos y alertas', 90],
  ['procurement', 'Proveedores y compras', 'Órdenes de compra, cotizaciones y pagos a proveedores', 75],
]

for (const module of modules) {
  await sql.query(
    `INSERT INTO modules (id, name, description, sort_order)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, sort_order = EXCLUDED.sort_order`,
    module,
  )
}

const roleRows = [
  ['Administrador', 'admin', 'Acceso completo a todos los módulos', true],
  ['Cliente', 'client', 'Acceso a servicios, trazabilidad y resultados de su empresa', true],
  ['Operaciones de campo', 'field-operator', 'Acceso operativo a muestreos y ubicación', true],
  ['Proveedor', 'supplier', 'Acceso exclusivo a órdenes de compra y envío de cotizaciones', true],
]

for (const role of roleRows) {
  await sql.query(
    `INSERT INTO roles (name, slug, description, is_system)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`,
    role,
  )
}

const roles = await sql.query(`SELECT id, slug FROM roles WHERE slug IN ('admin', 'client', 'field-operator')`)
const roleBySlug = Object.fromEntries(roles.map((role) => [role.slug, role.id]))

for (const module of modules) {
  await sql.query(
    `INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
     VALUES ($1, $2, true, true, true, true)
     ON CONFLICT (role_id, module_id) DO UPDATE
     SET can_view = true, can_create = true, can_edit = true, can_delete = true`,
    [roleBySlug.admin, module[0]],
  )
}

const clientMatrix = {
  dashboard: [true, false, false, false],
  orders: [true, true, false, false],
  tracking: [true, false, false, false],
  dna: [true, true, false, false],
  zones: [true, true, true, false],
  results: [true, false, false, false],
  notifications: [true, false, true, false],
}
for (const [moduleId, permissions] of Object.entries(clientMatrix)) {
  await sql.query(
    `INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (role_id, module_id) DO UPDATE
     SET can_view = EXCLUDED.can_view, can_create = EXCLUDED.can_create,
         can_edit = EXCLUDED.can_edit, can_delete = EXCLUDED.can_delete`,
    [roleBySlug.client, moduleId, ...permissions],
  )
}

for (const moduleId of ['dashboard', 'tracking', 'zones', 'notifications']) {
  await sql.query(
    `INSERT INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
     VALUES ($1, $2, true, false, true, false)
     ON CONFLICT (role_id, module_id) DO UPDATE SET can_view = true, can_edit = true`,
    [roleBySlug['field-operator'], moduleId],
  )
}

const adminHash = await hashPassword(process.env.ASLABS_ADMIN_PASSWORD)
const clientHash = await hashPassword(process.env.ASLABS_CLIENT_PASSWORD)

const seededUsers = [
  ['antoniog@aslaboratorios.com', 'Antonio Guevara', 'AS Laboratorios', 'AG', adminHash, roleBySlug.admin],
  ['maxim.balakarev@skyeast.co.uk', 'Maxim Balakarev', 'Skyeast', 'MB', clientHash, roleBySlug.client],
]
for (const user of seededUsers) {
  await sql.query(
    `INSERT INTO users (email, full_name, company, initials, password_hash, role_id, status)
     VALUES (LOWER($1), $2, $3, $4, $5, $6, 'active')
     ON CONFLICT (email) DO UPDATE
     SET full_name = EXCLUDED.full_name, company = EXCLUDED.company, initials = EXCLUDED.initials,
         password_hash = EXCLUDED.password_hash, role_id = EXCLUDED.role_id, status = 'active'`,
    user,
  )
}

const users = await sql.query('SELECT id, email FROM users')
const userByEmail = Object.fromEntries(users.map((user) => [user.email, user.id]))
await sql.query('DELETE FROM notifications')
const notices = [
  [userByEmail['maxim.balakarev@skyeast.co.uk'], 'Purificación de DNA en proceso', 'La orden DNA-2510 avanzó a la etapa 5 de 8.', 'dna', 'high', 'client', 'dna'],
  [userByEmail['maxim.balakarev@skyeast.co.uk'], 'Muestreo actualizado', 'Luis Mendoza completó el 68% del recorrido en Lote Skyeast Norte.', 'tracking', 'normal', 'client', 'tracking'],
  [userByEmail['maxim.balakarev@skyeast.co.uk'], 'Resultado disponible', 'El informe OS-2440 ya está listo para revisar.', 'result', 'normal', 'client', 'results'],
  [userByEmail['antoniog@aslaboratorios.com'], '4 cuadrillas conectadas', 'Todos los equipos de campo reportan ubicación correctamente.', 'tracking', 'normal', 'admin', 'tracking'],
  [userByEmail['antoniog@aslaboratorios.com'], 'Orden con prioridad alta', 'DNA-2510 requiere control de calidad mañana a las 16:00.', 'dna', 'high', 'admin', 'dna'],
]
for (const notice of notices) {
  await sql.query(
    `INSERT INTO notifications (user_id, title, body, type, priority, audience, action_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    notice,
  )
}

const workers = [
  ['TR-017', 'Luis Mendoza', 'LM', 'Muestreo foliar', 'Lote Skyeast Norte', 'Muestreando', 68, -12.0472, -77.0254, 4, 'maxim.balakarev@skyeast.co.uk'],
  ['TR-024', 'María Torres', 'MT', 'Muestreo de suelo', 'Lote Skyeast Norte', 'Muestreando', 42, -12.0491, -77.0228, 6, 'maxim.balakarev@skyeast.co.uk'],
  ['TR-031', 'Diego Ramos', 'DR', 'Cadena de custodia', 'Invernadero 3', 'En traslado', 86, -12.0539, -77.0248, 5, null],
  ['TR-009', 'Carla Ruiz', 'CR', 'Supervisión de cuadrilla', 'Lote Este B', 'Supervisando', 55, -12.0481, -77.0152, 3, null],
]
for (const worker of workers) {
  await sql.query(
    `INSERT INTO workers
     (id, full_name, initials, task, zone, status, progress, lat, lng, accuracy_m, assigned_client_email, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
     ON CONFLICT (id) DO UPDATE SET
       full_name = EXCLUDED.full_name, initials = EXCLUDED.initials, task = EXCLUDED.task,
       zone = EXCLUDED.zone, status = EXCLUDED.status, progress = EXCLUDED.progress,
       lat = EXCLUDED.lat, lng = EXCLUDED.lng, accuracy_m = EXCLUDED.accuracy_m,
       assigned_client_email = EXCLUDED.assigned_client_email, last_seen_at = NOW()`,
    worker,
  )
}

await sql.query(
  `INSERT INTO dna_orders (id, client_email, client_name, sample_count, matrix, protocol, estimated_delivery)
   VALUES ('DNA-2510', 'maxim.balakarev@skyeast.co.uk', 'Skyeast', 8, 'Tejido foliar', 'CTAB optimizado', '2026-08-04')
   ON CONFLICT (id) DO UPDATE SET
     client_email = EXCLUDED.client_email, client_name = EXCLUDED.client_name,
     sample_count = EXCLUDED.sample_count, matrix = EXCLUDED.matrix,
     protocol = EXCLUDED.protocol, estimated_delivery = EXCLUDED.estimated_delivery`,
)
const dnaSteps = [
  ['solicitud', 1, 'Solicitud confirmada', 'Orden y protocolo validados', 'done', '27 Jul · 09:10'],
  ['recoleccion', 2, 'Muestra recolectada', '8 tubos identificados en campo', 'done', '27 Jul · 14:35'],
  ['recepcion', 3, 'Recepción en laboratorio', 'Cadena de custodia conforme', 'done', '28 Jul · 08:42'],
  ['lisis', 4, 'Lisis celular', 'Disrupción de tejido completada', 'done', '28 Jul · 12:18'],
  ['purificacion', 5, 'Purificación de DNA', 'Separación y lavado de columnas', 'current', '29 Jul · 09:30'],
  ['calidad', 6, 'Control de calidad', 'Concentración y pureza A260/A280', 'pending', 'Pendiente'],
  ['preparacion', 7, 'Preparación de envío', 'Alícuotas, sellado y documentación', 'pending', 'Pendiente'],
  ['envio', 8, 'Envío al cliente', 'Guía y trazabilidad de courier', 'pending', 'Estimado 04 Ago'],
]
for (const step of dnaSteps) {
  await sql.query(
    `INSERT INTO dna_steps (order_id, step_key, position, title, detail, state, event_time)
     VALUES ('DNA-2510', $1, $2, $3, $4, $5, $6)
     ON CONFLICT (order_id, step_key) DO UPDATE SET
       position = EXCLUDED.position, title = EXCLUDED.title, detail = EXCLUDED.detail,
       state = EXCLUDED.state, event_time = EXCLUDED.event_time`,
    step,
  )
}

// El entorno inicial se entrega sin datos operativos de demostración.
await sql.query('DELETE FROM location_updates')
await sql.query('DELETE FROM workers')
await sql.query('DELETE FROM dna_steps')
await sql.query('DELETE FROM dna_orders')
await sql.query('DELETE FROM zones')
await sql.query('DELETE FROM service_stage_photos')
await sql.query('DELETE FROM service_stage_events')
await sql.query('DELETE FROM service_workflow_stages')
await sql.query('DELETE FROM service_requests')
await sql.query('DELETE FROM analysts')
await sql.query('DELETE FROM notifications')

console.log('Base de datos inicializada correctamente.')
