import { can, requireUser } from './_lib/auth.js'
import { body, json, methodNotAllowed } from './_lib/http.js'
import { query } from './_lib/db.js'
import generateStagePdf from './_lib/stage-pdf.js'
import { createMicrobiologyStepPdf } from './_lib/microbiology-pdf.js'
import sampleIntakeHandler from './_lib/sample-intake-handler.js'
import { createFinalReportPdf, reportCode } from './_lib/final-report-pdf.js'
import { createEquipmentRunPdfBuffer } from './_lib/equipment-run-pdf.js'
import { sendResultsReadyEmail } from './_lib/email.js'
import publicDocumentHandler from './_lib/public-document-handler.js'

const REPORT_APPROVERS = new Set([
  'antoniog@aslaboratorios.com',
  'aespinales@aslaboratorios.com',
  'luisg@aslaboratorios.com',
])
const canApproveReport = (user) => user.role === 'admin' && REPORT_APPROVERS.has(String(user.email || '').toLowerCase())

let reportColumnsPromise
function ensureReportColumns() {
  if (!reportColumnsPromise) {
    reportColumnsPromise = Promise.all([
      query(`ALTER TABLE service_final_reports ADD COLUMN IF NOT EXISTS interpretation text`),
      query(`ALTER TABLE service_final_reports ADD COLUMN IF NOT EXISTS observations text`),
      query(`ALTER TABLE service_analysis_photos ADD COLUMN IF NOT EXISTS title text`),
      query(`ALTER TABLE service_analysis_photos ADD COLUMN IF NOT EXISTS note text`),
      query(`ALTER TABLE service_analysis_photos ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0`),
    ])
  }
  return reportColumnsPromise
}

async function accessibleService(user, serviceId) {
  const showClientIdentity = user.role === 'admin' || user.role === 'client'
  const rows = await query(
    `SELECT s.id, s.code, s.status, s.current_stage_position, s.service_category_name, s.zone_name,
            s.sample_intake_mode, s.sample_count,
            COALESCE(NULLIF(s.display_name, ''), s.service_type_name) AS service_type_name,
            s.client_user_id,
            CASE WHEN $5=true THEN u.email ELSE NULL END AS client_email,
            CASE WHEN $5=true THEN u.dni ELSE NULL END AS client_dni,
            CASE WHEN $5=true THEN u.full_name ELSE NULL END AS client_name,
            CASE WHEN $5=true THEN u.company ELSE NULL END AS client_company,
            COALESCE(items.service_items, '[]'::jsonb) AS service_items
     FROM service_requests s
     JOIN users u ON u.id = s.client_user_id
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object(
         'id', item.id,
         'catalogServiceId', item.catalog_service_id,
         'categoryId', item.category_id,
         'categoryName', item.category_name,
         'name', item.service_name
       ) ORDER BY item.sort_order, item.created_at) AS service_items
       FROM service_request_items item
       WHERE item.service_id = s.id
     ) items ON true
     WHERE s.id = $1 AND s.archived_at IS NULL
       AND ($2 = true OR s.client_user_id = $3 OR EXISTS (
         SELECT 1 FROM worker_service_assignments wsa
         WHERE wsa.service_id=s.id AND wsa.analyst_id=$4 AND wsa.active=true
       ))`,
    [serviceId, user.role === 'admin', user.id, user.activeWorker?.id || null, showClientIdentity],
  )
  return rows[0]
}

