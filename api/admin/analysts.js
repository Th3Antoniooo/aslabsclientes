import { hashPassword, requireUser, verifyPassword } from '../_lib/auth.js'
import { body, json, methodNotAllowed } from '../_lib/http.js'
import { query } from '../_lib/db.js'

function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function validPin(value) { return /^\d{4}$/.test(String(value || '')) }

async function ensureUniquePin(pin, excludedId = null) {
  const rows = await query(
    `SELECT id,pin_hash FROM analysts WHERE pin_hash IS NOT NULL AND ($1::uuid IS NULL OR id<>$1)`,
    [excludedId],
  )
  for (const analyst of rows) {
    if (await verifyPassword(pin, analyst.pin_hash)) {
      throw Object.assign(new Error('Ese PIN ya pertenece a otro trabajador. Elige uno diferente.'), { status: 409 })
    }
  }
}

export default async function handler(req, res) {
  const action = req.method === 'GET' ? 'view' : req.method === 'POST' ? 'create' : 'edit'
  const user = await requireUser(req, res, 'analysts', action)
  if (!user) return

  if (req.method === 'GET') {
    const analysts = await query(
      `SELECT a.id, a.full_name, a.email, a.specialty, a.license_number, a.status,
              a.biotechnology_access, a.can_create_biotechnology_codes,
              a.can_use_equipment, a.code_creator_only,
              (a.pin_hash IS NOT NULL) AS has_pin, a.pin_configured_at, a.pin_last_used_at,
              a.created_at, a.updated_at, u.full_name AS created_by
       FROM analysts a
       JOIN users u ON u.id = a.created_by_user_id
       ORDER BY (a.status = 'active') DESC, a.full_name`,
    )
    return json(res, 200, { analysts })
  }

  if (req.method === 'POST') {
    const payload = await body(req)
    if (!clean(payload.fullName)) return json(res, 400, { error: 'Escribe el nombre completo del analista.' })
    if (!validPin(payload.pin)) return json(res, 400, { error: 'Asigna un PIN único de exactamente 4 dígitos.' })
    try {
      await ensureUniquePin(String(payload.pin))
      const pinHash = await hashPassword(String(payload.pin))
      const rows = await query(
        `INSERT INTO analysts
         (full_name, email, specialty, license_number, pin_hash, pin_configured_at, status, created_by_user_id)
         VALUES ($1, LOWER($2), $3, $4, $5, NOW(), 'active', $6)
         RETURNING id,full_name,email,specialty,license_number,status,true AS has_pin,pin_configured_at,pin_last_used_at`,
        [clean(payload.fullName), clean(payload.email), clean(payload.specialty), clean(payload.licenseNumber), pinHash, user.id],
      )
      return json(res, 201, { analyst: rows[0] })
    } catch (error) {
      if (error.status) return json(res, error.status, { error: error.message })
      if (error.code === '23505') return json(res, 409, { error: 'Ya existe un analista con ese correo.' })
      throw error
    }
  }

  if (req.method === 'PATCH') {
    const payload = await body(req)
    if (!payload.id) return json(res, 400, { error: 'Falta el analista.' })
    try {
      let pinHash = null
      if (Object.hasOwn(payload, 'pin') && payload.pin) {
        if (!validPin(payload.pin)) return json(res, 400, { error: 'El PIN debe tener exactamente 4 dígitos.' })
        await ensureUniquePin(String(payload.pin), payload.id)
        pinHash = await hashPassword(String(payload.pin))
      }
      const rows = await query(
        `UPDATE analysts
         SET full_name = CASE WHEN $2 THEN $3 ELSE full_name END,
             email = CASE WHEN $4 THEN LOWER($5) ELSE email END,
             specialty = CASE WHEN $6 THEN $7 ELSE specialty END,
             license_number = CASE WHEN $8 THEN $9 ELSE license_number END,
             status = CASE WHEN $10 THEN $11 ELSE status END,
             pin_hash = CASE WHEN $12 THEN $13 ELSE pin_hash END,
             pin_configured_at = CASE WHEN $12 THEN NOW() ELSE pin_configured_at END,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id,full_name,email,specialty,license_number,status,
                   (pin_hash IS NOT NULL) AS has_pin,pin_configured_at,pin_last_used_at`,
        [
          payload.id,
          Object.hasOwn(payload, 'fullName'), clean(payload.fullName),
          Object.hasOwn(payload, 'email'), clean(payload.email),
          Object.hasOwn(payload, 'specialty'), clean(payload.specialty),
          Object.hasOwn(payload, 'licenseNumber'), clean(payload.licenseNumber),
          Object.hasOwn(payload, 'status'), payload.status || null,
          Boolean(pinHash), pinHash,
        ],
      )
      return rows[0] ? json(res, 200, { analyst: rows[0] }) : json(res, 404, { error: 'Analista no encontrado.' })
    } catch (error) {
      if (error.status) return json(res, error.status, { error: error.message })
      if (error.code === '23505') return json(res, 409, { error: 'Ya existe un analista con ese correo.' })
      if (error.code === '23514') return json(res, 400, { error: 'El estado del analista no es válido.' })
      throw error
    }
  }

  return methodNotAllowed(res, ['GET', 'POST', 'PATCH'])
}
