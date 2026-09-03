import { requireUser } from './_lib/auth.js'
import { body, json, methodNotAllowed } from './_lib/http.js'
import { query } from './_lib/db.js'

function validCoordinates(coordinates) {
  return Array.isArray(coordinates)
    && coordinates.length >= 3
    && coordinates.every((point) => (
      Array.isArray(point)
      && point.length === 2
      && Number.isFinite(Number(point[0]))
      && Number.isFinite(Number(point[1]))
    ))
}

export default async function handler(req, res) {
  const action = req.method === 'POST' ? 'create' : 'view'
  const user = await requireUser(req, res, 'zones', action)
  if (!user) return

  if (req.method === 'GET') {
    const zones = await query(
      `SELECT z.id, z.name, z.crop, z.area_ha, z.color, z.coordinates,
              z.created_at, u.id AS client_user_id, u.full_name AS client_name,
              u.company AS client_company
       FROM zones z
       JOIN users u ON u.id = z.client_user_id
       WHERE $1 = true OR z.client_user_id = $2
       ORDER BY z.created_at DESC`,
      [user.role === 'admin', user.id],
    )
    return json(res, 200, { zones })
  }

  if (req.method === 'POST') {
    const payload = await body(req)
    if (!payload.name?.trim() || !validCoordinates(payload.coordinates)) {
      return json(res, 400, { error: 'La zona necesita un nombre y al menos tres puntos válidos.' })
    }
    const clientUserId = user.role === 'admin' ? payload.clientUserId : user.id
    if (!clientUserId) return json(res, 400, { error: 'Selecciona el cliente propietario de la zona.' })

    const clients = await query(
      `SELECT u.id
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.status = 'active' AND r.slug <> 'admin'`,
      [clientUserId],
    )
    if (!clients[0]) return json(res, 404, { error: 'El cliente seleccionado no está disponible.' })

    const color = /^#[0-9a-f]{6}$/i.test(payload.color || '') ? payload.color : '#2f6b4f'
    const rows = await query(
      `INSERT INTO zones
       (client_user_id, created_by_user_id, name, crop, area_ha, color, coordinates)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       RETURNING id, client_user_id, name, crop, area_ha, color, coordinates, created_at`,
      [
        clientUserId,
        user.id,
        payload.name.trim(),
        payload.crop?.trim() || 'Por definir',
        Number.isFinite(Number(payload.areaHa)) ? Number(payload.areaHa) : null,
        color,
        JSON.stringify(payload.coordinates.map((point) => [Number(point[0]), Number(point[1])])),
      ],
    )
    await query(
      `INSERT INTO zone_backups (zone_id, snapshot, event, recorded_by_user_id)
       SELECT z.id, to_jsonb(z), 'created', $2
       FROM zones z WHERE z.id = $1`,
      [rows[0].id, user.id],
    )
    return json(res, 201, { zone: rows[0] })
  }

  return methodNotAllowed(res, ['GET', 'POST'])
}