async function workflowPayload(serviceId, user) {
  const includeInternal = user.role === 'admin' || Boolean(user.activeWorker)
  const stages = await query(
    `SELECT ws.id, ws.stage_key, ws.position, ws.title, ws.status,
            ws.performed_by, ws.analyst_id, ws.analyst, ws.observations, ws.started_at,
            ws.completed_at, ws.updated_at,
            COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'id', p.id,
                  'fileName', p.file_name,
                  'mimeType', p.mime_type,
                  'dataUrl', p.data_url,
                  'createdAt', p.created_at
                ) ORDER BY p.created_at
              ) FILTER (WHERE p.id IS NOT NULL),
              '[]'::jsonb
            ) AS photos
     FROM service_workflow_stages ws
     LEFT JOIN service_stage_photos p ON p.stage_id = ws.id
     WHERE ws.service_id = $1
     GROUP BY ws.id
     ORDER BY ws.position`,
    [serviceId],
  )
  const events = await query(
    `SELECT e.id, e.action, e.from_position, e.to_position, e.note, e.created_at,
            CASE WHEN $2 = true THEN u.full_name ELSE NULL END AS actor_name
     FROM service_stage_events e JOIN users u ON u.id = e.actor_user_id
     WHERE e.service_id = $1 ORDER BY e.created_at DESC LIMIT 40`,
    [serviceId, includeInternal],
  )
  const analysts = includeInternal
    ? await query(
      `SELECT a.id,a.full_name,a.email,a.specialty,a.license_number
       FROM worker_service_assignments wsa
       JOIN analysts a ON a.id=wsa.analyst_id
       WHERE wsa.service_id=$1 AND wsa.active=true AND a.status='active'
       ORDER BY a.full_name`,
      [serviceId],
    )
    : []
  const crewAssignments = await query(
    `SELECT a.id, a.crew_id, a.assignment_type, a.status, a.progress, a.scheduled_at, a.notes,
            c.name AS crew_name, c.operational_state, c.status_text,
            c.current_lat, c.current_lng, c.last_seen_at,
            home.name AS home_laboratory_name, current_site.name AS current_site_name,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', m.id, 'fullName', m.full_name, 'initials', m.initials,
                'roleTitle', COALESCE(cm.role, m.role_title)
              ) ORDER BY m.full_name)
              FROM crew_memberships cm JOIN crew_members m ON m.id = cm.member_id
              WHERE cm.crew_id = c.id AND cm.active = true AND m.status = 'active'
            ), '[]'::jsonb) AS members
     FROM crew_service_assignments a
     JOIN field_crews c ON c.id = a.crew_id
     LEFT JOIN field_sites home ON home.id = c.home_laboratory_site_id
     LEFT JOIN field_sites current_site ON current_site.id = c.current_site_id
     WHERE a.service_id = $1
     ORDER BY COALESCE(a.scheduled_at, a.created_at)`,
    [serviceId],
  )
  const availableCrews = user.role === 'admin'
    ? await query(
      `SELECT c.id, c.name, c.operational_state, home.name AS home_laboratory_name
       FROM field_crews c
       LEFT JOIN field_sites home ON home.id = c.home_laboratory_site_id
       WHERE c.active = true ORDER BY c.name`,
    )
    : []
  const finalReports = await query(
    `SELECT r.id, r.version, r.file_name, r.mime_type, r.file_size, r.notes, r.interpretation, r.observations,
            r.is_current, r.approval_status, r.approval_requested_at, r.approved_at,
            r.rejection_notes, r.created_at,
            CASE WHEN $2 = true THEN u.full_name ELSE NULL END AS uploaded_by,
            CASE WHEN $2 = true THEN approver.full_name ELSE NULL END AS approved_by
     FROM service_final_reports r
     JOIN users u ON u.id = r.uploaded_by_user_id
     LEFT JOIN users approver ON approver.id = r.approved_by_user_id
     WHERE r.service_id = $1 AND ($2 = true OR (r.is_current = true AND r.approval_status='approved'))
     ORDER BY r.version DESC`,
    [serviceId, includeInternal],
  )
  const equipmentRuns = await query(
    `SELECT r.id, r.record_code, r.status, r.started_at, r.ended_at,
            r.expected_end_at, r.duration_minutes, r.equipment_type,
            e.code AS equipment_code, e.name AS equipment_name,
            ws.title AS stage_title,
            EXISTS(
              SELECT 1
              FROM laboratory_equipment_run_nonconformities nc
              WHERE nc.run_id = r.id
            ) AS has_nonconformity
     FROM laboratory_equipment_run_services rs
     JOIN laboratory_equipment_runs r ON r.id = rs.run_id
     JOIN laboratory_equipment e ON e.id = r.equipment_id
     LEFT JOIN service_workflow_stages ws ON ws.id = rs.stage_id
     WHERE rs.service_id = $1
     ORDER BY r.started_at DESC NULLS LAST, r.created_at DESC`,
    [serviceId],
  )
  const laboratoryProcesses = await query(
    `SELECT p.id, p.process_code, p.process_type, p.title, p.analysis_names,
            p.status, p.current_step_position, p.created_at, p.updated_at,
            COALESCE(steps.steps, '[]'::jsonb) AS steps
     FROM laboratory_service_processes p
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object(
         'id', ps.id, 'stepKey', ps.step_key, 'position', ps.position,
         'title', ps.title, 'documentCode', ps.document_code, 'status', ps.status,
         'stepData', CASE WHEN $2 = true THEN ps.step_data ELSE ps.step_data
           - 'operatorUserId' - 'analystId' - 'equipmentId' - 'autoclaveCycleId' END,
         'observations', ps.observations,
         'responsible', ps.completed_by_name, 'startedAt', ps.started_at,
         'completedAt', ps.completed_at, 'updatedAt', ps.updated_at
       ) ORDER BY ps.position) AS steps
       FROM laboratory_process_steps ps WHERE ps.process_id = p.id
     ) steps ON true
     WHERE p.service_id = $1
     ORDER BY p.created_at DESC`,
    [serviceId, includeInternal],
  )
  const sampleRows = await query(
    `SELECT COUNT(*)::int AS total,
            (SELECT sample_intake_mode FROM service_requests WHERE id=$1) AS intake_mode,
            COUNT(processing_started_at)::int AS started,
            COUNT(*) FILTER (WHERE processing_status='completed')::int AS completed,
            COUNT(*) FILTER (WHERE client_copy_printed_at IS NULL)::int AS unprinted,
            COUNT(*) FILTER (WHERE storage_location IS NULL)::int AS unstored,
            COUNT(*) FILTER (WHERE processing_status='stored')::int AS stored,
            (array_agg(id ORDER BY received_at) FILTER (WHERE client_copy_printed_at IS NULL))[1] AS unprinted_id,
            (array_agg(id ORDER BY received_at) FILTER (WHERE storage_location IS NULL))[1] AS unstored_id,
            (array_agg(id ORDER BY received_at) FILTER (WHERE processing_status='stored'))[1] AS stored_id
     FROM sample_intakes WHERE service_id=$1`,
    [serviceId],
  )
  const sampleGate = {
    ...sampleRows[0],
    required: sampleRows[0].intake_mode !== 'none',
    canAdvance: sampleRows[0].intake_mode === 'none' || Number(sampleRows[0].total) > 0,
  }
  const results = includeInternal ? await query(
    `SELECT id,service_item_id,sample_code,parameter,result_value,unit,minimum_value,maximum_value,
            reference_value,identified_agent,result_group_key,result_group_label,method,observations,sort_order,created_at,updated_at
     FROM service_analysis_results WHERE service_id=$1 ORDER BY sort_order,created_at`,
    [serviceId],
  ) : []
  const resultPhotos = includeInternal ? await query(
    `SELECT id,file_name,title,note,display_order,mime_type,data_url,created_at
     FROM service_analysis_photos WHERE service_id=$1 ORDER BY display_order,created_at`,
    [serviceId],
  ) : []
  return { stages, events, analysts, crewAssignments, availableCrews, finalReports, equipmentRuns, laboratoryProcesses, sampleGate, results, resultPhotos, canApproveReport: canApproveReport(user) }
}

