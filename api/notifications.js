import { can, getUser } from './_lib/auth.js'
import { body, json, methodNotAllowed } from './_lib/http.js'
import { query } from './_lib/db.js'

const WORKER_ACCOUNT = 'as@aslaboratorios.com'

async function refreshEmailDelivery(id) {
  if (!id || !process.env.RESEND_API_KEY) return
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id))) return
  const rows = await query(
    `SELECT id,provider_message_id,preview_html FROM email_deliveries WHERE id=$1`,
    [id],
  )
  const delivery = rows[0]
  if (!delivery?.provider_message_id) return
  const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(delivery.provider_message_id)}`, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
  })
  if (!response.ok) return
  const result = await response.json().catch(() => ({}))
  await query(
    `UPDATE email_deliveries
     SET provider_last_event=COALESCE($2,provider_last_event),
         preview_html=COALESCE(preview_html,$3),updated_at=NOW()
     WHERE id=$1`,
    [delivery.id,result.last_event || null,typeof result.html === 'string' ? result.html : null],
  )
}

async function emailDeliveryLog(refreshId = null) {
  if (refreshId) await refreshEmailDelivery(refreshId)
  const rows = await query(
    `SELECT d.id,d.event_type,d.recipient_email,d.subject,d.status,d.provider_last_event,
            d.provider_message_id,d.preview_html,d.error_message,d.attempts,d.created_at,d.sent_at,d.updated_at,
            s.code AS service_code,COALESCE(NULLIF(s.display_name,''),s.service_type_name) AS service_name,
            u.full_name AS client_name,u.company AS client_company
     FROM email_deliveries d
     LEFT JOIN service_requests s ON s.id=d.service_id
     LEFT JOIN users u ON u.id=d.client_user_id
     ORDER BY d.created_at DESC LIMIT 100`,
  )
  const stats = rows.reduce((result, item) => {
    const state = item.provider_last_event || item.status
    result.total += 1
    if (['delivered','opened','clicked'].includes(state)) result.delivered += 1
    else if (['bounced','complained','failed'].includes(state) || item.status === 'failed') result.failed += 1
    else if (item.status === 'skipped') result.skipped += 1
    else result.sent += 1
    return result
  }, { total:0,delivered:0,sent:0,failed:0,skipped:0 })
  return { deliveries:rows,stats }
}

function operationalNotification(row, kind) {
  if (kind === 'biotechnology') {
    const days = Math.max(21, Number(row.elapsed_days || 21))
    const stage = row.current_stage === 'multiplication'
      ? `Subcultivo ${Number(row.current_subculture) + 1}`
      : row.current_stage === 'rooting' ? 'Enraizamiento' : 'Introducción'
    return {
      id: `operational:biotechnology:${row.id}:${row.current_stage}:${row.current_subculture}`,
      alert_key: `biotechnology:${row.id}:${row.current_stage}:${row.current_subculture}`,
      title: `Etapa vencida · ${row.code}`,
      body: `${stage} lleva ${days} días. El máximo recomendado es 20 días.`,
      type: 'deadline', priority: 'high', action_url: 'biotechnology', read_at: null,
      created_at: row.current_stage_started_on, operational: true, critical: false,
    }
  }
  if (kind === 'incubation') {
    const minutes = Math.max(1, Math.floor((Date.now() - new Date(row.expected_end_at).getTime()) / 60000))
    return {
      id: `operational:incubation:${row.id}`,
      alert_key: `incubation:${row.id}`,
      title: `Tiempo de incubación excedido · ${row.equipment_code}`,
      body: `${row.service_codes || 'Orden vinculada'} · ${row.material_description} · ${minutes} min fuera de tiempo.`,
      type: 'incubation', priority: 'high', action_url: 'dashboard', read_at: null,
      created_at: row.expected_end_at, operational: true, critical: true,
    }
  }
  const dueAt = new Date(row.analysis_due_at)
  const hours = Math.ceil((dueAt.getTime() - Date.now()) / 3600000)
  const timing = hours <= 0 ? 'El plazo ya venció' : hours <= 24 ? `Faltan ${hours} h` : `Faltan ${Math.ceil(hours / 24)} días`
  return {
    id: `operational:sample-due:${row.id}`,
    alert_key: `sample-due:${row.id}`,
    title: `${timing} para ${row.sample_code}`,
    body: `${row.analyst_names || 'Equipo de análisis'} · ${row.service_code} · ${row.sample_description}`,
    type: 'deadline', priority: hours <= 0 ? 'high' : 'normal', action_url: 'dashboard', read_at: null,
    created_at: row.analysis_due_at, operational: true, critical: false,
  }
}

async function workerOperationalAlerts(user) {
  if (String(user.email || '').toLowerCase() !== WORKER_ACCOUNT) return []
  const [incubations, deadlines, biotechnologyDeadlines] = await Promise.all([
    query(
      `SELECT r.id,r.record_code,r.material_description,r.expected_end_at,e.code AS equipment_code,e.name AS equipment_name,
              STRING_AGG(DISTINCT s.code, ', ' ORDER BY s.code) AS service_codes
       FROM laboratory_equipment_runs r
       JOIN laboratory_equipment e ON e.id=r.equipment_id
       LEFT JOIN laboratory_equipment_run_services rs ON rs.run_id=r.id
       LEFT JOIN service_requests s ON s.id=rs.service_id AND s.archived_at IS NULL
       LEFT JOIN operational_alert_acknowledgements ack ON ack.alert_key='incubation:'||r.id::text AND ack.user_id=$1
       WHERE r.status='running' AND r.equipment_type IN ('incubator','shaker_incubator')
         AND r.expected_end_at IS NOT NULL AND r.expected_end_at<NOW() AND ack.alert_key IS NULL
       GROUP BY r.id,e.code,e.name
       ORDER BY r.expected_end_at ASC LIMIT 20`,
      [user.id],
    ),
    query(
      `SELECT i.id,i.sample_code,i.sample_description,i.analysis_due_at,s.code AS service_code,
              STRING_AGG(DISTINCT a.full_name, ', ' ORDER BY a.full_name) AS analyst_names
       FROM sample_intakes i
       JOIN service_requests s ON s.id=i.service_id AND s.archived_at IS NULL
       LEFT JOIN worker_service_assignments wsa ON wsa.service_id=s.id AND wsa.active=true
       LEFT JOIN analysts a ON a.id=wsa.analyst_id AND a.biotechnology_access=false
       LEFT JOIN operational_alert_acknowledgements ack ON ack.alert_key='sample-due:'||i.id::text AND ack.user_id=$1
       WHERE i.processing_status<>'completed' AND i.analysis_due_at IS NOT NULL
         AND i.analysis_due_at<=NOW()+INTERVAL '2 days' AND ack.alert_key IS NULL
       GROUP BY i.id,s.code
       ORDER BY i.analysis_due_at ASC LIMIT 20`,
      [user.id],
    ),
    query(
      `SELECT b.id,b.code,b.current_stage,b.current_subculture,b.current_stage_started_on,
              (CURRENT_DATE-b.current_stage_started_on)::int AS elapsed_days
       FROM biotechnology_batches b
       WHERE b.status='active' AND b.archived_at IS NULL
         AND b.current_stage IN ('introduction','multiplication','rooting')
         AND b.current_stage_started_on IS NOT NULL
         AND b.current_stage_started_on<CURRENT_DATE-INTERVAL '20 days'
       ORDER BY b.current_stage_started_on ASC LIMIT 30`,
    ),
  ])
  return [
    ...incubations.map((row) => operationalNotification(row, 'incubation')),
    ...deadlines.map((row) => operationalNotification(row, 'deadline')),
    ...biotechnologyDeadlines.map((row) => operationalNotification(row, 'biotechnology')),
  ]
}

export default async function handler(req, res) {
  // Notifications are intentionally available to the authenticated shared worker
  // account before a personal PIN is entered. No customer identity is returned.
  const user = await getUser(req)
  if (!user) return json(res, 401, { error: 'Sesión no válida' })
  if (!can(user, 'notifications', req.method === 'PATCH' ? 'edit' : 'view')) {
    return json(res, 403, { error: 'No tienes permiso para consultar notificaciones.' })
  }

  if (req.query?.emailLog === '1') {
    if (user.role !== 'admin') return json(res, 403, { error: 'Solo los administradores pueden consultar los correos enviados.' })
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    try {
      return json(res, 200, await emailDeliveryLog(req.query.refresh || null))
    } catch (error) {
      console.error('No fue posible consultar el historial de correos:', error)
      return json(res, 500, { error: 'No fue posible consultar el historial de correos.' })
    }
  }

  if (req.method === 'GET') {
    const [rows, operational] = await Promise.all([
      query(
        `SELECT id, title, body, type, priority, action_url, read_at, created_at
         FROM notifications
         WHERE user_id = $1 OR (user_id IS NULL AND audience IN ('all', $2))
         ORDER BY created_at DESC LIMIT 40`,
        [user.id, user.role],
      ),
      workerOperationalAlerts(user),
    ])
    return json(res, 200, { notifications: [...operational, ...rows] })
  }

  if (req.method === 'PATCH') {
    const payload = await body(req)
    if (payload.alertKey && String(user.email || '').toLowerCase() === WORKER_ACCOUNT) {
      await query(
        `INSERT INTO operational_alert_acknowledgements
           (alert_key,user_id,acknowledged_by_analyst_id,acknowledged_at)
         VALUES ($1,$2,$3,NOW())
         ON CONFLICT (alert_key,user_id) DO UPDATE SET
           acknowledged_by_analyst_id=EXCLUDED.acknowledged_by_analyst_id,acknowledged_at=NOW()`,
        [String(payload.alertKey).slice(0,180),user.id,user.activeWorker?.id || null],
      )
    } else if (payload.all) {
      await query(
        `UPDATE notifications SET read_at = COALESCE(read_at, NOW())
         WHERE user_id = $1 OR (user_id IS NULL AND audience IN ('all', $2))`,
        [user.id, user.role],
      )
    } else if (payload.id) {
      await query(
        `UPDATE notifications SET read_at = COALESCE(read_at, NOW())
         WHERE id = $1 AND (user_id = $2 OR (user_id IS NULL AND audience IN ('all', $3)))`,
        [payload.id, user.id, user.role],
      )
    }
    return json(res, 200, { ok: true })
  }

  return methodNotAllowed(res, ['GET', 'PATCH'])
}
