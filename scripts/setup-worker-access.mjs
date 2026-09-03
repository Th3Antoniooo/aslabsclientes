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

async function verifySecret(secret, stored) {
  const [, salt, expectedHex] = String(stored || '').split('$')
  if (!salt || !expectedHex) return false
  const actual = Buffer.from(await scrypt(secret, salt, 64))
  const expected = Buffer.from(expectedHex, 'hex')
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

await loadLocalEnv()
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no está disponible')
if (!process.env.ASLABS_WORKER_PASSWORD) throw new Error('Define ASLABS_WORKER_PASSWORD para configurar la cuenta compartida')

const sql = neon(process.env.DATABASE_URL)
const roles = await sql.query(`SELECT id FROM roles WHERE slug='laboratory-worker'`)
if (!roles[0]) throw new Error('Ejecuta primero scripts/migrate-db.mjs')
const admins = await sql.query(`SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.slug='admin' AND u.status='active' ORDER BY u.created_at LIMIT 1`)
if (!admins[0]) throw new Error('No hay un administrador activo para registrar trabajadores')

const passwordHash = await hashSecret(process.env.ASLABS_WORKER_PASSWORD)
await sql.query(
  `INSERT INTO users (email,full_name,company,initials,password_hash,role_id,status,requires_worker_pin)
   VALUES (LOWER($1),'Terminal de trabajadores','AS Laboratorios','TL',$2,$3,'active',true)
   ON CONFLICT (email) DO UPDATE SET
     full_name=EXCLUDED.full_name,company=EXCLUDED.company,initials=EXCLUDED.initials,
     password_hash=EXCLUDED.password_hash,role_id=EXCLUDED.role_id,status='active',
     requires_worker_pin=true,updated_at=NOW()`,
  ['as@aslaboratorios.com', passwordHash, roles[0].id],
)

const biotechnologyWorkers = ['Jurith Aguilar Pichen', 'Madeleine Isuiza Flores', 'Renzo T.', 'Rosa Cabanillas']
for (const fullName of biotechnologyWorkers) {
  await sql.query(
    `INSERT INTO analysts (full_name,specialty,biotechnology_access,status,created_by_user_id)
     SELECT $1,'Biotecnología vegetal',true,'active',$2
     WHERE NOT EXISTS (SELECT 1 FROM analysts WHERE LOWER(full_name)=LOWER($1))
     ON CONFLICT DO NOTHING`,
    [fullName, admins[0].id],
  )
  await sql.query(
    `UPDATE analysts SET biotechnology_access=true,specialty='Biotecnología vegetal',updated_at=NOW()
     WHERE LOWER(full_name)=LOWER($1)`,
    [fullName],
  )
}

const assigned = []
if (process.env.ASLABS_GENERATE_WORKER_PINS === '1') {
  const analysts = await sql.query(`SELECT id,full_name,pin_hash FROM analysts WHERE status='active' ORDER BY full_name`)
  const knownHashes = analysts.filter((item) => item.pin_hash).map((item) => item.pin_hash)
  const generated = new Set()
  for (const analyst of analysts) {
    if (analyst.pin_hash) continue
    let pin
    let available = false
    while (!available) {
      pin = String(crypto.randomInt(1000, 10000))
      available = !generated.has(pin)
      if (available) {
        for (const stored of knownHashes) {
          if (await verifySecret(pin, stored)) { available = false; break }
        }
      }
    }
    const pinHash = await hashSecret(pin)
    await sql.query(`UPDATE analysts SET pin_hash=$2,pin_configured_at=NOW(),updated_at=NOW() WHERE id=$1`, [analyst.id, pinHash])
    knownHashes.push(pinHash)
    generated.add(pin)
    assigned.push({ trabajador: analyst.full_name, pin })
  }
}

console.log(JSON.stringify({ account: 'as@aslaboratorios.com', pinsAssigned: assigned }, null, 2))
