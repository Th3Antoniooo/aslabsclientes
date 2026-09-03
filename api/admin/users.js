import { hashPassword, requireUser } from '../_lib/auth.js'
import { body, json, methodNotAllowed } from '../_lib/http.js'
import { query } from '../_lib/db.js'
import adminDocumentsHandler from '../_lib/admin-documents-handler.js'

export default async function handler(req, res) {
  if (req.query?.documents === '1') return adminDocumentsHandler(req, res)
  const action = req.method === 'GET' ? 'view' : req.method === 'POST' ? 'create' : 'edit'
  const current = await requireUser(req, res, 'users', action)
  if (!current) return

  if (req.method === 'GET') {
    const users = await query(
      `SELECT u.id, u.email, u.dni, u.full_name, u.company, u.initials, u.status,
              u.last_login_at, u.created_at, r.id AS role_id, r.name AS role_name, r.slug AS role_slug
       FROM users u JOIN roles r ON r.id = u.role_id
       ORDER BY u.created_at DESC`,
    )
    return json(res, 200, { users })
  }

  if (req.method === 'POST') {
    const payload = await body(req)
    const email = String(payload.email || '').trim().toLowerCase()
    const dni = String(payload.dni || '').trim()
    if (!email && !dni) return json(res, 400, { error: 'Ingresa un correo electrónico, un DNI o ambos.' })
    if (!payload.fullName || !payload.roleId || !payload.password) {
      return json(res, 400, { error: 'Completa los campos obligatorios y asigna una contraseña.' })
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: 'El correo electrónico no es válido.' })
    if (dni && !/^\d{8}$/.test(dni)) return json(res, 400, { error: 'El DNI debe tener exactamente 8 dígitos.' })
    const passwordHash = await hashPassword(payload.password)
    const initials = payload.initials || payload.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
    try {
      const rows = await query(
        `INSERT INTO users (email, dni, full_name, company, initials, password_hash, role_id, status)
         VALUES (NULLIF($1, ''), NULLIF($2, ''), $3, $4, $5, $6, $7, 'active')
         RETURNING id, email, dni, full_name, company, initials, status, role_id, created_at`,
        [email, dni, payload.fullName.trim(), payload.company || 'AS Laboratorios', initials, passwordHash, payload.roleId],
      )
      await query(
        `INSERT INTO notifications (user_id, title, body, type, priority, audience)
         VALUES ($1, 'Cuenta activada', 'Tu acceso al portal de AS Labs ya está disponible.', 'account', 'normal', 'all')`,
        [rows[0].id],
      )
      return json(res, 201, { user: rows[0] })
    } catch (error) {
      if (error.code === '23505') return json(res, 409, { error: 'Ya existe un usuario con ese correo o DNI.' })
      throw error
    }
  }

  if (req.method === 'PATCH') {
    const payload = await body(req)
    if (!payload.id) return json(res, 400, { error: 'Falta el usuario.' })
    if (payload.id === current.id && (payload.status === 'inactive' || payload.roleId)) {
      return json(res, 400, { error: 'No puedes retirar tus propios permisos de administrador.' })
    }
    const rows = await query(
      `UPDATE users
       SET full_name = COALESCE($2, full_name),
           company = COALESCE($3, company),
           role_id = COALESCE($4, role_id),
           status = COALESCE($5, status),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, email, dni, full_name, company, initials, status, role_id`,
      [payload.id, payload.fullName || null, payload.company || null, payload.roleId || null, payload.status || null],
    )
    return rows[0] ? json(res, 200, { user: rows[0] }) : json(res, 404, { error: 'Usuario no encontrado.' })
  }

  return methodNotAllowed(res, ['GET', 'POST', 'PATCH'])
}
