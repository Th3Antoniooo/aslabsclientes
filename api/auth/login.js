import { body, json, methodNotAllowed } from '../_lib/http.js'
import {
  createSession,
  destroySession,
  lockWorkerSession,
  serializeUser,
  unlockWorkerSession,
  verifyPassword,
} from '../_lib/auth.js'
import { query } from '../_lib/db.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])

  try {
    const payload = await body(req)
    if (payload.action === 'logout') {
      await destroySession(req, res)
      return json(res, 200, { ok: true })
    }
    if (payload.action === 'lock_worker') {
      const user = await lockWorkerSession(req)
      return user ? json(res, 200, { ok: true, user }) : json(res, 401, { error: 'Sesión no válida' })
    }
    if (payload.action === 'unlock_worker') {
      const user = await unlockWorkerSession(req, payload.pin)
      return json(res, 200, { user })
    }
    const identifier = String(payload.identifier || payload.email || '').trim()
    const { password = '' } = payload
    const rows = await query(
      `SELECT u.*, r.slug AS role_slug, r.name AS role_name,
              COALESCE(
                jsonb_object_agg(
                  rp.module_id,
                  jsonb_build_object(
                    'view', rp.can_view,
                    'create', rp.can_create,
                    'edit', rp.can_edit,
                    'delete', rp.can_delete
                  )
                ) FILTER (WHERE rp.module_id IS NOT NULL),
                '{}'::jsonb
              ) AS permissions
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       WHERE LOWER(u.email) = LOWER($1) OR u.dni = $1
       GROUP BY u.id, r.id`,
      [identifier],
    )
    const account = rows[0]
    if (!account || account.status !== 'active' || !(await verifyPassword(password, account.password_hash))) {
      return json(res, 401, { error: 'El usuario o la contraseña no son correctos.' })
    }

    await createSession(res, account.id)
    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [account.id])
    return json(res, 200, { user: serializeUser(account) })
  } catch (error) {
    console.error(error)
    return json(res, error.status || 500, { error: error.status ? error.message : 'No fue posible iniciar sesión.' })
  }
}
