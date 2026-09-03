import { requireUser } from './_lib/auth.js'
import { json, methodNotAllowed } from './_lib/http.js'
import { query } from './_lib/db.js'
import biotechnologyHandler from './_lib/biotechnology-handler.js'

function stepDetail(stage) {
  if (stage.observations) return stage.observations
  if (stage.analyst) return `Analista: ${stage.analyst}`
  if (stage.performed_by) return `Responsable: ${stage.performed_by}`
  if (Number(stage.photo_count) > 0) {
    return `${stage.photo_count} evidencia${Number(stage.photo_count) === 1 ? '' : 's'} fotográfica${Number(stage.photo_count) === 1 ? '' : 's'}`
  }
  if (stage.status === 'completed') return 'Etapa completada y registrada'
  if (stage.status === 'current') return 'Etapa activa en el laboratorio'
  return 'Pendiente de iniciar'
}

export default async function handler(req, res) {
  if (req.query?.biotechnology === '1') return biotechnologyHandler(req, res)
  const user = await requireUser(req, res, 'dna', 'view')
  if (!user) return

  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])

  const orders = await query(
    `SELECT s.id, s.code,
            COALESCE(NULLIF(s.display_name, ''), s.service_type_name) AS service_type_name,
            s.quote_reference, s.zone_name,
            s.sample_count, s.priority, s.notes, s.status, s.requested_at,
            s.accepted_at, s.updated_at, s.current_stage_position,
            u.full_name AS client_name, u.company AS client_company,
            COUNT(ws.id)::int AS total_stages
     FROM service_requests s
     JOIN users u ON u.id = s.client_user_id
     LEFT JOIN service_workflow_stages ws ON ws.service_id = s.id
     WHERE (s.service_type_id = 'dna' OR LOWER(s.service_type_name) LIKE '%dna%')
       AND s.archived_at IS NULL
       AND s.status IN ('accepted', 'in_progress', 'completed')
       AND ($1 = true OR s.client_user_id = $2)
     GROUP BY s.id, u.full_name, u.company
     ORDER BY
       CASE s.status WHEN 'in_progress' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,
       s.updated_at DESC
     LIMIT 20`,
    [user.role === 'admin', user.id],
  )

  if (!orders[0]) return json(res, 200, { order: null, orders: [], steps: [] })

  const selectedId = req.query?.serviceId
  const order = orders.find((item) => item.id === selectedId) || orders[0]
  const rawSteps = await query(
    `SELECT ws.id, ws.stage_key, ws.position, ws.title, ws.status,
            ws.performed_by, ws.analyst, ws.observations, ws.started_at,
            ws.completed_at, ws.updated_at,
            COUNT(p.id)::int AS photo_count
     FROM service_workflow_stages ws
     LEFT JOIN service_stage_photos p ON p.stage_id = ws.id
     WHERE ws.service_id = $1
     GROUP BY ws.id
     ORDER BY ws.position`,
    [order.id],
  )

  const steps = rawSteps.map((stage) => ({
    id: stage.id,
    key: stage.stage_key,
    position: stage.position,
    title: stage.title,
    state: order.status === 'completed'
      ? 'done'
      : stage.status === 'completed'
        ? 'done'
        : stage.status === 'current'
          ? 'current'
          : 'pending',
    detail: stepDetail(stage),
    performedBy: stage.performed_by,
    analyst: stage.analyst,
    observations: stage.observations,
    startedAt: stage.started_at,
    completedAt: stage.completed_at,
    updatedAt: stage.updated_at,
    photoCount: stage.photo_count,
  }))

  return json(res, 200, {
    order,
    orders: orders.map((item) => ({
      id: item.id,
      code: item.code,
      status: item.status,
      clientName: item.client_name,
      clientCompany: item.client_company,
    })),
    steps,
  })
}
