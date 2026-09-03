import { requireUser } from './_lib/auth.js'
import { body, json, methodNotAllowed } from './_lib/http.js'
import { query } from './_lib/db.js'

const CREW_STATES = ['available', 'at_laboratory', 'en_route', 'sampling', 'applying', 'returning', 'paused']
const ASSIGNMENT_TYPES = ['sampling', 'application', 'logistics', 'laboratory']
const ASSIGNMENT_STATUSES = ['planned', 'en_route', 'on_site', 'completed', 'paused']

function initials(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

function numberOrNull(value) {
  if (value === '' || value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

async function trackingPayload(user) {
  const canSeeAll = user.role === 'admin' || user.role === 'field-operator'
  const sites = await query(
    `SELECT fs.id, fs.name, fs.site_type, fs.client_user_id, fs.address,
            fs.lat, fs.lng, fs.active, u.full_name AS client_name
     FROM field_sites fs
     LEFT JOIN users u ON u.id = fs.client_user_id
     WHERE fs.active = true
       AND ($1 = true OR fs.site_type = 'laboratory' OR fs.client_user_id = $2)
     ORDER BY CASE WHEN fs.site_type = 'laboratory' THEN 0 ELSE 1 END, fs.name`,
    [canSeeAll, user.id],
  )

  const crews = await query(
    `SELECT c.id, c.name, c.operational_state, c.status_text,
            COALESCE((SELECT ROUND(AVG(ca_progress.progress))::int FROM crew_service_assignments ca_progress WHERE ca_progress.crew_id=c.id),c.progress) AS progress,
            c.home_laboratory_site_id, c.current_site_id, c.current_lat, c.current_lng,
            c.accuracy_m, c.last_seen_at, c.active,
            home.name AS home_laboratory_name, current_site.name AS current_site_name,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', m.id, 'fullName', m.full_name, 'initials', m.initials,
                'roleTitle', COALESCE(cm.role, m.role_title), 'phone', m.phone
              ) ORDER BY m.full_name)
              FROM crew_memberships cm
              JOIN crew_members m ON m.id = cm.member_id
              WHERE cm.crew_id = c.id AND cm.active = true AND m.status = 'active'
            ), '[]'::jsonb) AS members,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', a.id, 'serviceId', s.id, 'code', s.code,
                'serviceName', COALESCE(NULLIF(s.display_name, ''), s.service_type_name),
                'categoryName', s.service_category_name,
                'assignmentType', a.assignment_type, 'status', a.status, 'progress', a.progress,
                'scheduledAt', a.scheduled_at, 'notes', a.notes,
                'currentStage', ws.title, 'clientName', u.full_name,
                'samplingSite', sample_site.name
              ) ORDER BY COALESCE(a.scheduled_at, a.created_at) DESC)
              FROM crew_service_assignments a
              JOIN service_requests s ON s.id = a.service_id
              JOIN users u ON u.id = s.client_user_id
              LEFT JOIN service_workflow_stages ws
                ON ws.service_id = s.id AND ws.position = s.current_stage_position
              LEFT JOIN field_sites sample_site ON sample_site.id = s.sampling_site_id
              WHERE a.crew_id = c.id AND s.archived_at IS NULL AND ($1 = true OR s.client_user_id = $2)
            ), '[]'::jsonb) AS assignments
     FROM field_crews c
     LEFT JOIN field_sites home ON home.id = c.home_laboratory_site_id
     LEFT JOIN field_sites current_site ON current_site.id = c.current_site_id
     WHERE c.active = true
       AND ($1 = true OR EXISTS (
         SELECT 1 FROM crew_service_assignments ca
         JOIN service_requests sr ON sr.id = ca.service_id
         WHERE ca.crew_id = c.id AND sr.archived_at IS NULL AND sr.client_user_id = $2
       ))
     ORDER BY c.last_seen_at DESC, c.name`,
    [canSeeAll, user.id],
  )

  const members = canSeeAll
    ? await query(
      `SELECT id, full_name, initials, role_title, phone, status
       FROM crew_members WHERE status = 'active' ORDER BY full_name`,
    )
    : []

  const services = canSeeAll
    ? await query(
      `SELECT s.id, s.code,
              COALESCE(NULLIF(s.display_name, ''), s.service_type_name) AS service_type_name,
              s.service_category_name, s.status,
              s.zone_name, s.sampling_site_id, u.full_name AS client_name,
              ws.title AS current_stage_title
       FROM service_requests s
       JOIN users u ON u.id = s.client_user_id
       LEFT JOIN service_workflow_stages ws
         ON ws.service_id = s.id AND ws.position = s.current_stage_position
       WHERE s.status IN ('accepted', 'in_progress') AND s.archived_at IS NULL
       ORDER BY s.updated_at DESC`,
    )
    : []

  return { crews, sites, members, services }
}

export default async function handler(req, res) {
  const permission = req.method === 'GET' ? 'view' : 'edit'
  const user = await requireUser(req, res, 'tracking', permission)
  if (!user) return

  if (req.method === 'GET') {
    return json(res, 200, await trackingPayload(user))
  }

  if (req.method !== 'POST') return methodNotAllowed(res, ['GET', 'POST'])
  if (user.role !== 'admin') {
    return json(res, 403, { error: 'Solo un administrador puede gestionar sedes y cuadrillas.' })
  }

  const payload = await body(req)

  if (payload.action === 'create_site') {
    const lat = numberOrNull(payload.lat)
    const lng = numberOrNull(payload.lng)
    if (!payload.name?.trim() || !['laboratory', 'sampling'].includes(payload.siteType) || lat == null || lng == null) {
      return json(res, 400, { error: 'Indica nombre, tipo y coordenadas válidas para la sede.' })
    }
    if (payload.siteType === 'sampling' && !payload.clientUserId) {
      return json(res, 400, { error: 'Selecciona el cliente de la sede de muestreo.' })
    }
    const rows = await query(
      `INSERT INTO field_sites
       (name, site_type, client_user_id, address, lat, lng, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        payload.name.trim(),
        payload.siteType,
        payload.siteType === 'sampling' ? payload.clientUserId : null,
        payload.address?.trim() || null,
        lat,
        lng,
        user.id,
      ],
    )
    return json(res, 201, { site: rows[0], ...(await trackingPayload(user)) })
  }

  if (payload.action === 'create_member') {
    if (!payload.fullName?.trim()) return json(res, 400, { error: 'Escribe el nombre del integrante.' })
    const rows = await query(
      `INSERT INTO crew_members
       (full_name, initials, role_title, phone, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [
        payload.fullName.trim(),
        initials(payload.fullName) || 'EQ',
        payload.roleTitle?.trim() || null,
        payload.phone?.trim() || null,
        user.id,
      ],
    )
    return json(res, 201, { member: rows[0], ...(await trackingPayload(user)) })
  }

  if (payload.action === 'create_crew') {
    if (!payload.name?.trim()) return json(res, 400, { error: 'Escribe el nombre de la cuadrilla.' })
    if (!payload.homeSiteId) return json(res, 400, { error: 'Selecciona la sede base del laboratorio.' })
    const sites = await query(
      `SELECT id, lat, lng FROM field_sites
       WHERE id = $1 AND site_type = 'laboratory' AND active = true`,
      [payload.homeSiteId],
    )
    const home = sites[0]
    if (!home) return json(res, 400, { error: 'La sede del laboratorio no es válida.' })
    const rows = await query(
      `INSERT INTO field_crews
       (name, operational_state, status_text, home_laboratory_site_id, current_site_id,
        current_lat, current_lng, created_by_user_id)
       VALUES ($1,$2,$3,$4,$4,$5,$6,$7) RETURNING *`,
      [
        payload.name.trim(),
        'at_laboratory',
        'En sede del laboratorio',
        home.id,
        home.lat,
        home.lng,
        user.id,
      ],
    )
    return json(res, 201, { crew: rows[0], ...(await trackingPayload(user)) })
  }

  if (payload.action === 'assign_member') {
    if (!payload.crewId || !payload.memberId) return json(res, 400, { error: 'Selecciona cuadrilla e integrante.' })
    await query(
      `INSERT INTO crew_memberships (crew_id, member_id, role, active)
       VALUES ($1,$2,$3,true)
       ON CONFLICT (crew_id, member_id) DO UPDATE SET
         role = EXCLUDED.role, active = true, assigned_at = NOW()`,
      [payload.crewId, payload.memberId, payload.role?.trim() || null],
    )
    return json(res, 200, await trackingPayload(user))
  }

  if (payload.action === 'assign_service') {
    const assignmentType = ASSIGNMENT_TYPES.includes(payload.assignmentType) ? payload.assignmentType : 'sampling'
    if (!payload.crewId || !payload.serviceId) return json(res, 400, { error: 'Selecciona cuadrilla y servicio.' })
    const services = await query(
      `SELECT id, client_user_id,
              COALESCE(NULLIF(display_name, ''), service_type_name) AS service_type_name
       FROM service_requests
       WHERE id = $1 AND archived_at IS NULL AND status IN ('accepted', 'in_progress')`,
      [payload.serviceId],
    )
    if (!services[0]) return json(res, 400, { error: 'El servicio debe estar aceptado para asignar una cuadrilla.' })
    const crews = await query(
      `SELECT c.id, c.operational_state, c.current_lat, c.current_lng,
              h.id AS home_id, h.lat AS home_lat, h.lng AS home_lng
       FROM field_crews c LEFT JOIN field_sites h ON h.id = c.home_laboratory_site_id
       WHERE c.id = $1 AND c.active = true`,
      [payload.crewId],
    )
    if (!crews[0]) return json(res, 400, { error: 'La cuadrilla no está disponible.' })
    await query(
      `INSERT INTO crew_service_assignments
       (crew_id, service_id, assignment_type, status, scheduled_at, notes, assigned_by_user_id)
       VALUES ($1,$2,$3,'planned',$4,$5,$6)
       ON CONFLICT (crew_id, service_id, assignment_type) DO UPDATE SET
         scheduled_at = EXCLUDED.scheduled_at,
         notes = EXCLUDED.notes,
         progress = CASE WHEN crew_service_assignments.status = 'completed' THEN 0 ELSE crew_service_assignments.progress END,
         status = CASE WHEN crew_service_assignments.status = 'completed' THEN 'planned' ELSE crew_service_assignments.status END,
         assigned_by_user_id = EXCLUDED.assigned_by_user_id,
         updated_at = NOW()`,
      [
        payload.crewId,
        payload.serviceId,
        assignmentType,
        payload.scheduledAt || null,
        payload.notes?.trim() || null,
        user.id,
      ],
    )
    const crew = crews[0]
    if (crew.home_id && ['available', 'at_laboratory'].includes(crew.operational_state)) {
      await query(
        `UPDATE field_crews SET operational_state = 'at_laboratory',
         status_text = 'Preparándose en sede del laboratorio',
         current_site_id = $2, current_lat = $3, current_lng = $4,
         last_seen_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [payload.crewId, crew.home_id, crew.home_lat, crew.home_lng],
      )
    }
    await query(
      `INSERT INTO notifications (user_id, title, body, type, priority, audience, action_url)
       VALUES ($1, 'Cuadrilla asignada', $2, 'tracking', 'normal', 'client', 'tracking')`,
      [services[0].client_user_id, `${services[0].service_type_name} ya tiene equipo de campo asignado.`],
    )
    return json(res, 200, await trackingPayload(user))
  }

  if (payload.action === 'update_crew') {
    if (!payload.crewId) return json(res, 400, { error: 'Selecciona una cuadrilla.' })
    const state = CREW_STATES.includes(payload.operationalState) ? payload.operationalState : null
    const assignmentStatus = ASSIGNMENT_STATUSES.includes(payload.assignmentStatus) ? payload.assignmentStatus : null
    let lat = numberOrNull(payload.lat)
    let lng = numberOrNull(payload.lng)
    if (payload.currentSiteId) {
      const sites = await query('SELECT lat, lng FROM field_sites WHERE id = $1 AND active = true', [payload.currentSiteId])
      if (!sites[0]) return json(res, 400, { error: 'La sede seleccionada no existe.' })
      if (lat == null) lat = sites[0].lat
      if (lng == null) lng = sites[0].lng
    }
    if ((lat == null) !== (lng == null)) return json(res, 400, { error: 'Completa ambas coordenadas.' })
    const progress = payload.progress == null ? null : Math.max(0, Math.min(100, Number(payload.progress)))
    await query(
      `UPDATE field_crews SET
         operational_state = COALESCE($2, operational_state),
         status_text = CASE WHEN $3 = '' THEN NULL ELSE COALESCE($3, status_text) END,
         progress = COALESCE($4, progress),
         current_site_id = COALESCE(NULLIF($5, '')::uuid, current_site_id),
         current_lat = COALESCE($6, current_lat),
         current_lng = COALESCE($7, current_lng),
         accuracy_m = COALESCE($8, accuracy_m),
         last_seen_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [
        payload.crewId,
        state,
        payload.statusText == null ? null : payload.statusText.trim(),
        Number.isFinite(progress) ? progress : null,
        payload.currentSiteId == null ? null : payload.currentSiteId,
        lat,
        lng,
        numberOrNull(payload.accuracy),
      ],
    )
    if (lat != null && lng != null) {
      await query(
        `INSERT INTO crew_location_updates (crew_id, lat, lng, accuracy_m, updated_by_user_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [payload.crewId, lat, lng, numberOrNull(payload.accuracy), user.id],
      )
    }
    if (payload.assignmentId && (assignmentStatus || payload.assignmentProgress != null)) {
      const assignmentProgress = payload.assignmentProgress == null ? null : Math.max(0,Math.min(100,Number(payload.assignmentProgress)))
      await query(
        `UPDATE crew_service_assignments
         SET status = COALESCE($3,status),progress=COALESCE($4,progress),updated_at = NOW()
         WHERE id = $1 AND crew_id = $2`,
        [payload.assignmentId, payload.crewId, assignmentStatus,Number.isFinite(assignmentProgress) ? assignmentProgress : null],
      )
    }
    return json(res, 200, await trackingPayload(user))
  }

  return json(res, 400, { error: 'La acción de cuadrillas no es válida.' })
}
