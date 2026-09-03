import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { neon } from '@neondatabase/serverless'

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

await loadLocalEnv()
const workerName = process.env.ASLABS_TEST_WORKER_NAME
if (!workerName) throw new Error('Define ASLABS_TEST_WORKER_NAME')
const sql = neon(process.env.DATABASE_URL)
const accounts = await sql.query(`SELECT id FROM users WHERE LOWER(email)='as@aslaboratorios.com' AND status='active'`)
const analysts = await sql.query(`SELECT id,full_name FROM analysts WHERE LOWER(full_name)=LOWER($1) AND status='active'`, [workerName])
if (!accounts[0] || !analysts[0]) throw new Error('No se encontró la cuenta compartida o el analista')

const token = crypto.randomBytes(32).toString('base64url')
const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
let sessionId
try {
  const sessions = await sql.query(
    `INSERT INTO sessions (user_id,token_hash,expires_at) VALUES ($1,$2,NOW()+INTERVAL '10 minutes') RETURNING id`,
    [accounts[0].id, tokenHash],
  )
  sessionId = sessions[0].id
  await sql.query(`INSERT INTO laboratory_worker_sessions (session_id,analyst_id) VALUES ($1,$2)`, [sessionId, analysts[0].id])

  const headers = { Cookie: `aslabs_session=${token}` }
  const listResponse = await fetch('https://clientesaslabs.vercel.app/api/services?labOperations=2', { headers })
  const list = await listResponse.json()
  if (!listResponse.ok) throw new Error(`Listado: ${list.error || listResponse.status}`)
  const expected = await sql.query(
    `SELECT s.id,s.code FROM worker_service_assignments wsa
     JOIN service_requests s ON s.id=wsa.service_id
     WHERE wsa.analyst_id=$1 AND wsa.active=true AND s.archived_at IS NULL
       AND s.status IN ('accepted','in_progress','completed') ORDER BY s.code`,
    [analysts[0].id],
  )
  const actualCodes = (list.services || []).map((item) => item.code).sort()
  const expectedCodes = expected.map((item) => item.code).sort()
  if (JSON.stringify(actualCodes) !== JSON.stringify(expectedCodes)) throw new Error(`El filtro no coincide: ${actualCodes.join(', ')}`)

  const active = (list.services || []).find((item) => ['accepted','in_progress'].includes(item.status))
  if (!active) throw new Error('El analista no tiene una orden activa para verificar')
  const assignedResponse = await fetch(`https://clientesaslabs.vercel.app/api/service-workflow?serviceId=${active.id}`, { headers })
  if (!assignedResponse.ok) throw new Error(`La orden asignada no abrió: ${assignedResponse.status}`)
  const invalidMoveResponse = await fetch(`https://clientesaslabs.vercel.app/api/service-workflow?serviceId=${active.id}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'move', direction: 'validation-only-invalid' }),
  })
  if (invalidMoveResponse.status !== 400) throw new Error(`El permiso de avance respondió ${invalidMoveResponse.status}; se esperaba validación de movimiento`)

  const unassigned = await sql.query(
    `SELECT s.id,s.code FROM service_requests s
     WHERE s.archived_at IS NULL AND NOT EXISTS (
       SELECT 1 FROM worker_service_assignments wsa
       WHERE wsa.service_id=s.id AND wsa.analyst_id=$1 AND wsa.active=true
     ) LIMIT 1`,
    [analysts[0].id],
  )
  const blockedResponse = await fetch(`https://clientesaslabs.vercel.app/api/service-workflow?serviceId=${unassigned[0].id}`, { headers })
  if (blockedResponse.status !== 404) throw new Error(`Una orden ajena respondió ${blockedResponse.status} en vez de quedar oculta`)

  console.log(JSON.stringify({
    worker: analysts[0].full_name,
    visibleOrders: actualCodes,
    activeOrderOpened: active.code,
    stageMovementAuthorized: true,
    unassignedOrderHidden: unassigned[0].code,
  }, null, 2))
} finally {
  if (sessionId) await sql.query(`DELETE FROM sessions WHERE id=$1`, [sessionId])
}