async function equipmentRunPdfRecord(serviceId, runId) {
  const records = await query(
    `SELECT r.*, e.code AS equipment_code, e.name AS equipment_name, e.location AS equipment_location,
            jsonb_build_array(jsonb_build_object(
              'code', s.code,
              'stageTitle', ws.title
            )) AS services,
            COALESCE(nonconformities.items, '[]'::jsonb) AS nonconformities
     FROM laboratory_equipment_run_services rs
     JOIN laboratory_equipment_runs r ON r.id = rs.run_id
     JOIN laboratory_equipment e ON e.id = r.equipment_id
     JOIN service_requests s ON s.id = rs.service_id
     LEFT JOIN service_workflow_stages ws ON ws.id = rs.stage_id
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object(
         'recordCode', nc.record_code,
         'status', nc.status,
         'detectedAt', nc.detected_at,
         'description', nc.description,
         'immediateAction', nc.immediate_action,
         'rootCause', nc.root_cause,
         'correctiveAction', nc.corrective_action,
         'responsibleName', nc.responsible_name
       ) ORDER BY nc.detected_at DESC) AS items
       FROM laboratory_equipment_run_nonconformities nc
       WHERE nc.run_id = r.id
     ) nonconformities ON true
     WHERE rs.service_id = $1 AND r.id = $2
     LIMIT 1`,
    [serviceId, runId],
  )
  return records[0] || null
}

function validResults(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 60) return null
  const clean = (value, max = 180) => String(value || '').trim().slice(0, max)
  const normalized = rows.map((row, index) => ({
    serviceItemId: /^[0-9a-f-]{36}$/i.test(String(row.serviceItemId || '')) ? row.serviceItemId : null,
    groupKey: clean(row.groupKey, 80) || `result-${index + 1}`,
    groupLabel: clean(row.groupLabel, 80) || `Resultado ${index + 1}`,
    sampleCode: clean(row.sampleCode, 80) || null,
    parameter: clean(row.parameter), resultValue: clean(row.resultValue), unit: clean(row.unit, 60) || null,
    minimumValue: clean(row.minimumValue, 60) || null, maximumValue: clean(row.maximumValue, 60) || null,
    referenceValue: clean(row.referenceValue), identifiedAgent: clean(row.identifiedAgent), method: clean(row.method), observations: clean(row.observations, 500) || null,
    sortOrder: index,
  }))
  return normalized.every((row) => row.parameter && row.resultValue) ? normalized : null
}

async function notifyReportApprovers(service, version) {
  await query(
    `INSERT INTO notifications (user_id,title,body,type,priority,audience,action_url)
     SELECT id,'Informe pendiente de aprobación',$1,'result','high','admin','ordenes'
     FROM users WHERE LOWER(email)=ANY($2::text[]) AND status='active'`,
    [`${service.code} · Informe v${version} listo para revisar`, [...REPORT_APPROVERS]],
  )
}

async function finalReportContext(serviceId) {
  const [services, results, samples, responsible, resultPhotos] = await Promise.all([
    query(
      `SELECT s.id,s.code,s.service_type_name,s.service_category_name,s.zone_name,s.sample_count,
              COALESCE(NULLIF(s.display_name,''),s.service_type_name) AS display_name,
              u.full_name AS client_name,u.company AS client_company,u.email AS client_email,u.dni AS client_dni,
              COALESCE(items.service_items,'[]'::jsonb) AS service_items
       FROM service_requests s JOIN users u ON u.id=s.client_user_id
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object('id',i.id,'name',i.service_name) ORDER BY i.sort_order,i.created_at) AS service_items
         FROM service_request_items i WHERE i.service_id=s.id
       ) items ON true WHERE s.id=$1`,
      [serviceId],
    ),
    query(`SELECT * FROM service_analysis_results WHERE service_id=$1 ORDER BY sort_order,created_at`, [serviceId]),
    query(
      `SELECT i.sample_code,i.sample_description,i.received_at,i.processing_started_at,i.processing_ended_at,
              fs.name AS sampling_site_name,fs.address AS sampling_site_address
       FROM sample_intakes i
       JOIN service_requests sample_service ON sample_service.id=i.service_id
       LEFT JOIN field_sites fs ON fs.id=sample_service.sampling_site_id
       WHERE i.service_id=$1 ORDER BY i.received_at,i.created_at`,
      [serviceId],
    ),
    query(
      `SELECT COALESCE(a.full_name,u.full_name) AS responsible_name
       FROM service_analysis_results r
       LEFT JOIN analysts a ON a.id=r.recorded_by_analyst_id
       LEFT JOIN users u ON u.id=r.recorded_by_user_id
       WHERE r.service_id=$1
       ORDER BY r.updated_at DESC,r.created_at DESC LIMIT 1`,
      [serviceId],
    ),
    query(`SELECT id,file_name,title,note,display_order,mime_type,data_url,created_at FROM service_analysis_photos WHERE service_id=$1 ORDER BY display_order,created_at`, [serviceId]),
  ])
  const service = services[0]
  if (service) service.service_type_name = service.display_name || service.service_type_name
  const expectedCount = Math.max(1, Number(service?.sample_count || 1))
  const normalizedSamples = service ? Array.from({ length: expectedCount }, (_, index) => ({
    ...(samples[index] || samples[0] || {}),
    sample_code: `${service.code}-${index + 1}`,
    sample_description: samples[index]?.sample_description || (expectedCount > 1 ? `Muestra ${index + 1}` : samples[0]?.sample_description || 'Muestra 1'),
  })) : samples
  return { service, results, samples: normalizedSamples, evidencePhotos: resultPhotos, responsibleName: responsible[0]?.responsible_name || null }
}

function validPhoto(photo) {
  return photo
    && typeof photo.fileName === 'string'
    && /^image\/(jpeg|png|webp)$/.test(photo.mimeType || '')
    && typeof photo.dataUrl === 'string'
    && photo.dataUrl.startsWith(`data:${photo.mimeType};base64,`)
    && photo.dataUrl.length <= 1_100_000
}

function photoMetadata(photo, index) {
  const title = String(photo?.title || photo?.fileName || `Fotografía ${index + 1}`).trim().slice(0, 120)
  const note = String(photo?.note || '').trim().slice(0, 500)
  return { title: title || `Fotografía ${index + 1}`, note: note || null, displayOrder: index }
}

