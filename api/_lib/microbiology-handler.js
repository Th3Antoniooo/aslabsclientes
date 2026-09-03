import crypto from 'node:crypto'
import { can, requireUser } from './auth.js'
import { query } from './db.js'
import { body, json, methodNotAllowed } from './http.js'
import { MICROBIOLOGY_ANALYSES, MICROBIOLOGY_STEPS } from '../../src/data/microbiology.js'

function recordCode(prefix) {
  const day = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Lima' }).format(new Date()).replaceAll('-', '')
  return `${prefix}-${day}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`
}

function required(data, fields) { return fields.every((field) => String(data?.[field] ?? '').trim()) }
function validDate(value) { return value && !Number.isNaN(new Date(value).getTime()) }

function allowedMicrobiologyAnalyses(serviceItems = []) {
  return MICROBIOLOGY_ANALYSES.filter((analysis) => serviceItems.some((item) => {
    const catalogId = String(item.catalogServiceId || item.catalog_service_id || '')
    const name = String(item.name || item.service_name || '').toLowerCase()
    return catalogId === `micro-${analysis.code}` || analysis.keywords.some((keyword) => name.includes(keyword))
  }))
}

function validPdf(report) {
  if (!report || typeof report.fileName !== 'string' || !report.fileName.toLowerCase().endsWith('.pdf') || report.mimeType !== 'application/pdf' || typeof report.dataUrl !== 'string' || !report.dataUrl.startsWith('data:application/pdf;base64,')) return null
  let content
  try { content = Buffer.from(report.dataUrl.slice('data:application/pdf;base64,'.length), 'base64') } catch { return null }
  if (!content.length || content.length > 3_000_000 || content.subarray(0, 5).toString() !== '%PDF-') return null
  return { ...report, fileSize: content.length }
}

async function getOperator(operatorUserId, user) {
  if (user.activeWorker) {
    return { id: user.id, full_name: user.activeWorker.fullName, analyst_id: user.activeWorker.id }
  }
  const id = operatorUserId || user.id
  const rows = await query(
    `SELECT u.id, u.full_name FROM users u JOIN roles r ON r.id = u.role_id
     LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.module_id = 'lab_operations'
     WHERE u.id = $1 AND u.status = 'active' AND (r.slug = 'admin' OR rp.can_view = true)`,
    [id],
  )
  return rows[0] || null
}

async function ensureServiceAccess(user, serviceId) {
  const available = await query(`SELECT id FROM service_requests WHERE id=$1 AND archived_at IS NULL`, [serviceId])
  if (!available[0]) throw Object.assign(new Error('Este código está archivado o ya no está disponible.'), { status: 404 })
  if (!user.activeWorker) return
  if (user.activeWorker.biotechnologyAccess) {
    throw Object.assign(new Error('Tu perfil trabaja únicamente con códigos de plantas.'), { status: 403 })
  }
  const rows = await query(
    `SELECT 1 FROM worker_service_assignments
     WHERE analyst_id=$1 AND service_id=$2 AND active=true`,
    [user.activeWorker.id, serviceId],
  )
  if (!rows[0]) throw Object.assign(new Error('Este código no está asignado a tu perfil.'), { status: 403 })
}

async function processRows(serviceId = null, workerAnalystId = null) {
  return query(
    `SELECT p.id, p.process_code, p.service_id, p.process_type, p.title,
            p.analysis_codes, p.analysis_names, p.status, p.current_step_position,
            p.created_at, p.updated_at, s.code AS service_code,
            COALESCE(steps.steps, '[]'::jsonb) AS steps
     FROM laboratory_service_processes p
     JOIN service_requests s ON s.id = p.service_id
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object(
         'id', ps.id, 'step_key', ps.step_key, 'position', ps.position,
         'title', ps.title, 'document_code', ps.document_code, 'status', ps.status,
         'step_data', ps.step_data, 'observations', ps.observations,
         'completed_by_name', ps.completed_by_name, 'started_at', ps.started_at,
         'completed_at', ps.completed_at, 'updated_at', ps.updated_at
       ) ORDER BY ps.position) AS steps
       FROM laboratory_process_steps ps WHERE ps.process_id = p.id
     ) steps ON true
     WHERE p.process_type = 'microbiology' AND s.archived_at IS NULL
       AND ($1::uuid IS NULL OR p.service_id = $1)
       AND ($2::uuid IS NULL OR EXISTS (
         SELECT 1 FROM worker_service_assignments wsa
         WHERE wsa.analyst_id=$2 AND wsa.service_id=p.service_id AND wsa.active=true
       ))
     ORDER BY p.updated_at DESC`,
    [serviceId, workerAnalystId],
  )
}

