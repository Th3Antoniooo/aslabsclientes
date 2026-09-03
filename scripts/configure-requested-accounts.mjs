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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    process.env[match[1]] = value.replace(/\\n/g, '\n')
  }
}

async function hashSecret(secret) {
  const salt = crypto.randomBytes(16).toString('hex')
  const derived = await scrypt(secret, salt, 64)
  return `scrypt$${salt}$${Buffer.from(derived).toString('hex')}`
}

await loadLocalEnv()
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no está disponible')
if (!process.env.ASLABS_WORKER_PASSWORD || !process.env.ASLABS_LUIS_PASSWORD) {
  throw new Error('Define ASLABS_WORKER_PASSWORD y ASLABS_LUIS_PASSWORD')
}

const sql = neon(process.env.DATABASE_URL)
const roles = await sql.query(`SELECT id,slug FROM roles WHERE slug IN ('admin','laboratory-worker')`)
const role = Object.fromEntries(roles.map((item) => [item.slug, item.id]))
if (!role.admin || !role['laboratory-worker']) throw new Error('Ejecuta primero scripts/migrate-db.mjs')

const workerHash = await hashSecret(process.env.ASLABS_WORKER_PASSWORD)
const existingTerminal = await sql.query(
  `SELECT id FROM users
   WHERE requires_worker_pin=true OR LOWER(email) IN ('trabajadores@eslaboratorios.com','as@aslaboratorios.com')
   ORDER BY CASE WHEN LOWER(email)='as@aslaboratorios.com' THEN 0 ELSE 1 END,created_at
   LIMIT 1`,
)

if (existingTerminal[0]) {
  await sql.query(
    `UPDATE users SET email='as@aslaboratorios.com',full_name='Terminal de trabajadores',
       company='AS Laboratorios',initials='AS',password_hash=$2,role_id=$3,status='active',
       requires_worker_pin=true,updated_at=NOW() WHERE id=$1`,
    [existingTerminal[0].id, workerHash, role['laboratory-worker']],
  )
  await sql.query(
    `UPDATE users SET status='inactive',requires_worker_pin=false,updated_at=NOW()
     WHERE id<>$1 AND (requires_worker_pin=true OR LOWER(email)='trabajadores@eslaboratorios.com')`,
    [existingTerminal[0].id],
  )
} else {
  await sql.query(
    `INSERT INTO users (email,full_name,company,initials,password_hash,role_id,status,requires_worker_pin)
     VALUES ('as@aslaboratorios.com','Terminal de trabajadores','AS Laboratorios','AS',$1,$2,'active',true)`,
    [workerHash, role['laboratory-worker']],
  )
}

const luisHash = await hashSecret(process.env.ASLABS_LUIS_PASSWORD)
await sql.query(
  `INSERT INTO users (email,full_name,company,initials,password_hash,role_id,status,requires_worker_pin)
   VALUES ('luisg@aslaboratorios.com','Luis Guevara','AS Laboratorios','LG',$1,$2,'active',false)
   ON CONFLICT (email) DO UPDATE SET full_name=EXCLUDED.full_name,company=EXCLUDED.company,
     initials=EXCLUDED.initials,password_hash=EXCLUDED.password_hash,role_id=EXCLUDED.role_id,
     status='active',requires_worker_pin=false,updated_at=NOW()`,
  [luisHash, role.admin],
)

await sql.query(
  `UPDATE users SET role_id=$2,status='active',requires_worker_pin=false,updated_at=NOW()
   WHERE LOWER(email)=$1`,
  ['antoniog@aslaboratorios.com', role.admin],
)

const accounts = await sql.query(
  `SELECT u.email,u.full_name,r.slug AS role,u.status,u.requires_worker_pin
   FROM users u JOIN roles r ON r.id=u.role_id
   WHERE LOWER(u.email) IN ('as@aslaboratorios.com','luisg@aslaboratorios.com','antoniog@aslaboratorios.com')
   ORDER BY u.email`,
)
console.log(JSON.stringify({ configured: accounts }, null, 2))