function validFinalReport(report) {
  if (!report
    || typeof report.fileName !== 'string'
    || !report.fileName.toLowerCase().endsWith('.pdf')
    || report.fileName.length > 160
    || report.mimeType !== 'application/pdf'
    || typeof report.dataUrl !== 'string'
    || !report.dataUrl.startsWith('data:application/pdf;base64,')) {
    return null
  }
  const base64 = report.dataUrl.slice('data:application/pdf;base64,'.length)
  let content
  try {
    content = Buffer.from(base64, 'base64')
  } catch {
    return null
  }
  if (!content.length || content.length > 3_000_000 || content.subarray(0, 5).toString() !== '%PDF-') return null
  return { ...report, fileSize: content.length }
}

const SPECTROPHOTOMETER_ANALYSES = new Set([
  'physchem-npk','physchem-phosphorus-total','physchem-phosphorus-available','physchem-orthophosphate',
  'physchem-calcium','physchem-magnesium','physchem-sulfur','physchem-aluminum','physchem-micronutrients','physchem-sulfate',
])

function equipmentRequirementsFor(service, stageKey) {
  const items = Array.isArray(service.service_items) ? service.service_items : []
  const spectrophotometer = items.some((item) => SPECTROPHOTOMETER_ANALYSES.has(item.catalogServiceId))
  const requirements = []
  if (stageKey === 'medios') requirements.push({ key: 'autoclave', label: 'Autoclavado', types: ['autoclave'] })
  if (stageKey === 'inoculacion') requirements.push({ key: 'flow_cabinet', label: 'Cabina de flujo laminar', types: ['flow_cabinet'] })
  if (stageKey === 'incubacion') requirements.push({ key: 'incubation', label: 'Incubadora o shaker incubador', types: ['incubator','shaker_incubator'] })
  if (stageKey === 'analisis' && spectrophotometer) requirements.push({ key: 'spectrophotometer', label: 'Espectrofotómetro', types: ['spectrophotometer'] })
  return requirements
}

async function equipmentRequirementStatus(service, stageKey, stageId = null) {
  const requirements = equipmentRequirementsFor(service, stageKey)
  if (!requirements.length) return []
  const completed = await query(
    `SELECT DISTINCT r.equipment_type
     FROM laboratory_equipment_runs r
     JOIN laboratory_equipment_run_services rs ON rs.run_id=r.id
     WHERE rs.service_id=$1 AND r.status='completed'
       AND ($2::uuid IS NULL OR rs.stage_id=$2)`,
    [service.id, stageId],
  )
  const types = new Set(completed.map((item) => item.equipment_type))
  return requirements.map((item) => ({ ...item, completed: item.types.some((type) => types.has(type)) }))
}