async function listData(user) {
  const [services, processes, equipment, operators, analysts] = await Promise.all([
    query(
      `SELECT s.id,s.code,s.status,s.requested_at,s.quote_reference,s.zone_name,
              COALESCE(NULLIF(s.display_name,''),s.service_type_name) AS service_type_name,
              s.sample_count,s.priority,ws.title AS current_stage_title,
              CASE WHEN $2=true THEN u.full_name ELSE NULL END AS client_name,
              CASE WHEN $2=true THEN u.company ELSE NULL END AS client_company,
              COALESCE(items.items,'[]'::jsonb) AS service_items,
              COALESCE(assigned.items,'[]'::jsonb) AS assigned_analysts,
              COALESCE(process_count.total,0)::int AS laboratory_process_count
       FROM service_requests s
       JOIN users u ON u.id=s.client_user_id
       LEFT JOIN service_workflow_stages ws ON ws.service_id=s.id AND ws.position=s.current_stage_position
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object(
           'id', i.id, 'catalogServiceId', i.catalog_service_id,
           'categoryId', i.category_id, 'categoryName', i.category_name, 'name', i.service_name
         ) ORDER BY i.sort_order, i.created_at) AS items
         FROM service_request_items i WHERE i.service_id = s.id
       ) items ON true
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object('id',a.id,'fullName',a.full_name,'specialty',a.specialty) ORDER BY a.full_name) AS items
         FROM worker_service_assignments wsa JOIN analysts a ON a.id=wsa.analyst_id
         WHERE wsa.service_id=s.id AND wsa.active=true AND a.status='active'
       ) assigned ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS total FROM laboratory_service_processes p WHERE p.service_id=s.id
       ) process_count ON true
       WHERE s.status IN ('accepted', 'in_progress', 'completed') AND s.archived_at IS NULL
         AND ($1::uuid IS NULL OR EXISTS (
           SELECT 1 FROM worker_service_assignments wsa
           WHERE wsa.analyst_id=$1 AND wsa.service_id=s.id AND wsa.active=true
         ))
       ORDER BY CASE s.status WHEN 'in_progress' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END, s.updated_at DESC`,
      [user.activeWorker?.id || null,user.role==='admin'],
    ),
    processRows(null, user.activeWorker?.id || null),
    query(`SELECT id, code, name, equipment_type, location, status FROM laboratory_equipment ORDER BY status = 'active' DESC, code`),
    user.activeWorker
      ? Promise.resolve([{ id: user.id, full_name: user.activeWorker.fullName }])
      : query(
        `SELECT DISTINCT u.id, u.full_name FROM users u JOIN roles r ON r.id = u.role_id
         LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.module_id = 'lab_operations'
         WHERE u.status = 'active' AND (r.slug = 'admin' OR rp.can_view = true) ORDER BY u.full_name`,
      ),
    user.activeWorker
      ? Promise.resolve([{ id: user.activeWorker.id, full_name: user.activeWorker.fullName, specialty: user.activeWorker.specialty, license_number: null }])
      : query(`SELECT id, full_name, specialty, license_number FROM analysts WHERE status = 'active' ORDER BY full_name`),
  ])
  const linkedServices = services.map((service) => ({
    ...service,
    allowed_analyses: allowedMicrobiologyAnalyses(service.service_items),
  }))
  return { services: linkedServices, processes, equipment, operators, analysts, analysisOptions: MICROBIOLOGY_ANALYSES, stepTemplate: MICROBIOLOGY_STEPS }
}

async function log(processId, stepId, action, userId, note = null) {
  await query(`INSERT INTO laboratory_process_events (process_id, step_id, action, actor_user_id, note) VALUES ($1,$2,$3,$4,$5)`, [processId, stepId, action, userId, note])
}

