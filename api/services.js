import crypto from 'node:crypto'
import { requireUser } from './_lib/auth.js'
import { body, json, methodNotAllowed } from './_lib/http.js'
import { query } from './_lib/db.js'
import { initializeWorkflow } from './_lib/workflow.js'
import labOperationsHandler from './_lib/lab-operations-handler.js'
import microbiologyHandler from './_lib/microbiology-handler.js'
import procurementHandler from './_lib/procurement-handler.js'
import { sendOrderCreatedEmail, sendScheduleEmail } from './_lib/email.js'

function serviceCode() {
  return `SOL-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
}

function serviceSummary(items) {
  if (items.length === 1) return items[0].name
  const complete = items.map((item) => item.name).join(' + ')
  if (complete.length <= 115) return complete
  return `${items[0].name} + ${items[1].name} + ${items.length - 2} análisis más`
}

const ASSIGNMENT_ADMINS = new Set(['antoniog@aslaboratorios.com', 'aespinales@aslaboratorios.com', 'luisg@aslaboratorios.com'])
const SAMPLE_INTAKE_MODES = new Set(['client_delivery', 'aslabs_collection', 'aslabs_sampling', 'none'])
const canAssignAnalysts = (user) => user.role === 'admin' && ASSIGNMENT_ADMINS.has(String(user.email || '').toLowerCase())

function sampleIntakeMode(value) {
  return SAMPLE_INTAKE_MODES.has(value) ? value : 'client_delivery'
}

function analystIds(payload) {
  return [...new Set(
    (Array.isArray(payload.analystIds) ? payload.analystIds : [])
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim()),
  )]
}

function requestedServiceIds(payload) {
  return [...new Set(
    (Array.isArray(payload.serviceTypeIds) ? payload.serviceTypeIds : [payload.serviceTypeId])
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim()),
  )]
}

function optionalTimestamp(value) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw Object.assign(new Error('La fecha y hora de recepción o toma de muestra no es válida.'), { status: 400 })
  return parsed.toISOString()
}

async function catalogItems(ids) {
  if (!ids.length || ids.length > 60) return []
  return query(
    `SELECT id,category_id,category_name,name,sort_order
     FROM service_catalog
     WHERE id=ANY($1::text[]) AND active=true
     ORDER BY category_name,sort_order,name`,
    [ids],
  )
}

async function validateZone(zoneId, clientUserId) {
  if (!zoneId) return null
  const rows = await query(
    `SELECT id,name FROM zones WHERE id=$1 AND client_user_id=$2`,
    [zoneId, clientUserId],
  )
  if (!rows[0]) throw Object.assign(new Error('La zona delimitada no pertenece al cliente seleccionado.'), { status: 400 })
  return rows[0]
}

async function validateAnalystSelection(ids, user) {
  if (!canAssignAnalysts(user)) throw Object.assign(new Error('Solo Antonio Guevara, Andy Espinales o Luis Guevara pueden asignar analistas.'), { status: 403 })
  if (ids.length > 50) throw Object.assign(new Error('No puedes asignar más de 50 analistas.'), { status: 400 })
  if (ids.length) {
    const available = await query(
      `SELECT id FROM analysts
       WHERE id=ANY($1::uuid[]) AND status='active' AND biotechnology_access=false`,
      [ids],
    )
    if (available.length !== ids.length) throw Object.assign(new Error('Uno o más analistas no están disponibles para este servicio.'), { status: 400 })
  }
}

async function replaceServiceAnalysts(serviceId, ids, user) {
  await validateAnalystSelection(ids, user)
  const [services, previous] = await Promise.all([
    query(`SELECT id,code,COALESCE(NULLIF(display_name,''),service_type_name) AS service_name FROM service_requests WHERE id=$1 AND archived_at IS NULL`, [serviceId]),
    query(`SELECT analyst_id FROM worker_service_assignments WHERE service_id=$1 AND active=true`, [serviceId]),
  ])
  if (!services[0]) throw Object.assign(new Error('Servicio no encontrado.'), { status: 404 })
  const previousIds = new Set(previous.map((item) => item.analyst_id))
  const newlyAssigned = ids.filter((id) => !previousIds.has(id))
  await query(`UPDATE worker_service_assignments SET active=false,updated_at=NOW() WHERE service_id=$1 AND active=true`, [serviceId])
  if (ids.length) {
    await query(
      `INSERT INTO worker_service_assignments (analyst_id,service_id,active,assigned_by_user_id)
       SELECT id,$2,true,$3 FROM analysts WHERE id=ANY($1::uuid[])
       ON CONFLICT (analyst_id,service_id) DO UPDATE
       SET active=true,assigned_by_user_id=EXCLUDED.assigned_by_user_id,assigned_at=NOW(),updated_at=NOW()`,
      [ids, serviceId, user.id],
    )
  }
  if (newlyAssigned.length) {
    await query(
      `INSERT INTO notifications (user_id,title,body,type,priority,audience,action_url)
       SELECT worker.id,a.full_name || ' tiene nueva orden',
              $2 || ' · ' || $3,'order','high','all','dashboard'
       FROM analysts a
       CROSS JOIN users worker
       WHERE a.id=ANY($1::uuid[]) AND a.biotechnology_access=false
         AND LOWER(worker.email)='as@aslaboratorios.com' AND worker.status='active'`,
      [newlyAssigned,services[0].code,services[0].service_name],
    )
  }
  return query(
    `SELECT a.id,a.full_name,a.specialty
     FROM worker_service_assignments wsa JOIN analysts a ON a.id=wsa.analyst_id
     WHERE wsa.service_id=$1 AND wsa.active=true ORDER BY a.full_name`,
    [serviceId],
  )
}

export default async function handler(req, res) {
  if (req.query?.procurement === '1') return procurementHandler(req, res)
  if (req.query?.labOperations === '2') return microbiologyHandler(req, res)
  if (req.query?.labOperations === '1') return labOperationsHandler(req, res)
  const action = req.method === 'POST' ? 'create' : req.method === 'PATCH' ? 'edit' : 'view'
  const reportsView = req.method === 'GET' && req.query?.reports === '1'
  const trashView = req.method === 'GET' && req.query?.trash === '1'
  const user = await requireUser(req, res, reportsView ? 'results' : 'orders', action)
  if (!user) return

  if (req.method === 'GET') {
    if (req.query?.catalog === '1') {
      const catalog = await query(
        `SELECT id, category_id, category_name, name, description, estimated_duration, icon,
                group_name, matrix_scope, sort_order
         FROM service_catalog WHERE active = true
         ORDER BY category_name, sort_order, name`,
      )
      return json(res, 200, { catalog })
    }
    if (reportsView) {
      const reports = await query(
        `SELECT s.id, s.code,
                COALESCE(NULLIF(s.display_name, ''), s.service_type_name) AS service_type_name,
                u.full_name AS client_name, u.company AS client_company,
                r.id AS final_report_id, r.file_name AS final_report_name,
                r.version AS final_report_version, r.file_size AS final_report_size,
                r.created_at AS final_report_created_at
         FROM service_final_reports r
         JOIN service_requests s ON s.id = r.service_id
         JOIN users u ON u.id = s.client_user_id
         WHERE r.is_current = true AND r.approval_status='approved' AND s.archived_at IS NULL
           AND ($1 = true OR s.client_user_id = $2)
         ORDER BY r.created_at DESC`,
        [user.role === 'admin', user.id],
      )
      return json(res, 200, { reports })
    }
    if (trashView && user.role !== 'admin') {
      return json(res, 403, { error: 'Solo un administrador puede consultar la papelera.' })
    }
    const services = await query(
      `SELECT s.id, s.code, s.service_type_id,
              COALESCE(NULLIF(s.display_name, ''), s.service_type_name) AS service_type_name,
              s.service_type_name AS catalog_service_name, s.display_name,
              s.service_category_id, s.service_category_name, s.quote_reference, s.zone_name, s.zone_id,
              s.sample_count, s.priority, s.notes, s.status, s.sample_intake_mode, s.sample_intake_scheduled_at, s.requested_at,
              s.archived_at, s.archive_reason,
              s.accepted_at, s.updated_at, s.current_stage_position, u.id AS client_user_id,
              u.full_name AS client_name, u.company AS client_company, u.email AS client_email,
              current_stage.title AS current_stage_title, s.sampling_site_id,
              sample_site.name AS sampling_site_name,
              COALESCE(stage_totals.total_stages, 0)::int AS total_stages,
              final_report.id AS final_report_id,
              final_report.file_name AS final_report_name,
              final_report.version AS final_report_version,
              final_report.file_size AS final_report_size,
              final_report.created_at AS final_report_created_at,
              COALESCE(service_items.items, '[]'::jsonb) AS service_items,
              COALESCE(assigned_analysts.items, '[]'::jsonb) AS assigned_analysts,
              sample_deadline.sample_due_at,
              COALESCE(sample_deadline.pending_samples,0)::int AS pending_samples,
              COALESCE(sample_deadline.received_samples,0)::int AS received_samples,
              COALESCE(sample_deadline.stored_samples,0)::int AS stored_samples,
              COALESCE(sample_deadline.processing_samples,0)::int AS processing_samples,
              crew_schedule.next_sampling_at,crew_schedule.sampling_status,
              equipment_alert.equipment_code AS running_equipment_code,
              equipment_alert.equipment_name AS running_equipment_name,
              equipment_alert.equipment_type AS running_equipment_type,
              equipment_alert.expected_end_at AS running_equipment_due_at,
              equipment_alert.started_at AS running_equipment_started_at
       FROM service_requests s
       JOIN users u ON u.id = s.client_user_id
       LEFT JOIN service_workflow_stages current_stage
         ON current_stage.service_id = s.id AND current_stage.position = s.current_stage_position
       LEFT JOIN field_sites sample_site ON sample_site.id = s.sampling_site_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS total_stages FROM service_workflow_stages ws WHERE ws.service_id = s.id
       ) stage_totals ON true
       LEFT JOIN LATERAL (
         SELECT r.id, r.file_name, r.version, r.file_size, r.created_at
         FROM service_final_reports r
         WHERE r.service_id = s.id AND r.is_current = true AND r.approval_status='approved'
         ORDER BY r.version DESC
         LIMIT 1
       ) final_report ON true
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object(
           'id', item.id,
           'catalogServiceId', item.catalog_service_id,
           'categoryId', item.category_id,
           'categoryName', item.category_name,
           'name', item.service_name
         ) ORDER BY item.sort_order, item.created_at) AS items
         FROM service_request_items item
         WHERE item.service_id = s.id
       ) service_items ON true
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object(
           'id',a.id,'fullName',a.full_name,'specialty',a.specialty
         ) ORDER BY a.full_name) AS items
         FROM worker_service_assignments wsa
         JOIN analysts a ON a.id=wsa.analyst_id
         WHERE wsa.service_id=s.id AND wsa.active=true
       ) assigned_analysts ON true
       LEFT JOIN LATERAL (
         SELECT MIN(i.analysis_due_at) FILTER (WHERE i.processing_status<>'completed') AS sample_due_at,
                COUNT(*) FILTER (WHERE i.processing_status<>'completed') AS pending_samples,
                COUNT(*) AS received_samples,
                COUNT(*) FILTER (WHERE i.processing_status='stored') AS stored_samples,
                COUNT(*) FILTER (WHERE i.processing_status='processing') AS processing_samples
         FROM sample_intakes i WHERE i.service_id=s.id
       ) sample_deadline ON true
       LEFT JOIN LATERAL (
         SELECT a.scheduled_at AS next_sampling_at,a.status AS sampling_status
         FROM crew_service_assignments a
         WHERE a.service_id=s.id AND a.assignment_type='sampling'
         ORDER BY CASE WHEN a.status='completed' THEN 1 ELSE 0 END,COALESCE(a.scheduled_at,a.created_at)
         LIMIT 1
       ) crew_schedule ON true
       LEFT JOIN LATERAL (
         SELECT e.code AS equipment_code,e.name AS equipment_name,e.equipment_type,
                r.expected_end_at,r.started_at
         FROM laboratory_equipment_run_services rs
         JOIN laboratory_equipment_runs r ON r.id=rs.run_id
         JOIN laboratory_equipment e ON e.id=r.equipment_id
         WHERE rs.service_id=s.id AND r.status='running'
         ORDER BY CASE WHEN r.expected_end_at IS NOT NULL AND r.expected_end_at<NOW() THEN 0 ELSE 1 END,r.started_at
         LIMIT 1
       ) equipment_alert ON true
       WHERE ($1 = true OR s.client_user_id = $2)
         AND (($3 = true AND s.archived_at IS NOT NULL)
           OR ($3 = false AND s.archived_at IS NULL))
       ORDER BY COALESCE(s.archived_at, s.requested_at) DESC`,
      [user.role === 'admin', user.id, trashView],
    )
    const visibleServices = user.role === 'admin' ? services : services.map((service) => ({
      ...service,
      running_equipment_code: service.running_equipment_code ? 'EN-USO' : null,
      running_equipment_due_at: null,
      running_equipment_started_at: null,
    }))
    return json(res, 200, { services: visibleServices })
  }

  if (req.method === 'POST') {
    const payload = await body(req)
    const selectedAnalystIds = analystIds(payload)
    if (user.role === 'admin' && selectedAnalystIds.length) await validateAnalystSelection(selectedAnalystIds, user)
    const requestedIds = requestedServiceIds(payload)
    if (!requestedIds.length || requestedIds.length > 60 || !payload.quoteReference || !payload.zoneName || !payload.sampleCount) {
      return json(res, 400, { error: 'Completa la cotización, selecciona entre 1 y 60 análisis, e indica ubicación y muestras.' })
    }
    const clientUserId = user.role === 'admin' ? payload.clientUserId : user.id
    if (!clientUserId) return json(res, 400, { error: 'Selecciona el cliente del servicio.' })

    const client = await query('SELECT id, full_name FROM users WHERE id = $1 AND status = $2', [clientUserId, 'active'])
    if (!client[0]) return json(res, 404, { error: 'El cliente seleccionado no está disponible.' })
    const catalog = await catalogItems(requestedIds)
    if (catalog.length !== requestedIds.length) {
      return json(res, 400, { error: 'Uno o más análisis seleccionados ya no están disponibles.' })
    }
    if (payload.samplingSiteId) {
      const sites = await query(
        `SELECT id FROM field_sites
         WHERE id = $1 AND site_type = 'sampling' AND active = true
           AND client_user_id = $2`,
        [payload.samplingSiteId, clientUserId],
      )
      if (!sites[0]) return json(res, 400, { error: 'La sede de muestreo seleccionada no está disponible.' })
    }
    let selectedZone
    let sampleIntakeScheduledAt
    try {
      selectedZone = await validateZone(payload.zoneId, clientUserId)
      sampleIntakeScheduledAt = optionalTimestamp(payload.sampleIntakeScheduledAt)
    } catch (error) {
      return json(res, error.status || 400, { error: error.message })
    }

    const intakeMode = sampleIntakeMode(payload.sampleIntakeMode)
    if (intakeMode === 'none') sampleIntakeScheduledAt = null
    const status = user.role === 'admin' ? 'accepted' : 'pending'
    const isCombined = catalog.length > 1
    const summary = serviceSummary(catalog)
    const serviceTypeId = isCombined ? 'multi-analysis' : catalog[0].id
    const categoryId = isCombined ? 'combined-analysis' : catalog[0].category_id
    const categoryName = isCombined ? 'Análisis combinados' : catalog[0].category_name
    const rows = await query(
      `INSERT INTO service_requests
       (code, client_user_id, created_by_user_id, service_type_id, service_type_name,
        service_category_id, service_category_name, quote_reference, zone_name, zone_id, sampling_site_id,
        sample_count, priority, notes, sample_intake_mode, sample_intake_scheduled_at, status, accepted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
         CASE WHEN $17 = 'accepted' THEN NOW() ELSE NULL END)
       RETURNING *`,
      [
        serviceCode(), clientUserId, user.id, serviceTypeId, summary,
        categoryId, categoryName, payload.quoteReference.trim(),
        selectedZone?.name || payload.zoneName.trim(), selectedZone?.id || null,
        payload.samplingSiteId || null, Number(payload.sampleCount),
        payload.priority || 'estandar', payload.notes?.trim() || null, intakeMode, sampleIntakeScheduledAt, status,
      ],
    )
    await query(
      `INSERT INTO service_request_items
         (service_id, catalog_service_id, category_id, category_name, service_name, sort_order)
       SELECT $1, c.id, c.category_id, c.category_name, c.name,
              ROW_NUMBER() OVER (ORDER BY c.category_name, c.sort_order, c.name)::int
       FROM service_catalog c
       WHERE c.id = ANY($2::text[]) AND c.active = true
       ON CONFLICT (service_id, catalog_service_id) DO NOTHING`,
      [rows[0].id, requestedIds],
    )
    if (user.role === 'admin' && selectedAnalystIds.length) {
      await replaceServiceAnalysts(rows[0].id, selectedAnalystIds, user)
    }
    if (status === 'accepted') {
      await initializeWorkflow(rows[0].id, serviceTypeId, user.id)
    }
    await query(
      `INSERT INTO notifications (user_id, title, body, type, priority, audience, action_url)
       VALUES ($1, $2, $3, 'service', $4, $5, 'ordenes')`,
      [
        user.role === 'admin' ? clientUserId : null,
        user.role === 'admin' ? 'Nuevo servicio creado' : 'Nueva solicitud recibida',
        user.role === 'admin'
          ? `${summary} fue creado por el administrador.`
          : `${client[0].full_name} solicitó ${summary}.`,
        payload.priority === 'urgente' ? 'high' : 'normal',
        user.role === 'admin' ? 'client' : 'admin',
      ],
    )
    await sendOrderCreatedEmail(rows[0].id, sampleIntakeScheduledAt, intakeMode)
    return json(res, 201, { service: rows[0] })
  }

  if (req.method === 'PATCH') {
    if (user.role !== 'admin') return json(res, 403, { error: 'Solo un administrador puede aceptar o modificar servicios.' })
    const payload = await body(req)
    if (payload.action === 'trash') {
      if (!payload.id) return json(res, 400, { error: 'Falta el servicio.' })
      const rows = await query(
        `UPDATE service_requests
         SET archived_at=NOW(), archived_by_user_id=$2, archive_reason=$3, updated_at=NOW()
         WHERE id=$1 AND archived_at IS NULL
         RETURNING id,code,COALESCE(NULLIF(display_name,''),service_type_name) AS service_type_name,archived_at`,
        [payload.id, user.id, payload.reason?.trim().slice(0, 300) || null],
      )
      if (!rows[0]) return json(res, 404, { error: 'El servicio no existe o ya está en la papelera.' })
      return json(res, 200, { service: rows[0] })
    }
    if (payload.action === 'restore') {
      if (!payload.id) return json(res, 400, { error: 'Falta el servicio.' })
      const rows = await query(
        `UPDATE service_requests
         SET archived_at=NULL,archived_by_user_id=NULL,archive_reason=NULL,updated_at=NOW()
         WHERE id=$1 AND archived_at IS NOT NULL
         RETURNING id,code,COALESCE(NULLIF(display_name,''),service_type_name) AS service_type_name,status`,
        [payload.id],
      )
      if (!rows[0]) return json(res, 404, { error: 'El servicio no existe o ya fue restaurado.' })
      return json(res, 200, { service: rows[0] })
    }
    if (payload.action === 'set_analysts') {
      if (!payload.id) return json(res, 400, { error: 'Falta el servicio.' })
      try {
        const assignedAnalysts = await replaceServiceAnalysts(payload.id, analystIds(payload), user)
        return json(res, 200, { assignedAnalysts })
      } catch (error) {
        return json(res, error.status || 500, { error: error.status ? error.message : 'No fue posible actualizar los analistas.' })
      }
    }
    if (payload.action === 'edit_full') {
      const requestedIds = requestedServiceIds(payload)
      const selectedAnalystIds = analystIds(payload)
      const status = ['pending', 'accepted', 'in_progress', 'completed', 'rejected'].includes(payload.status) ? payload.status : null
      const samples = Number(payload.sampleCount)
      if (!payload.id || !requestedIds.length || requestedIds.length > 60 || !payload.clientUserId
        || !payload.quoteReference?.trim() || !payload.zoneName?.trim()
        || !Number.isInteger(samples) || samples < 1 || samples > 500
        || !['estandar', 'rapida', 'urgente'].includes(payload.priority) || !status) {
        return json(res, 400, { error: 'Revisa cliente, análisis, cotización, ubicación, muestras, prioridad y estado.' })
      }
      try {
        const [currentRows, clientRows, catalog] = await Promise.all([
          query(`SELECT id,code,client_user_id,status,sample_intake_mode,sample_intake_scheduled_at FROM service_requests WHERE id=$1 AND archived_at IS NULL`, [payload.id]),
          query(`SELECT u.id,u.full_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1 AND u.status='active' AND r.slug='client'`, [payload.clientUserId]),
          catalogItems(requestedIds),
        ])
        const current = currentRows[0]
        if (!current) return json(res, 404, { error: 'Servicio no encontrado.' })
        if (!clientRows[0]) return json(res, 400, { error: 'El cliente seleccionado no está disponible.' })
        if (catalog.length !== requestedIds.length) return json(res, 400, { error: 'Uno o más análisis seleccionados no están disponibles.' })
        if (Object.hasOwn(payload, 'analystIds')) await validateAnalystSelection(selectedAnalystIds, user)

        if (payload.samplingSiteId) {
          const sites = await query(
            `SELECT id FROM field_sites
             WHERE id=$1 AND site_type='sampling' AND active=true AND client_user_id=$2`,
            [payload.samplingSiteId, payload.clientUserId],
          )
          if (!sites[0]) return json(res, 400, { error: 'La sede de muestreo no pertenece al cliente seleccionado.' })
        }
        const selectedZone = await validateZone(payload.zoneId, payload.clientUserId)
        const intakeMode = sampleIntakeMode(payload.sampleIntakeMode)
        const sampleIntakeScheduledAt = intakeMode === 'none' ? null : optionalTimestamp(payload.sampleIntakeScheduledAt)

        const isCombined = catalog.length > 1
        const summary = serviceSummary(catalog)
        const serviceTypeId = isCombined ? 'multi-analysis' : catalog[0].id
        const categoryId = isCombined ? 'combined-analysis' : catalog[0].category_id
        const categoryName = isCombined ? 'Análisis combinados' : catalog[0].category_name
        const displayName = payload.displayName?.trim() || null
        const rows = await query(
          `UPDATE service_requests SET
             client_user_id=$2,service_type_id=$3,service_type_name=$4,
             service_category_id=$5,service_category_name=$6,display_name=$7,
             quote_reference=$8,zone_name=$9,zone_id=$10,sampling_site_id=$11,sample_count=$12,
             priority=$13,notes=$14,sample_intake_mode=$15,sample_intake_scheduled_at=$16,status=$17,
             accepted_at=CASE WHEN $17 IN ('accepted','in_progress','completed') THEN COALESCE(accepted_at,NOW()) ELSE accepted_at END,
             updated_at=NOW()
           WHERE id=$1
           RETURNING id,code,client_user_id,service_type_id,
             COALESCE(NULLIF(display_name,''),service_type_name) AS service_type_name,status`,
          [payload.id,payload.clientUserId,serviceTypeId,summary,categoryId,categoryName,displayName,
            payload.quoteReference.trim(),selectedZone?.name || payload.zoneName.trim(),selectedZone?.id || null,
            payload.samplingSiteId || null,samples,payload.priority,payload.notes?.trim() || null,intakeMode,sampleIntakeScheduledAt,status],
        )

        await query(
          `INSERT INTO service_request_items
             (service_id,catalog_service_id,category_id,category_name,service_name,sort_order)
           SELECT $1,c.id,c.category_id,c.category_name,c.name,
             ROW_NUMBER() OVER (ORDER BY c.category_name,c.sort_order,c.name)::int
           FROM service_catalog c WHERE c.id=ANY($2::text[]) AND c.active=true
           ON CONFLICT (service_id,catalog_service_id) DO UPDATE SET
             category_id=EXCLUDED.category_id,category_name=EXCLUDED.category_name,
             service_name=EXCLUDED.service_name,sort_order=EXCLUDED.sort_order`,
          [payload.id, requestedIds],
        )
        await query(
          `DELETE FROM service_request_items
           WHERE service_id=$1 AND NOT (catalog_service_id=ANY($2::text[]))`,
          [payload.id, requestedIds],
        )
        if (Object.hasOwn(payload, 'analystIds')) await replaceServiceAnalysts(payload.id, selectedAnalystIds, user)
        if (['accepted', 'in_progress', 'completed'].includes(status)) await initializeWorkflow(payload.id, serviceTypeId, user.id)
        await query(
          `INSERT INTO service_stage_events (service_id,action,actor_user_id,note)
           VALUES ($1,'service_edited',$2,$3)`,
          [payload.id,user.id,`Orden actualizada · ${catalog.length} análisis · Cliente: ${clientRows[0].full_name}`],
        )
        await query(
          `INSERT INTO notifications (user_id,title,body,type,priority,audience,action_url)
           VALUES ($1,'Servicio actualizado',$2,'service','normal','client','ordenes')`,
          [payload.clientUserId,`${rows[0].code} · ${rows[0].service_type_name}`],
        )
        const previousSchedule = current.sample_intake_scheduled_at ? new Date(current.sample_intake_scheduled_at).getTime() : null
        const nextSchedule = sampleIntakeScheduledAt ? new Date(sampleIntakeScheduledAt).getTime() : null
        if (intakeMode !== 'none' && (previousSchedule !== nextSchedule || current.sample_intake_mode !== intakeMode)) {
          await sendScheduleEmail(payload.id, sampleIntakeScheduledAt, {
            previousAt: current.sample_intake_scheduled_at,
            mode: intakeMode,
            eventKey: `sample_schedule:${payload.id}:${Date.now()}`,
          })
        }
        return json(res, 200, { service: rows[0], previousClientUserId: current.client_user_id })
      } catch (error) {
        if (error.status) return json(res, error.status, { error: error.message })
        if (error.code === '23503' || error.code === '22P02') return json(res, 400, { error: 'Uno de los datos relacionados ya no está disponible.' })
        return json(res, 500, { error: 'No fue posible actualizar la orden completa.' })
      }
    }
    if (payload.action === 'rename') {
      const nextName = payload.displayName?.trim()
      if (!payload.id || !nextName || nextName.length < 3 || nextName.length > 120) {
        return json(res, 400, { error: 'El nombre operativo debe tener entre 3 y 120 caracteres.' })
      }
      const renamed = await query(
        `UPDATE service_requests
         SET display_name = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING id, code, client_user_id, service_type_id,
                   COALESCE(NULLIF(display_name, ''), service_type_name) AS service_type_name,
                   service_type_name AS catalog_service_name, display_name, status`,
        [payload.id, nextName],
      )
      if (!renamed[0]) return json(res, 404, { error: 'Servicio no encontrado.' })
      await query(
        `INSERT INTO notifications (user_id, title, body, type, priority, audience, action_url)
         VALUES ($1, 'Nombre del servicio actualizado', $2, 'service', 'normal', 'client', 'ordenes')`,
        [renamed[0].client_user_id, `${renamed[0].code} · ${renamed[0].service_type_name}`],
      )
      return json(res, 200, { service: renamed[0] })
    }
    if (!payload.id || !['accepted', 'rejected'].includes(payload.status)) {
      return json(res, 400, { error: 'La actualización del servicio no es válida.' })
    }
    const rows = await query(
      `UPDATE service_requests
       SET status = $2,
           accepted_at = CASE WHEN $2 = 'accepted' THEN COALESCE(accepted_at, NOW()) ELSE accepted_at END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, code, client_user_id, service_type_id,
                 COALESCE(NULLIF(display_name, ''), service_type_name) AS service_type_name, status`,
      [payload.id, payload.status],
    )
    if (!rows[0]) return json(res, 404, { error: 'Servicio no encontrado.' })
    if (payload.status === 'accepted') {
      await initializeWorkflow(rows[0].id, rows[0].service_type_id, user.id)
    }
    const statusLabel = {
      accepted: 'aceptada',
      rejected: 'rechazada',
    }[payload.status]
    await query(
      `INSERT INTO notifications (user_id, title, body, type, priority, audience, action_url)
       VALUES ($1, $2, $3, 'service', 'normal', 'client', 'ordenes')`,
      [
        rows[0].client_user_id,
        `Solicitud ${statusLabel}`,
        `${rows[0].code} · ${rows[0].service_type_name}`,
      ],
    )
    return json(res, 200, { service: rows[0] })
  }

  return methodNotAllowed(res, ['GET', 'POST', 'PATCH'])
}