export default async function handler(req, res) {
  if (req.query?.publicDocument === '1') return publicDocumentHandler(req, res)
  if (req.query?.sampleIntake === '1') return sampleIntakeHandler(req, res)
  const action = req.method === 'GET' ? 'view' : 'edit'
  const finalReportDownload = req.method === 'GET' && req.query?.format === 'final-report'
  const user = await requireUser(req, res)
  if (!user) return
  const moduleId = user.activeWorker ? 'lab_operations' : finalReportDownload ? 'results' : 'orders'
  if (!can(user, moduleId, action)) return json(res, 403, { error: 'No tienes permiso para realizar esta acción.' })
  const serviceId = req.query?.serviceId
  if (!serviceId) return json(res, 400, { error: 'Falta el servicio.' })

  await ensureReportColumns()

  const service = await accessibleService(user, serviceId)
  if (!service) return json(res, 404, { error: 'Servicio no encontrado.' })

  if (req.method === 'GET' && req.query?.format === 'pdf') {
    return generateStagePdf({
      res,
      user,
      serviceId,
      stageId: req.query?.stageId,
    })
  }

  if (req.method === 'GET' && req.query?.format === 'lab-step') {
    const records = await query(
      `SELECT s.code AS service_code, p.process_code, p.title AS process_title,
              p.analysis_names, ps.id AS step_id, ps.step_key,
              ps.title AS step_title, ps.document_code, ps.status AS step_status,
              ps.step_data, ps.observations, ps.completed_by_name, ps.completed_at
       FROM laboratory_service_processes p
       JOIN service_requests s ON s.id = p.service_id
       JOIN laboratory_process_steps ps ON ps.process_id = p.id
       WHERE p.service_id = $1 AND p.id = $2 AND ps.id = $3`,
      [serviceId, req.query?.processId, req.query?.labStepId],
    )
    const record = records[0]
    if (!record) return json(res, 404, { error: 'El formato de trazabilidad no está disponible.' })
    const pdf = await createMicrobiologyStepPdf({ record })
    const safeName = `${record.service_code}-${record.document_code}.pdf`.replace(/[^A-Za-z0-9._-]/g, '_')
    res.status(200)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Length', String(pdf.length))
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`)
    return res.end(pdf)
  }

  if (req.method === 'GET' && req.query?.format === 'equipment-run') {
    const runId = String(req.query?.runId || '')
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
      return json(res, 400, { error: 'El identificador del registro de equipo no es válido.' })
    }
    // The service check above guarantees a client only receives documents linked to their own order.
    const record = await equipmentRunPdfRecord(serviceId, runId)
    if (!record) return json(res, 404, { error: 'El registro de equipo no está vinculado a este servicio.' })
    const pdf = await createEquipmentRunPdfBuffer(record)
    const safeName = `${service.code}-${record.record_code}-equipo.pdf`.replace(/[^A-Za-z0-9._-]/g, '_')
    res.status(200)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Length', String(pdf.length))
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`)
    return res.end(pdf)
  }

  if (req.method === 'GET' && req.query?.format === 'final-report') {
    const reportId = req.query?.reportId || null
    if (reportId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reportId)) {
      return json(res, 400, { error: 'El identificador del informe no es válido.' })
    }
    const internalReportAccess = user.role === 'admin' || Boolean(user.activeWorker)
    const reports = await query(
      `SELECT id, file_name, mime_type, data_url
       FROM service_final_reports
       WHERE service_id = $1
         AND ($2 = true OR (is_current = true AND approval_status='approved'))
         AND ($3::uuid IS NULL OR id = $3)
       ORDER BY version DESC
       LIMIT 1`,
      [serviceId, internalReportAccess, reportId],
    )
    const report = reports[0]
    if (!report) return json(res, 404, { error: 'El informe final no está disponible.' })
    const content = Buffer.from(report.data_url.split(',')[1] || '', 'base64')
    const safeName = report.file_name.replace(/[\r\n"]/g, '').replace(/[^\x20-\x7E]/g, '_')
    res.status(200)
    res.setHeader('Content-Type', report.mime_type)
    res.setHeader('Content-Length', String(content.length))
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(report.file_name)}`,
    )
    return res.end(content)
  }

  if (req.method === 'GET') {
    const workflow = await workflowPayload(serviceId, user)
    const currentStage = workflow.stages.find((stage) => stage.position === Number(service.current_stage_position || 0))
    return json(res, 200, { service, ...workflow, equipmentRequirements: await equipmentRequirementStatus(service, currentStage?.stage_key, currentStage?.id) })
  }

  const payload = await body(req)
  const isWorker = Boolean(user.activeWorker)
  const workerActions = new Set(['save_stage', 'move', 'save_results', 'generate_final_report'])
  if (user.role !== 'admin' && (!isWorker || !workerActions.has(payload.action))) {
    return json(res, 403, { error: isWorker ? 'Desde el portal de trabajador solo puedes actualizar y avanzar las etapas de tus órdenes asignadas.' : 'Solo un administrador puede modificar las etapas.' })
  }

  if (req.method === 'PATCH' && payload.action === 'upload_final_report') {
    if (!['accepted', 'in_progress', 'completed'].includes(service.status)) {
      return json(res, 400, { error: 'El servicio debe estar activo para adjuntar el informe final.' })
    }
    const report = validFinalReport(payload.report)
    if (!report) {
      return json(res, 400, { error: 'Adjunta un PDF válido de hasta 3 MB.' })
    }
    const notes = payload.notes?.trim() || null
    if (notes && notes.length > 500) {
      return json(res, 400, { error: 'La nota del informe no puede superar los 500 caracteres.' })
    }
    const inserted = await query(
      `WITH next_version AS (
         SELECT COALESCE(MAX(version), 0) + 1 AS version
         FROM service_final_reports
         WHERE service_id = $1
       )
       INSERT INTO service_final_reports
         (service_id, version, file_name, mime_type, file_size, data_url, notes, is_current, approval_status, approval_requested_at, uploaded_by_user_id)
       SELECT $1, next_version.version, $2, $3, $4, $5, $6, false, 'pending', NOW(), $7
       FROM next_version
       RETURNING id, version, file_name, file_size, created_at`,
      [
        serviceId,
        report.fileName.trim(),
        report.mimeType,
        report.fileSize,
        report.dataUrl,
        notes,
        user.id,
      ],
    )
    await query(
      `INSERT INTO service_stage_events
       (service_id, stage_id, action, from_position, to_position, actor_user_id, note)
       VALUES ($1,NULL,'final_report_uploaded',NULL,NULL,$2,$3)`,
      [serviceId, user.id, `Informe final v${inserted[0].version} enviado a aprobación: ${inserted[0].file_name}`],
    )
    await notifyReportApprovers(service, inserted[0].version)
    return json(res, 200, { service, ...(await workflowPayload(serviceId, user)) })
  }

  if (req.method === 'PATCH' && payload.action === 'save_results') {
    const results = validResults(payload.results)
    if (!results) return json(res, 400, { error: 'Agrega al menos un resultado con parámetro y valor. Puedes registrar hasta 60 filas.' })
    const allowedSampleCodes = new Set(Array.from({ length: Math.max(1, Number(service.sample_count || 1)) }, (_, index) => `${service.code}-${index + 1}`))
    if (results.some((result) => !result.sampleCode || !allowedSampleCodes.has(result.sampleCode))) {
      return json(res, 400, { error: 'Selecciona un código de muestra válido para cada resultado.' })
    }
    const photos = Array.isArray(payload.photos) ? payload.photos : []
    const existingPhotos = photos.filter((photo) => /^[0-9a-f-]{36}$/i.test(String(photo?.id || '')))
    const newPhotos = photos.filter((photo) => !photo?.id)
    if (photos.length > 10 || newPhotos.some((photo) => !validPhoto(photo)) || existingPhotos.length + newPhotos.length !== photos.length) {
      return json(res, 400, { error: 'Adjunta como máximo 10 fotografías JPG, PNG o WebP.' })
    }
    if (existingPhotos.length) {
      const stored = await query(
        `SELECT id FROM service_analysis_photos WHERE service_id=$1 AND id=ANY($2::uuid[])`,
        [serviceId, existingPhotos.map((photo) => photo.id)],
      )
      if (stored.length !== existingPhotos.length) return json(res, 400, { error: 'Una de las fotografías ya no pertenece a este servicio.' })
    }
    await query(
      `WITH removed AS (
         DELETE FROM service_analysis_results WHERE service_id=$1
       ), rows AS (
         SELECT * FROM jsonb_to_recordset($2::jsonb) AS x(
           "serviceItemId" text,"groupKey" text,"groupLabel" text,"sampleCode" text,parameter text,"resultValue" text,unit text,
           "minimumValue" text,"maximumValue" text,"referenceValue" text,"identifiedAgent" text,method text,observations text,"sortOrder" int
         )
       )
       INSERT INTO service_analysis_results
         (service_id,service_item_id,result_group_key,result_group_label,sample_code,parameter,result_value,unit,minimum_value,maximum_value,reference_value,identified_agent,method,observations,sort_order,recorded_by_user_id,recorded_by_analyst_id)
       SELECT $1,NULLIF("serviceItemId",'')::uuid,"groupKey","groupLabel","sampleCode",parameter,"resultValue",unit,"minimumValue","maximumValue","referenceValue","identifiedAgent",method,observations,"sortOrder",$3,$4
       FROM rows`,
      [serviceId, JSON.stringify(results), user.id, user.activeWorker?.id || null],
    )
    const retainedIds = existingPhotos.map((photo) => photo.id)
    if (retainedIds.length) {
      await query(
        `DELETE FROM service_analysis_photos
         WHERE service_id=$1 AND NOT (id=ANY($2::uuid[]))`,
        [serviceId, retainedIds],
      )
    } else {
      await query(`DELETE FROM service_analysis_photos WHERE service_id=$1`, [serviceId])
    }
    for (const [index, photo] of existingPhotos.entries()) {
      const metadata = photoMetadata(photo, index)
      await query(
        `UPDATE service_analysis_photos SET title=$3,note=$4,display_order=$5
         WHERE service_id=$1 AND id=$2`,
        [serviceId, photo.id, metadata.title, metadata.note, metadata.displayOrder],
      )
    }
    for (const [offset, photo] of newPhotos.entries()) {
      const metadata = photoMetadata(photo, existingPhotos.length + offset)
      await query(
        `INSERT INTO service_analysis_photos
         (service_id,file_name,title,note,display_order,mime_type,data_url,uploaded_by_user_id,uploaded_by_analyst_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [serviceId,photo.fileName,metadata.title,metadata.note,metadata.displayOrder,photo.mimeType,photo.dataUrl,user.id,user.activeWorker?.id || null],
      )
    }
    await query(
      `INSERT INTO service_stage_events (service_id,stage_id,action,actor_user_id,note)
       VALUES ($1,NULL,'results_saved',$2,$3)`,
      [serviceId, user.id, `${results.length} resultado${results.length === 1 ? '' : 's'} registrado${results.length === 1 ? '' : 's'}`],
    )
    return json(res, 200, { service, ...(await workflowPayload(serviceId, user)) })
  }

  if (req.method === 'PATCH' && payload.action === 'generate_final_report') {
    const context = await finalReportContext(serviceId)
    if (!context.results.length) return json(res, 409, { error: 'Primero guarda los resultados del análisis.' })
    const report = {
      interpretation: String(payload.interpretation || '').trim().slice(0, 1800),
      notes: String(payload.notes || '').trim().slice(0, 1200),
      observations: String(payload.observations || '').trim().slice(0, 1800),
    }
    const next = await query(`SELECT COALESCE(MAX(version),0)+1 AS version FROM service_final_reports WHERE service_id=$1`, [serviceId])
    const version = Number(next[0].version)
    const pdf = await createFinalReportPdf({ ...context, report, approvalStatus: 'pending' })
    const fileName = `INFORME_${reportCode(context.service)}_v${version}.pdf`.replace(/[^A-Za-z0-9._-]/g, '_')
    const inserted = await query(
      `INSERT INTO service_final_reports
       (service_id,version,file_name,mime_type,file_size,data_url,notes,interpretation,observations,is_current,approval_status,approval_requested_at,uploaded_by_user_id)
       VALUES ($1,$2,$3,'application/pdf',$4,$5,$6,$7,$8,false,'pending',NOW(),$9)
       RETURNING id,version,file_name,file_size,created_at`,
      [serviceId, version, fileName, pdf.length, `data:application/pdf;base64,${pdf.toString('base64')}`, report.notes || 'Informe generado automáticamente desde los resultados registrados.', report.interpretation || null, report.observations || null, user.id],
    )
    await query(`INSERT INTO service_stage_events (service_id,stage_id,action,actor_user_id,note) VALUES ($1,NULL,'final_report_submitted',$2,$3)`, [serviceId,user.id,`Informe automático v${version} enviado a aprobación`])
    await notifyReportApprovers(service, version)
    return json(res, 200, { service, ...(await workflowPayload(serviceId, user)), generatedReportId: inserted[0].id })
  }

  if (req.method === 'PATCH' && payload.action === 'review_final_report') {
    if (!canApproveReport(user)) return json(res, 403, { error: 'Solo Luis Guevara, Andy Espinales o Antonio Guevara pueden aprobar informes.' })
    const reports = await query(`SELECT * FROM service_final_reports WHERE id=$1 AND service_id=$2`, [payload.reportId, serviceId])
    const report = reports[0]
    if (!report || report.approval_status !== 'pending') return json(res, 409, { error: 'Este informe ya no está pendiente de aprobación.' })
    if (payload.decision === 'reject') {
      const rejection = String(payload.notes || '').trim() || 'Requiere corrección antes de su publicación.'
      await query(`UPDATE service_final_reports SET approval_status='rejected',rejection_notes=$3,is_current=false WHERE id=$1 AND service_id=$2`, [report.id,serviceId,rejection.slice(0,500)])
      await query(`UPDATE public_document_links SET active=false WHERE final_report_id=$1 AND active=true`, [report.id])
      await query(`INSERT INTO service_stage_events (service_id,stage_id,action,actor_user_id,note) VALUES ($1,NULL,'final_report_rejected',$2,$3)`, [serviceId,user.id,rejection.slice(0,500)])
      return json(res, 200, { service, ...(await workflowPayload(serviceId, user)) })
    }
    if (payload.decision !== 'approve') return json(res, 400, { error: 'La decisión no es válida.' })
    const approvedAt = new Date()
    const isAutomaticReport = /^INFORME_INF-/i.test(report.file_name || '')
    let approvedDataUrl = report.data_url
    let approvedFileSize = report.file_size
    if (isAutomaticReport) {
      const context = await finalReportContext(serviceId)
      const pdf = await createFinalReportPdf({ ...context, report: { interpretation: report.interpretation, notes: report.notes, observations: report.observations }, approvalStatus: 'approved', approver: { full_name: user.nombre, email: user.email, approved_at: approvedAt } })
      approvedDataUrl = `data:application/pdf;base64,${pdf.toString('base64')}`
      approvedFileSize = pdf.length
    }
    await query(`UPDATE service_final_reports SET is_current=false WHERE service_id=$1 AND is_current=true`, [serviceId])
    await query(
      `UPDATE service_final_reports SET approval_status='approved',approved_by_user_id=$3,approved_at=$4,
              rejection_notes=NULL,is_current=true,data_url=$5,file_size=$6
       WHERE id=$1 AND service_id=$2`,
      [report.id,serviceId,user.id,approvedAt,approvedDataUrl,approvedFileSize],
    )
    await query(`INSERT INTO service_stage_events (service_id,stage_id,action,actor_user_id,note) VALUES ($1,NULL,'final_report_approved',$2,$3)`, [serviceId,user.id,`Informe v${report.version} aprobado por ${user.nombre}`])
    await query(
      `INSERT INTO notifications (user_id,title,body,type,priority,audience,action_url)
       VALUES ($1,'Informe final disponible',$2,'result','high','client','resultados')`,
      [service.client_user_id,`${service.code} · ${service.service_type_name}`],
    )
    await sendResultsReadyEmail(serviceId, report.id)
    return json(res, 200, { service, ...(await workflowPayload(serviceId, user)) })
  }

  if (req.method === 'PATCH' && payload.action === 'move') {
    const stages = await query(
      'SELECT id, stage_key, title, position, status, performed_by, analyst_id, analyst FROM service_workflow_stages WHERE service_id = $1 ORDER BY position',
      [serviceId],
    )
    if (!stages.length) return json(res, 400, { error: 'El servicio todavía no tiene etapas.' })

    const current = Number(service.current_stage_position || 0)
    const last = stages.length - 1
    let next = current
    let nextServiceStatus = service.status
    let automaticPerformer = null

    if (payload.direction === 'back') {
      next = service.status === 'completed' ? last : Math.max(0, current - 1)
      nextServiceStatus = next === 0 ? 'accepted' : 'in_progress'
    } else if (payload.direction === 'forward') {
      const currentStage = stages.find((stage) => stage.position === current)
      const performedBy = String(isWorker ? user.activeWorker.fullName : user.nombre || user.email || currentStage?.performed_by || 'Usuario registrado').trim()
      automaticPerformer = performedBy
      await query(
        `UPDATE sample_intakes
         SET processing_status='processing',
             processing_started_at=COALESCE(processing_started_at,NOW()),
             processing_by_analyst_id=COALESCE(processing_by_analyst_id,$2),
             processing_by_name=COALESCE(processing_by_name,$3),
             updated_by_user_id=$4,updated_at=NOW()
         WHERE service_id=$1 AND processing_status<>'completed'`,
        [serviceId,isWorker ? user.activeWorker.id : null,performedBy,user.id],
      )
      await query(
        `UPDATE service_workflow_stages
         SET performed_by=$3,
             analyst=COALESCE(analyst,$3),
             analyst_id=COALESCE(analyst_id,$4),
             updated_by_user_id=$5,
             updated_at=NOW()
         WHERE id=$1 AND service_id=$2`,
        [currentStage.id, serviceId, performedBy, isWorker ? user.activeWorker.id : null, user.id],
      )
      if (current >= last) {
        next = last
        nextServiceStatus = 'completed'
      } else {
        next = current + 1
        nextServiceStatus = 'in_progress'
      }
    } else {
      return json(res, 400, { error: 'El movimiento de etapa no es válido.' })
    }

    await query(
      `UPDATE service_workflow_stages
       SET status = CASE
             WHEN $2 = 'completed' THEN 'completed'
             WHEN position < $3 THEN 'completed'
             WHEN position = $3 THEN 'current'
             ELSE 'pending'
           END,
           started_at = CASE WHEN position = $3 THEN COALESCE(started_at, NOW()) ELSE started_at END,
           completed_at = CASE
             WHEN $2 = 'completed' OR position < $3 THEN COALESCE(completed_at, NOW())
             ELSE NULL
           END,
           updated_by_user_id = $4,
           updated_at = NOW()
       WHERE service_id = $1`,
      [serviceId, nextServiceStatus, next, user.id],
    )
    await query(
      `UPDATE service_requests
       SET current_stage_position = $2, status = $3, updated_at = NOW()
       WHERE id = $1`,
      [serviceId, next, nextServiceStatus],
    )
    const destinationStage = stages[next]
    const closesAnalysis = payload.direction === 'forward'
      && (/informe|report|resultado|emisi/i.test(`${destinationStage?.stage_key || ''} ${destinationStage?.title || ''}`)
        || nextServiceStatus === 'completed')
    if (closesAnalysis) {
      await query(
        `UPDATE sample_intakes SET processing_status='completed',processing_ended_at=COALESCE(processing_ended_at,NOW()),
                updated_by_user_id=$2,updated_at=NOW()
         WHERE service_id=$1 AND processing_started_at IS NOT NULL AND processing_status<>'completed'`,
        [serviceId,user.id],
      )
    }
    await query(
      `INSERT INTO service_stage_events
       (service_id, stage_id, action, from_position, to_position, actor_user_id, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        serviceId,
        stages[next]?.id,
        payload.direction === 'back' ? 'stage_moved_back' : 'stage_moved_forward',
        current,
        next,
        user.id,
        [payload.note?.trim(), automaticPerformer ? `Etapa realizada por ${automaticPerformer}` : ''].filter(Boolean).join(' · ') || null,
      ],
    )
    const workflow = await workflowPayload(serviceId, user)
    const movedStage = workflow.stages.find((stage) => stage.position === next)
    return json(res, 200, {
      service: { ...service, status: nextServiceStatus, current_stage_position: next },
      ...workflow,
      equipmentRequirements: await equipmentRequirementStatus(service, movedStage?.stage_key, movedStage?.id),
    })
  }

  if (req.method === 'PATCH' && payload.action === 'save_stage') {
    const stageRows = await query(
      `SELECT id, performed_by, analyst_id, analyst, observations, started_at, completed_at
       FROM service_workflow_stages WHERE id = $1 AND service_id = $2`,
      [payload.stageId, serviceId],
    )
    const currentStage = stageRows[0]
    if (!currentStage) return json(res, 404, { error: 'Etapa no encontrada.' })

    const photos = Array.isArray(payload.photos) ? payload.photos : []
    if (photos.length > 3 || photos.some((photo) => !validPhoto(photo))) {
      return json(res, 400, { error: 'Adjunta como máximo 3 imágenes JPG, PNG o WebP de hasta 800 KB cada una.' })
    }

    const hasAnalystUpdate = isWorker || (Object.hasOwn(payload, 'analystId') && payload.analystId !== '__existing__')
    let analystId = currentStage.analyst_id
    let analystName = currentStage.analyst
    const requestedAnalystId = isWorker ? user.activeWorker.id : payload.analystId
    if (hasAnalystUpdate && requestedAnalystId) {
      const analystRows = await query(
        `SELECT a.id,a.full_name
         FROM worker_service_assignments wsa JOIN analysts a ON a.id=wsa.analyst_id
         WHERE wsa.service_id=$1 AND wsa.analyst_id=$2 AND wsa.active=true AND a.status='active'`,
        [serviceId, requestedAnalystId],
      )
      if (!analystRows[0]) return json(res, 400, { error: 'El analista no está asignado a este servicio.' })
      analystId = analystRows[0].id
      analystName = analystRows[0].full_name
    } else if (hasAnalystUpdate) {
      analystId = null
      analystName = null
    }

    const parseDate = (value, label) => {
      if (value === '' || value === null) return null
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
        throw new Error(`La fecha de ${label} no es válida.`)
      }
      return value
    }
    let startedAt
    let completedAt
    try {
      startedAt = !isWorker && Object.hasOwn(payload, 'startedAt') ? parseDate(payload.startedAt, 'inicio') : currentStage.started_at
      completedAt = !isWorker && Object.hasOwn(payload, 'completedAt') ? parseDate(payload.completedAt, 'finalización') : currentStage.completed_at
    } catch (dateError) {
      return json(res, 400, { error: dateError.message })
    }
    if (startedAt && completedAt && new Date(completedAt) < new Date(startedAt)) {
      return json(res, 400, { error: 'La fecha de finalización no puede ser anterior al inicio.' })
    }

    await query(
      `UPDATE service_workflow_stages
       SET performed_by = CASE WHEN $3 THEN $4 ELSE performed_by END,
           analyst_id = CASE WHEN $5 THEN $6 ELSE analyst_id END,
           analyst = CASE WHEN $5 THEN $7 ELSE analyst END,
           observations = CASE WHEN $8 THEN $9 ELSE observations END,
           started_at = CASE WHEN $10 THEN $11 ELSE started_at END,
           completed_at = CASE WHEN $12 THEN $13 ELSE completed_at END,
           updated_by_user_id = $14, updated_at = NOW()
       WHERE id = $1 AND service_id = $2`,
      [
        payload.stageId,
        serviceId,
        isWorker || Object.hasOwn(payload, 'performedBy'),
        isWorker ? user.activeWorker.fullName : payload.performedBy?.trim() || null,
        hasAnalystUpdate,
        analystId,
        analystName,
        Object.hasOwn(payload, 'observations'),
        payload.observations?.trim() || null,
        !isWorker && Object.hasOwn(payload, 'startedAt'),
        startedAt,
        !isWorker && Object.hasOwn(payload, 'completedAt'),
        completedAt,
        user.id,
      ],
    )

    for (const photo of photos) {
      await query(
        `INSERT INTO service_stage_photos
         (stage_id, file_name, mime_type, data_url, uploaded_by_user_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [payload.stageId, photo.fileName, photo.mimeType, photo.dataUrl, user.id],
      )
    }
    await query(
      `INSERT INTO service_stage_events
       (service_id, stage_id, action, from_position, to_position, actor_user_id, note)
       VALUES ($1,$2,'stage_details_updated',NULL,NULL,$3,$4)`,
      [serviceId, payload.stageId, user.id, payload.changeNote?.trim() || 'Información de la etapa actualizada sin eliminar datos previos'],
    )
    const workflow = await workflowPayload(serviceId, user)
    return json(res, 200, { service, ...workflow })
  }

  if (req.method === 'PATCH' && payload.action === 'assign_crew') {
    const assignmentTypes = ['sampling', 'application', 'logistics', 'laboratory']
    const assignmentType = assignmentTypes.includes(payload.assignmentType) ? payload.assignmentType : 'sampling'
    if (!payload.crewId) return json(res, 400, { error: 'Selecciona una cuadrilla.' })
    if (!['accepted', 'in_progress'].includes(service.status)) {
      return json(res, 400, { error: 'El servicio debe estar activo para asignar una cuadrilla.' })
    }
    const crews = await query(
      `SELECT c.id, c.operational_state, h.id AS home_id, h.lat AS home_lat, h.lng AS home_lng
       FROM field_crews c LEFT JOIN field_sites h ON h.id = c.home_laboratory_site_id
       WHERE c.id = $1 AND c.active = true`,
      [payload.crewId],
    )
    if (!crews[0]) return json(res, 400, { error: 'La cuadrilla seleccionada no está disponible.' })
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
      [payload.crewId, serviceId, assignmentType, payload.scheduledAt || null, payload.notes?.trim() || null, user.id],
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
      [service.client_user_id, `${service.service_type_name} ya tiene equipo de campo asignado.`],
    )
    return json(res, 200, { service, ...(await workflowPayload(serviceId, user)) })
  }

  if (req.method === 'DELETE') {
    const photoId = payload.photoId
    if (!photoId) return json(res, 400, { error: 'Falta la fotografía.' })
    await query(
      `DELETE FROM service_stage_photos p
       USING service_workflow_stages ws
       WHERE p.id = $1 AND p.stage_id = ws.id AND ws.service_id = $2`,
      [photoId, serviceId],
    )
    const workflow = await workflowPayload(serviceId, user)
    return json(res, 200, { service, ...workflow })
  }

  return methodNotAllowed(res, ['GET', 'PATCH', 'DELETE'])
}