async function createProcess(payload, user) {
  const requested = Array.isArray(payload.analysisCodes) ? [...new Set(payload.analysisCodes)] : []
  if (!payload.serviceId || !requested.length) throw Object.assign(new Error('Selecciona el código del servicio y al menos un análisis microbiológico.'), { status: 400 })
  await ensureServiceAccess(user, payload.serviceId)
  const services = await query(
    `SELECT s.id,s.status,COALESCE(items.items,'[]'::jsonb) AS service_items
     FROM service_requests s
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object('catalogServiceId',i.catalog_service_id,'name',i.service_name)) AS items
       FROM service_request_items i WHERE i.service_id=s.id
     ) items ON true
     WHERE s.id=$1 AND s.archived_at IS NULL AND s.status IN ('accepted','in_progress','completed')`,
    [payload.serviceId],
  )
  if (!services[0]) throw Object.assign(new Error('El código del servicio no está disponible para operaciones.'), { status: 400 })
  const allowed = allowedMicrobiologyAnalyses(services[0].service_items)
  const selected = allowed.filter((item) => requested.includes(item.code))
  if (selected.length !== requested.length) {
    throw Object.assign(new Error('Solo puedes crear operaciones para los análisis incluidos en la orden del cliente.'), { status: 400 })
  }
  const code = recordCode('MIC')
  const title = payload.title?.trim() || `Flujo microbiológico ${code}`
  const processes = await query(
    `INSERT INTO laboratory_service_processes
      (process_code, service_id, process_type, title, analysis_codes, analysis_names, status, current_step_position, created_by_user_id, updated_by_user_id)
     VALUES ($1,$2,'microbiology',$3,$4::jsonb,$5::jsonb,'in_progress',0,$6,$6) RETURNING *`,
    [code, payload.serviceId, title, JSON.stringify(selected.map((item) => item.code)), JSON.stringify(selected.map((item) => item.name)), user.id],
  )
  for (const step of MICROBIOLOGY_STEPS) {
    await query(
      `INSERT INTO laboratory_process_steps (process_id, step_key, position, title, document_code, status, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,CASE WHEN $6 = 'current' THEN NOW() ELSE NULL END)`,
      [processes[0].id, step.key, step.position, step.title, step.documentCode, step.position === 0 ? 'current' : 'pending'],
    )
  }
  await log(processes[0].id, null, 'process_created', user.id, `Análisis: ${selected.map((item) => item.name).join(', ')}`)
  return (await processRows(payload.serviceId, user.activeWorker?.id || null)).find((item) => item.id === processes[0].id)
}

function validateStepData(stepKey, data) {
  const fields = {
    autoclave: ['equipmentId', 'startedAt', 'endedAt', 'temperatureC', 'pressureBar', 'holdingMinutes', 'loadType', 'loadDescription', 'releaseResult'],
    plating: ['performedAt', 'cultureMedium', 'method', 'volumeMl', 'unitCount', 'operatorUserId'],
    incubation: ['incubatorCode', 'temperatureC', 'startedAt', 'endedAt', 'incubationPurpose', 'conditionResult'],
    reading: ['readingAt', 'method', 'resultSummary', 'units', 'analystId', 'reviewResult'],
  }[stepKey]
  if (!fields || !required(data, fields)) throw Object.assign(new Error('Completa los campos obligatorios de esta etapa.'), { status: 400 })
}

