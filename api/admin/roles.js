import { requireUser } from '../_lib/auth.js'
import { body, json, methodNotAllowed } from '../_lib/http.js'
import { query } from '../_lib/db.js'

export default async function handler(req, res) {
  const action = req.method === 'GET' ? 'view' : req.method === 'POST' ? 'create' : 'edit'
  const current = await requireUser(req, res, 'users', action)
  if (!current) return

  if (req.method === 'GET') {
    const roles = await query(
      `SELECT r.id, r.name, r.slug, r.description, r.is_system,
              COUNT(DISTINCT u.id)::int AS user_count,
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
       FROM roles r
       LEFT JOIN users u ON u.role_id = r.id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       GROUP BY r.id ORDER BY r.is_system DESC, r.name`,
    )
    const modules = await query('SELECT id, name, description FROM modules ORDER BY sort_order')
    return json(res, 200, { roles, modules })
  }

  const payload = await body(req)
  if (!payload.name) return json(res, 400, { error: 'Escribe un nombre para el rol.' })

  let role
  if (req.method === 'POST') {
    const slug = payload.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    const rows = await query(
      `INSERT INTO roles (name, slug, description, is_system)
       VALUES ($1, $2, $3, false) RETURNING *`,
      [payload.name.trim(), `${slug}-${Date.now().toString().slice(-5)}`, payload.description || 'Rol personalizado'],
    )
    role = rows[0]
  } else if (req.method === 'PATCH') {
    const rows = await query(
      `UPDATE roles SET name = $2, description = $3, updated_at = NOW()
       WHERE id = $1 AND slug <> 'admin' RETURNING *`,
      [payload.id, payload.name.trim(), payload.description || 'Rol personalizado'],
    )
    role = rows[0]
    if (!role) return json(res, 400, { error: 'El rol administrador no se puede modificar.' })
    await query('DELETE FROM role_permissions WHERE role_id = $1', [role.id])
  } else {
    return methodNotAllowed(res, ['GET', 'POST', 'PATCH'])
  }

  for (const [moduleId, permissions] of Object.entries(payload.permissions || {})) {
    await query(
      `INSERT INTO role_permissions
       (role_id, module_id, can_view, can_create, can_edit, can_delete)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [role.id, moduleId, !!permissions.view, !!permissions.create, !!permissions.edit, !!permissions.delete],
    )
  }
  return json(res, req.method === 'POST' ? 201 : 200, { role })
}

