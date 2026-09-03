import crypto from 'node:crypto'
import { promisify } from 'node:util'
import { query } from './db.js'

const scrypt = promisify(crypto.scrypt)
const COOKIE_NAME = 'aslabs_session'
const SESSION_DAYS = 30
const PIN_ATTEMPT_LIMIT = 5
const PIN_LOCK_MINUTES = 1

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const derived = await scrypt(password, salt, 64)
  return `scrypt$${salt}$${Buffer.from(derived).toString('hex')}`
}

export async function verifyPassword(password, stored) {
  const [algorithm, salt, expectedHex] = String(stored || '').split('$')
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false
  const actual = Buffer.from(await scrypt(password, salt, 64))
  const expected = Buffer.from(expectedHex, 'hex')
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

export function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
      const index = part.indexOf('=')
      return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))]
    }),
  )
}

export async function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url')
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  await query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '${SESSION_DAYS} days')`,
    [userId, tokenHash],
  )
  const secure = process.env.VERCEL ? '; Secure' : ''
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure}`,
  )
}

export async function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME]
  if (token) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    await query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash])
  }
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`)
}

async function sessionAccount(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME]
  if (!token) return null
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const rows = await query(
    `SELECT s.id AS session_id, s.pin_failed_attempts, s.pin_locked_until,
            u.id, u.email, u.dni, u.full_name, u.company, u.initials, u.status, u.requires_worker_pin,
            r.id AS role_id, r.slug AS role_slug, r.name AS role_name,
            COALESCE(perms.permissions, '{}'::jsonb) AS permissions,
            a.id AS active_worker_id, a.full_name AS active_worker_name,
            a.specialty AS active_worker_specialty,
            a.biotechnology_access AS active_worker_biotechnology_access,
            a.can_create_biotechnology_codes AS active_worker_can_create_biotechnology_codes,
            a.can_use_equipment AS active_worker_can_use_equipment,
            a.code_creator_only AS active_worker_code_creator_only
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN LATERAL (
       SELECT jsonb_object_agg(
         rp.module_id,
         jsonb_build_object('view',rp.can_view,'create',rp.can_create,'edit',rp.can_edit,'delete',rp.can_delete)
       ) AS permissions
       FROM role_permissions rp WHERE rp.role_id = r.id
     ) perms ON true
     LEFT JOIN laboratory_worker_sessions lws ON lws.session_id = s.id
     LEFT JOIN analysts a ON a.id = lws.analyst_id AND a.status = 'active'
     WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.status = 'active'
     LIMIT 1`,
    [tokenHash],
  )
  return rows[0] || null
}

export async function getUser(req) {
  const row = await sessionAccount(req)
  return row ? serializeUser(row) : null
}

export async function unlockWorkerSession(req, pin) {
  const account = await sessionAccount(req)
  if (!account) throw Object.assign(new Error('La cuenta compartida ya no está activa.'), { status: 401 })
  if (!account.requires_worker_pin) throw Object.assign(new Error('Esta cuenta no utiliza acceso por PIN.'), { status: 400 })
  if (!/^\d{4}$/.test(String(pin || ''))) throw Object.assign(new Error('El PIN debe tener exactamente 4 dígitos.'), { status: 400 })
  if (account.pin_locked_until && new Date(account.pin_locked_until) > new Date()) {
    throw Object.assign(new Error('Demasiados intentos. Espera un minuto y vuelve a intentarlo.'), { status: 429 })
  }

  const analysts = await query(
    `SELECT id, pin_hash FROM analysts WHERE status = 'active' AND pin_hash IS NOT NULL ORDER BY full_name`,
  )
  let matched = null
  for (const analyst of analysts) {
    if (await verifyPassword(String(pin), analyst.pin_hash)) {
      matched = analyst
      break
    }
  }

  if (!matched) {
    const failed = Number(account.pin_failed_attempts || 0) + 1
    await query(
      `UPDATE sessions
       SET pin_failed_attempts = CASE WHEN $2 >= $3 THEN 0 ELSE $2 END,
           pin_locked_until = CASE WHEN $2 >= $3 THEN NOW() + ($4 * INTERVAL '1 minute') ELSE NULL END
       WHERE id = $1`,
      [account.session_id, failed, PIN_ATTEMPT_LIMIT, PIN_LOCK_MINUTES],
    )
    const remaining = Math.max(0, PIN_ATTEMPT_LIMIT - failed)
    throw Object.assign(new Error(remaining ? `PIN incorrecto. Quedan ${remaining} intentos.` : 'Demasiados intentos. Espera un minuto y vuelve a intentarlo.'), { status: remaining ? 401 : 429 })
  }

  await query(
    `INSERT INTO laboratory_worker_sessions (session_id, analyst_id, activated_at, last_activity_at)
     VALUES ($1,$2,NOW(),NOW())
     ON CONFLICT (session_id) DO UPDATE
     SET analyst_id=EXCLUDED.analyst_id, activated_at=NOW(), last_activity_at=NOW()`,
    [account.session_id, matched.id],
  )
  await query(`UPDATE sessions SET pin_failed_attempts=0,pin_locked_until=NULL WHERE id=$1`, [account.session_id])
  await query(`UPDATE analysts SET pin_last_used_at=NOW() WHERE id=$1`, [matched.id])
  return getUser(req)
}

export async function lockWorkerSession(req) {
  const account = await sessionAccount(req)
  if (!account) return null
  await query(`DELETE FROM laboratory_worker_sessions WHERE session_id=$1`, [account.session_id])
  return getUser(req)
}

export function serializeUser(row) {
  const workerInitials = row.active_worker_name
    ? row.active_worker_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
    : null
  return {
    id: row.id,
    email: row.email,
    dni: row.dni,
    nombre: row.full_name,
    empresa: row.company,
    iniciales: row.initials,
    role: row.role_slug,
    roleId: row.role_id,
    roleName: row.role_name,
    status: row.status,
    permissions: row.permissions || {},
    requiresWorkerPin: Boolean(row.requires_worker_pin),
    activeWorker: row.active_worker_id ? {
      id: row.active_worker_id,
      fullName: row.active_worker_name,
      initials: workerInitials,
      specialty: row.active_worker_specialty,
      biotechnologyAccess: Boolean(row.active_worker_biotechnology_access),
      canCreateBiotechnologyCodes: Boolean(row.active_worker_can_create_biotechnology_codes),
      canUseEquipment: Boolean(row.active_worker_can_use_equipment),
      codeCreatorOnly: Boolean(row.active_worker_code_creator_only),
    } : null,
  }
}

export function can(user, moduleId, action = 'view') {
  return user?.role === 'admin' || Boolean(user?.permissions?.[moduleId]?.[action])
}

export async function requireUser(req, res, moduleId, action = 'view') {
  const user = await getUser(req)
  if (!user) {
    res.status(401).json({ error: 'Sesión no válida' })
    return null
  }
  if (user.requiresWorkerPin && !user.activeWorker) {
    res.status(423).json({ error: 'Ingresa tu PIN de trabajador para continuar.' })
    return null
  }
  if (user.activeWorker?.codeCreatorOnly && moduleId && !['biotechnology', 'lab_operations'].includes(moduleId)) {
    res.status(403).json({ error: 'Este PIN solo permite crear códigos de Biotecnología y utilizar equipos.' })
    return null
  }
  if (moduleId && !can(user, moduleId, action)) {
    res.status(403).json({ error: 'No tienes permiso para realizar esta acción' })
    return null
  }
  if (user.requiresWorkerPin) {
    const account = await sessionAccount(req)
    if (account) await query(`UPDATE laboratory_worker_sessions SET last_activity_at=NOW() WHERE session_id=$1`, [account.session_id])
  }
  return user
}