async function saveAutoclaveCycle(step, process, data, user) {
  const operator = await getOperator(data.operatorUserId, user)
  if (!operator) throw Object.assign(new Error('El operador seleccionado no está disponible.'), { status: 400 })
  const equipment = await query(`SELECT id, code FROM laboratory_equipment WHERE id = $1 AND equipment_type = 'autoclave' AND status = 'active'`, [data.equipmentId])
  if (!equipment[0]) throw Object.assign(new Error('Selecciona un autoclave operativo.'), { status: 400 })
  if (!validDate(data.startedAt) || !validDate(data.endedAt) || new Date(data.endedAt) < new Date(data.startedAt)) throw Object.assign(new Error('El horario del autoclavado no es válido.'), { status: 400 })
  const previousId = step.step_data?.autoclaveCycleId || null
  let cycle
  if (previousId) {
    const rows = await query(
      `UPDATE autoclave_cycles SET equipment_id=$2, service_id=$3, load_type=$4, load_description=$5,
       cycle_number=$6, program_name=$7, started_at=$8, ended_at=$9, temperature_c=$10,
       pressure_bar=$11, holding_minutes=$12, operator_user_id=$13, operator_name=$14,
       chemical_indicator=$15, biological_indicator=$16, result=$17, observations=$18,
       updated_by_user_id=$19, updated_at=NOW() WHERE id=$1 RETURNING id, record_code`,
      [previousId, data.equipmentId, process.service_id, data.loadType, data.loadDescription, data.cycleNumber || null,
        data.programName || null, data.startedAt, data.endedAt, Number(data.temperatureC), Number(data.pressureBar),
        Number(data.holdingMinutes), operator.id, operator.full_name, data.chemicalIndicator || 'pending',
        data.biologicalIndicator || 'not_applicable', data.releaseResult === 'released' ? 'conforming' : data.releaseResult === 'rejected' ? 'nonconforming' : 'pending',
        data.observations || null, user.id],
    )
    cycle = rows[0]
  } else {
    const rows = await query(
      `INSERT INTO autoclave_cycles
       (record_code,equipment_id,service_id,load_type,load_description,cycle_number,program_name,started_at,ended_at,
        temperature_c,pressure_bar,holding_minutes,operator_user_id,operator_name,chemical_indicator,biological_indicator,
        result,observations,created_by_user_id,updated_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)
       RETURNING id, record_code`,
      [recordCode('AUT'), data.equipmentId, process.service_id, data.loadType, data.loadDescription, data.cycleNumber || null,
        data.programName || null, data.startedAt, data.endedAt, Number(data.temperatureC), Number(data.pressureBar),
        Number(data.holdingMinutes), operator.id, operator.full_name, data.chemicalIndicator || 'pending',
        data.biologicalIndicator || 'not_applicable', data.releaseResult === 'released' ? 'conforming' : data.releaseResult === 'rejected' ? 'nonconforming' : 'pending',
        data.observations || null, user.id],
    )
    cycle = rows[0]
  }
  return { ...data, operatorUserId: operator.id, operatorName: operator.full_name, equipmentCode: equipment[0].code, autoclaveCycleId: cycle.id, autoclaveRecordCode: cycle.record_code }
}

async function enrichStepData(stepKey, data, user, serviceId) {
  if (stepKey === 'plating' || stepKey === 'incubation') {
    const operator = await getOperator(data.operatorUserId, user)
    if (!operator) throw Object.assign(new Error('El responsable seleccionado no está disponible.'), { status: 400 })
    return { ...data, operatorUserId: operator.id, operatorName: operator.full_name }
  }
  if (stepKey === 'reading') {
    if (user.activeWorker) {
      return { ...data, analystId: user.activeWorker.id, analystName: user.activeWorker.fullName }
    }
    const analysts = await query(
      `SELECT a.id,a.full_name FROM worker_service_assignments wsa JOIN analysts a ON a.id=wsa.analyst_id
       WHERE wsa.service_id=$1 AND wsa.analyst_id=$2 AND wsa.active=true AND a.status='active'`,
      [serviceId,data.analystId],
    )
    if (!analysts[0]) throw Object.assign(new Error('El analista seleccionado no está asignado a este servicio.'), { status: 400 })
    return { ...data, analystId: analysts[0].id, analystName: analysts[0].full_name }
  }
  return data
}

async function completeStep(process, step, data, observations, user) {
  await query(
    `UPDATE laboratory_process_steps SET step_data=$2::jsonb, observations=$3, status='completed',
       completed_by_user_id=$4, completed_by_name=$5, started_at=COALESCE(started_at,NOW()), completed_at=NOW(), updated_at=NOW()
     WHERE id=$1`,
    [step.id, JSON.stringify(data), observations?.trim() || null, user.id, user.activeWorker?.fullName || user.nombre],
  )
  const last = MICROBIOLOGY_STEPS.length - 1
  if (step.position >= process.current_step_position) {
    const next = Math.min(last, step.position + 1)
    const done = step.position === last
    if (!done) {
      await query(`UPDATE laboratory_process_steps SET status='current', started_at=COALESCE(started_at,NOW()), updated_at=NOW() WHERE process_id=$1 AND position=$2`, [process.id, next])
    }
    await query(`UPDATE laboratory_service_processes SET current_step_position=$2, status=$3, updated_by_user_id=$4, updated_at=NOW() WHERE id=$1`, [process.id, next, done ? 'completed' : 'in_progress', user.id])
  }
  await log(process.id, step.id, 'step_completed', user.id, observations?.trim() || null)
}

async function saveStep(payload, user) {
  const rows = await query(
    `SELECT p.*, ps.id AS step_id, ps.step_key, ps.position, ps.status AS step_status, ps.step_data
     FROM laboratory_service_processes p JOIN laboratory_process_steps ps ON ps.process_id=p.id
     WHERE p.id=$1 AND ps.id=$2 AND p.process_type='microbiology'`,
    [payload.processId, payload.stepId],
  )
  const item = rows[0]
  if (!item) throw Object.assign(new Error('La etapa no está disponible.'), { status: 404 })
  await ensureServiceAccess(user, item.service_id)
  if (item.position > item.current_step_position) throw Object.assign(new Error('Completa la etapa anterior antes de continuar.'), { status: 400 })
  const process = { id: item.id, service_id: item.service_id, current_step_position: item.current_step_position }
  const step = { id: item.step_id, step_key: item.step_key, position: item.position, step_data: item.step_data }
  if (step.step_key === 'report') throw Object.assign(new Error('El informe debe publicarse como archivo PDF.'), { status: 400 })
  validateStepData(step.step_key, payload.data)
  let data = payload.data
  if (step.step_key === 'autoclave') data = await saveAutoclaveCycle(step, process, data, user)
  else data = await enrichStepData(step.step_key, data, user, process.service_id)
  await completeStep(process, step, data, payload.observations, user)
  return (await processRows(process.service_id, user.activeWorker?.id || null)).find((record) => record.id === process.id)
}

async function reopenStep(payload, user) {
  const rows = await query(
    `SELECT p.id, p.service_id, ps.id AS step_id, ps.position FROM laboratory_service_processes p
     JOIN laboratory_process_steps ps ON ps.process_id=p.id WHERE p.id=$1 AND ps.id=$2`,
    [payload.processId, payload.stepId],
  )
  const row = rows[0]
  if (!row) throw Object.assign(new Error('La etapa no está disponible.'), { status: 404 })
  await ensureServiceAccess(user, row.service_id)
  await query(
    `UPDATE laboratory_process_steps SET status=CASE WHEN position<$2 THEN 'completed' WHEN position=$2 THEN 'current' ELSE 'pending' END,
       completed_at=CASE WHEN position<$2 THEN completed_at ELSE NULL END,
       started_at=CASE WHEN position=$2 THEN COALESCE(started_at,NOW()) ELSE started_at END, updated_at=NOW()
     WHERE process_id=$1`,
    [row.id, row.position],
  )
  await query(`UPDATE laboratory_service_processes SET current_step_position=$2,status='in_progress',updated_by_user_id=$3,updated_at=NOW() WHERE id=$1`, [row.id, row.position, user.id])
  await log(row.id, row.step_id, 'step_reopened', user.id, payload.note?.trim() || 'Etapa reabierta para corrección')
  return (await processRows(row.service_id, user.activeWorker?.id || null)).find((record) => record.id === row.id)
}

async function uploadReport(payload, user) {
  const report = validPdf(payload.report)
  if (!report) throw Object.assign(new Error('Adjunta un PDF válido de hasta 3 MB.'), { status: 400 })
  const rows = await query(
    `SELECT p.*, ps.id AS step_id, ps.position FROM laboratory_service_processes p
     JOIN laboratory_process_steps ps ON ps.process_id=p.id AND ps.step_key='report'
     WHERE p.id=$1 AND p.process_type='microbiology'`,
    [payload.processId],
  )
  const process = rows[0]
  if (!process) throw Object.assign(new Error('El flujo microbiológico no está disponible.'), { status: 404 })
  await ensureServiceAccess(user, process.service_id)
  if (process.position > process.current_step_position) throw Object.assign(new Error('Completa la etapa anterior antes de publicar el informe.'), { status: 400 })
  const service = await query(`SELECT id, code, client_user_id FROM service_requests WHERE id=$1`, [process.service_id])
  const inserted = await query(
    `WITH next_version AS (SELECT COALESCE(MAX(version),0)+1 AS version FROM service_final_reports WHERE service_id=$1)
     INSERT INTO service_final_reports (service_id,version,file_name,mime_type,file_size,data_url,notes,is_current,approval_status,approval_requested_at,uploaded_by_user_id)
     SELECT $1,next_version.version,$2,$3,$4,$5,$6,false,'pending',NOW(),$7 FROM next_version
     RETURNING id,version,file_name,file_size,created_at`,
    [process.service_id, report.fileName.trim(), report.mimeType, report.fileSize, report.dataUrl, payload.notes?.trim() || null, user.id],
  )
  const published = inserted[0]
  const data = {
    reportId: published.id, fileName: published.file_name, version: published.version,
    fileSize: published.file_size, fileSizeLabel: published.file_size < 1_000_000 ? `${Math.max(1, Math.round(published.file_size / 1000))} KB` : `${(published.file_size / 1_000_000).toFixed(1)} MB`,
    issuedAt: payload.issuedAt || published.created_at, uploadedAt: published.created_at,
    notes: payload.notes?.trim() || '', serviceCode: service[0].code,
  }
  await completeStep(process, { id: process.step_id, position: process.position }, data, payload.notes, user)
  await query(`INSERT INTO service_stage_events (service_id,stage_id,action,actor_user_id,note) VALUES ($1,NULL,'final_report_submitted',$2,$3)`, [process.service_id, user.id, `Informe microbiológico v${published.version} enviado a aprobación`])
  await query(
    `INSERT INTO notifications (user_id,title,body,type,priority,audience,action_url)
     SELECT id,'Informe pendiente de aprobación',$1,'result','high','admin','ordenes'
     FROM users WHERE LOWER(email)=ANY($2::text[]) AND status='active'`,
    [`${service[0].code} · Informe microbiológico v${published.version}`,['antoniog@aslaboratorios.com','aespinales@aslaboratorios.com','luisg@aslaboratorios.com']],
  )
  return (await processRows(process.service_id, user.activeWorker?.id || null)).find((record) => record.id === process.id)
}

export default async function microbiologyHandler(req, res) {
  const action = req.method === 'GET' ? 'view' : req.method === 'POST' ? 'create' : 'edit'
  const user = await requireUser(req, res, 'lab_operations', action)
  if (!user) return
  if (user.activeWorker?.biotechnologyAccess) {
    return json(res, 403, { error: 'Tu perfil trabaja únicamente con códigos de plantas.' })
  }
  try {
    if (req.method === 'GET') return json(res, 200, await listData(user))
    const payload = await body(req)
    if (req.method === 'POST') {
      if (!can(user, 'lab_operations', 'create')) return json(res, 403, { error: 'No tienes permiso para registrar operaciones.' })
      let process
      if (payload.action === 'create_microbiology_process') process = await createProcess(payload, user)
      else if (payload.action === 'save_microbiology_step') process = await saveStep(payload, user)
      else if (payload.action === 'upload_microbiology_report') process = await uploadReport(payload, user)
      else return json(res, 400, { error: 'Acción no reconocida.' })
      return json(res, 201, { process })
    }
    if (req.method === 'PATCH') {
      if (!can(user, 'lab_operations', 'edit')) return json(res, 403, { error: 'No tienes permiso para editar operaciones.' })
      if (payload.action !== 'reopen_microbiology_step') return json(res, 400, { error: 'Acción no reconocida.' })
      return json(res, 200, { process: await reopenStep(payload, user) })
    }
  } catch (error) {
    if (error.code === '23503') return json(res, 400, { error: 'El servicio, equipo o registro relacionado ya no está disponible.' })
    if (error.code === '23505') return json(res, 409, { error: 'Ya existe un registro con esos datos.' })
    if (error.code === '23514' || error.code === '22P02') return json(res, 400, { error: 'Revisa los valores ingresados.' })
    return json(res, error.status || 500, { error: error.status ? error.message : 'No fue posible guardar la operación microbiológica.' })
  }
  return methodNotAllowed(res, ['GET', 'POST', 'PATCH'])
}
