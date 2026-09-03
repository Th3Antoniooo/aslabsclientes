import crypto from 'node:crypto'
import { can, requireUser } from './auth.js'
import { query } from './db.js'
import { body, json, methodNotAllowed } from './http.js'
import { createAutoclavePdfBuffer } from './autoclave-pdf.js'
import { createEquipmentRunPdfBuffer } from './equipment-run-pdf.js'

const indicatorValues = ['conforming', 'nonconforming', 'not_applicable', 'pending']
const loadTypes = ['culture_media', 'material', 'mixed']
const cycleResults = ['conforming', 'nonconforming', 'pending']
const releaseResults = ['released', 'rejected', 'pending']
const integrityValues = ['conforming', 'nonconforming', 'not_applicable']
const nonconformityStatuses = ['open', 'in_review', 'closed']
const equipmentTypes = ['autoclave', 'spectrophotometer', 'incubator', 'shaker_incubator', 'centrifuge', 'oven', 'flow_cabinet']
const timedEquipment = new Set(['autoclave', 'incubator', 'shaker_incubator', 'centrifuge', 'oven'])

function code(prefix) {
  const stamp = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Lima',
  }).format(new Date()).replaceAll('-', '')
  return `${prefix}-${stamp}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`
}

function required(payload, fields) {
  return fields.every((field) => String(payload[field] ?? '').trim())
}

function validDate(value) {
  return value && !Number.isNaN(new Date(value).getTime())
}

async function operatorName(operatorUserId, fallbackUser) {
  if (!operatorUserId) return { id: fallbackUser.id, name: fallbackUser.nombre }
  const rows = await query(
    `SELECT u.id, u.full_name
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1 AND u.status = 'active'
       AND (r.slug IN ('admin', 'laboratory-worker') OR EXISTS (
         SELECT 1 FROM role_permissions rp
         WHERE rp.role_id = r.id AND rp.module_id = 'lab_operations' AND rp.can_view = true
       ))`,
    [operatorUserId],
  )
  return rows[0] ? { id: rows[0].id, name: rows[0].full_name } : null
}

const baseRecordSelect = `
  SELECT c.*, e.code AS equipment_code, e.name AS equipment_name,
         e.location AS equipment_location, e.brand AS equipment_brand,
         e.model AS equipment_model, e.serial_number AS equipment_serial_number,
         s.code AS service_code,
         COALESCE(NULLIF(s.display_name, ''), s.service_type_name) AS service_name,
         client.full_name AS client_name, client.company AS client_company
  FROM autoclave_cycles c
  JOIN laboratory_equipment e ON e.id = c.equipment_id
  JOIN service_requests s ON s.id = c.service_id
  JOIN users client ON client.id = s.client_user_id`

async function pdfRecord(type, id) {
  if (type === 'cycle') {
    const rows = await query(`${baseRecordSelect} WHERE c.id = $1`, [id])
    return rows[0]
  }
  if (type === 'release') {
    const rows = await query(
      `SELECT r.*, c.record_code AS cycle_record_code,
              c.result AS cycle_result, e.code AS equipment_code, e.name AS equipment_name,
              e.location AS equipment_location, s.code AS service_code,
              COALESCE(NULLIF(s.display_name, ''), s.service_type_name) AS service_name,
              client.full_name AS client_name, client.company AS client_company
       FROM autoclave_material_releases r
       JOIN autoclave_cycles c ON c.id = r.cycle_id
       JOIN laboratory_equipment e ON e.id = c.equipment_id
       JOIN service_requests s ON s.id = c.service_id
       JOIN users client ON client.id = s.client_user_id
       WHERE r.id = $1`,
      [id],
    )
    return rows[0]
  }
  if (type === 'nonconformity') {
    const rows = await query(
      `SELECT n.*, c.record_code AS cycle_record_code, c.result AS cycle_result,
              r.record_code AS release_record_code,
              e.code AS equipment_code, e.name AS equipment_name, e.location AS equipment_location,
              s.code AS service_code,
              COALESCE(NULLIF(s.display_name, ''), s.service_type_name) AS service_name,
              client.full_name AS client_name, client.company AS client_company
       FROM autoclave_nonconformities n
       JOIN autoclave_cycles c ON c.id = n.cycle_id
       LEFT JOIN autoclave_material_releases r ON r.id = n.release_id
       JOIN laboratory_equipment e ON e.id = c.equipment_id
       JOIN service_requests s ON s.id = c.service_id
       JOIN users client ON client.id = s.client_user_id
       WHERE n.id = $1`,
      [id],
    )
    return rows[0]
  }
  return null
}

async function listData(user) {
  const isAdmin = user.role === 'admin'
  const workerAnalystId = user.activeWorker?.id || null
  const [equipment, services, operators, cycles, releases, nonconformities, equipmentRuns] = await Promise.all([
    query(`SELECT * FROM laboratory_equipment ORDER BY status = 'active' DESC, equipment_type, code`),
    query(
      `SELECT s.id, s.code, s.status, s.sample_intake_mode, s.sample_intake_scheduled_at,
              COALESCE(NULLIF(s.display_name, ''), s.service_type_name) AS name,
              CASE WHEN $1 THEN c.full_name ELSE NULL END AS client_name,
              CASE WHEN $1 THEN c.company ELSE NULL END AS client_company,
              COALESCE(items.items, '[]'::jsonb) AS items,
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
       JOIN users c ON c.id = s.client_user_id
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object('name', i.service_name, 'category', i.category_name)
                          ORDER BY i.sort_order, i.created_at) AS items
         FROM service_request_items i WHERE i.service_id = s.id
       ) items ON true
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
         SELECT e.code AS equipment_code,e.name AS equipment_name,e.equipment_type,r.expected_end_at,r.started_at
         FROM laboratory_equipment_run_services rs
         JOIN laboratory_equipment_runs r ON r.id=rs.run_id
         JOIN laboratory_equipment e ON e.id=r.equipment_id
         WHERE rs.service_id=s.id AND r.status='running'
         ORDER BY CASE WHEN r.expected_end_at IS NOT NULL AND r.expected_end_at<NOW() THEN 0 ELSE 1 END,r.started_at
         LIMIT 1
       ) equipment_alert ON true
       WHERE s.status IN ('accepted', 'in_progress', 'completed') AND s.archived_at IS NULL
         AND ($2::uuid IS NULL OR EXISTS (
           SELECT 1 FROM worker_service_assignments wsa
           WHERE wsa.service_id=s.id AND wsa.analyst_id=$2 AND wsa.active=true
         ))
       ORDER BY CASE WHEN sample_deadline.sample_due_at<NOW() THEN 0
                     WHEN sample_deadline.sample_due_at<=NOW()+INTERVAL '2 days' THEN 1 ELSE 2 END,
                CASE s.status WHEN 'in_progress' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END, s.updated_at DESC`,
      [isAdmin, workerAnalystId],
    ),
    query(
      `SELECT DISTINCT u.id, u.full_name, r.name AS role_name
       FROM users u JOIN roles r ON r.id = u.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.module_id = 'lab_operations'
       WHERE u.status = 'active' AND (r.slug IN ('admin', 'laboratory-worker') OR rp.can_view = true)
       ORDER BY u.full_name`,
    ),
    isAdmin ? query(`${baseRecordSelect} WHERE s.archived_at IS NULL ORDER BY c.started_at DESC LIMIT 250`) : [],
    isAdmin ? query(
      `SELECT r.*, c.record_code AS cycle_record_code, c.service_id, c.equipment_id,
              e.code AS equipment_code, e.name AS equipment_name,
              s.code AS service_code,
              COALESCE(NULLIF(s.display_name, ''), s.service_type_name) AS service_name,
              client.full_name AS client_name
       FROM autoclave_material_releases r
       JOIN autoclave_cycles c ON c.id = r.cycle_id
       JOIN laboratory_equipment e ON e.id = c.equipment_id
       JOIN service_requests s ON s.id = c.service_id
       JOIN users client ON client.id = s.client_user_id
       WHERE s.archived_at IS NULL
       ORDER BY r.released_at DESC LIMIT 250`,
    ) : [],
    isAdmin ? query(
      `SELECT n.*, c.record_code AS cycle_record_code, c.service_id, c.equipment_id,
              r.record_code AS release_record_code,
              e.code AS equipment_code, e.name AS equipment_name,
              s.code AS service_code,
              COALESCE(NULLIF(s.display_name, ''), s.service_type_name) AS service_name,
              client.full_name AS client_name
       FROM autoclave_nonconformities n
       JOIN autoclave_cycles c ON c.id = n.cycle_id
       LEFT JOIN autoclave_material_releases r ON r.id = n.release_id
       JOIN laboratory_equipment e ON e.id = c.equipment_id
       JOIN service_requests s ON s.id = c.service_id
       JOIN users client ON client.id = s.client_user_id
       WHERE s.archived_at IS NULL
       ORDER BY n.detected_at DESC LIMIT 250`,
    ) : [],
    query(
      `SELECT r.*,e.code AS equipment_code,e.name AS equipment_name,e.location AS equipment_location,
              COALESCE(links.services,'[]'::jsonb) AS services,
              COALESCE(ncs.items,'[]'::jsonb) AS nonconformities,
              (r.status='running' AND r.expected_end_at IS NOT NULL AND r.expected_end_at < NOW()) AS overdue
       FROM laboratory_equipment_runs r
       JOIN laboratory_equipment e ON e.id=r.equipment_id
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object(
           'id',s.id,'code',s.code,
           'name',COALESCE(NULLIF(s.display_name,''),s.service_type_name),
           'stageId',rs.stage_id,'stageTitle',ws.title
         ) ORDER BY s.code) AS services
         FROM laboratory_equipment_run_services rs
         JOIN service_requests s ON s.id=rs.service_id
         LEFT JOIN service_workflow_stages ws ON ws.id=rs.stage_id
         WHERE rs.run_id=r.id
           AND ($1::uuid IS NULL OR EXISTS (
             SELECT 1 FROM worker_service_assignments wsa
             WHERE wsa.service_id=s.id AND wsa.analyst_id=$1 AND wsa.active=true
           ))
       ) links ON true
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object(
           'id',n.id,'recordCode',n.record_code,'status',n.status,'detectedAt',n.detected_at,
           'description',n.description,'immediateAction',n.immediate_action,
           'rootCause',n.root_cause,'correctiveAction',n.corrective_action,
           'responsibleName',n.responsible_name
         ) ORDER BY n.detected_at DESC) AS items
         FROM laboratory_equipment_run_nonconformities n WHERE n.run_id=r.id
       ) ncs ON true
       WHERE $1::uuid IS NULL
          OR r.operator_analyst_id=$1
          OR EXISTS (
            SELECT 1 FROM laboratory_equipment_run_services visible_rs
            JOIN worker_service_assignments visible_wsa ON visible_wsa.service_id=visible_rs.service_id
            WHERE visible_rs.run_id=r.id AND visible_wsa.analyst_id=$1 AND visible_wsa.active=true
          )
       ORDER BY CASE r.status WHEN 'running' THEN 0 ELSE 1 END,
                COALESCE(r.expected_end_at,r.started_at) DESC LIMIT 300`,
      [workerAnalystId],
    ),
  ])
  return { equipment, services, operators, cycles, releases, nonconformities, equipmentRuns }
}

async function logEvent(entityType, entityId, action, userId, note = null) {
  await query(
    `INSERT INTO laboratory_operation_events (entity_type, entity_id, action, actor_user_id, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [entityType, entityId, action, userId, note],
  )
}

async function createCycle(payload, user) {
  if (!required(payload, ['equipmentId', 'serviceId', 'loadType', 'loadDescription', 'startedAt', 'endedAt', 'temperatureC', 'pressureBar', 'holdingMinutes'])) {
    throw Object.assign(new Error('Completa el equipo, servicio, carga, horario y parámetros del ciclo.'), { status: 400 })
  }
  if (!loadTypes.includes(payload.loadType) || !cycleResults.includes(payload.result || 'pending')) {
    throw Object.assign(new Error('Los datos del ciclo no son válidos.'), { status: 400 })
  }
  if (!indicatorValues.includes(payload.chemicalIndicator || 'not_applicable') || !indicatorValues.includes(payload.biologicalIndicator || 'not_applicable')) {
    throw Object.assign(new Error('Selecciona resultados válidos para los indicadores.'), { status: 400 })
  }
  if (!validDate(payload.startedAt) || !validDate(payload.endedAt) || new Date(payload.endedAt) < new Date(payload.startedAt)) {
    throw Object.assign(new Error('El horario del autoclavado no es válido.'), { status: 400 })
  }
  const operator = await operatorName(payload.operatorUserId, user)
  if (!operator) throw Object.assign(new Error('El operador seleccionado no está disponible.'), { status: 400 })
  const rows = await query(
    `INSERT INTO autoclave_cycles
      (record_code, equipment_id, service_id, load_type, load_description, cycle_number,
       program_name, started_at, ended_at, temperature_c, pressure_bar, holding_minutes,
       operator_user_id, operator_name, chemical_indicator, biological_indicator, result,
       observations, created_by_user_id, updated_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)
     RETURNING *`,
    [code('AUT'), payload.equipmentId, payload.serviceId, payload.loadType, payload.loadDescription.trim(),
      payload.cycleNumber?.trim() || null, payload.programName?.trim() || null, payload.startedAt, payload.endedAt,
      Number(payload.temperatureC), Number(payload.pressureBar), Number(payload.holdingMinutes), operator.id, operator.name,
      payload.chemicalIndicator || 'not_applicable', payload.biologicalIndicator || 'not_applicable', payload.result || 'pending',
      payload.observations?.trim() || null, user.id],
  )
  await logEvent('autoclave_cycle', rows[0].id, 'created', user.id)
  return rows[0]
}

async function createRelease(payload, user) {
  if (!required(payload, ['cycleId', 'releasedAt', 'materialCondition'])) {
    throw Object.assign(new Error('Completa el ciclo, la fecha y la condición del material.'), { status: 400 })
  }
  if (!validDate(payload.releasedAt) || !releaseResults.includes(payload.releaseResult || 'pending') ||
      !integrityValues.includes(payload.packagingIntegrity || 'conforming')) {
    throw Object.assign(new Error('Los datos de liberación no son válidos.'), { status: 400 })
  }
  const releasedBy = await operatorName(payload.releasedByUserId, user)
  if (!releasedBy) throw Object.assign(new Error('El responsable seleccionado no está disponible.'), { status: 400 })
  const rows = await query(
    `INSERT INTO autoclave_material_releases
      (record_code, cycle_id, released_at, released_by_user_id, released_by_name,
       material_condition, packaging_integrity, chemical_indicator_result,
       biological_indicator_result, release_result, observations, created_by_user_id, updated_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
     RETURNING *`,
    [code('LIB'), payload.cycleId, payload.releasedAt, releasedBy.id, releasedBy.name,
      payload.materialCondition.trim(), payload.packagingIntegrity || 'conforming',
      payload.chemicalIndicatorResult || 'not_applicable', payload.biologicalIndicatorResult || 'not_applicable',
      payload.releaseResult || 'pending', payload.observations?.trim() || null, user.id],
  )
  await logEvent('material_release', rows[0].id, 'created', user.id)
  return rows[0]
}

async function createNonconformity(payload, user) {
  if (!required(payload, ['cycleId', 'detectedAt', 'description', 'immediateAction'])) {
    throw Object.assign(new Error('Completa el ciclo, la detección, la descripción y la acción inmediata.'), { status: 400 })
  }
  if (!validDate(payload.detectedAt) || !nonconformityStatuses.includes(payload.status || 'open')) {
    throw Object.assign(new Error('Los datos de la no conformidad no son válidos.'), { status: 400 })
  }
  const responsible = await operatorName(payload.responsibleUserId, user)
  if (!responsible) throw Object.assign(new Error('El responsable seleccionado no está disponible.'), { status: 400 })
  const rows = await query(
    `INSERT INTO autoclave_nonconformities
      (record_code, cycle_id, release_id, detected_at, description, immediate_action,
       root_cause, corrective_action, responsible_user_id, responsible_name, status,
       created_by_user_id, updated_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
     RETURNING *`,
    [code('NC'), payload.cycleId, payload.releaseId || null, payload.detectedAt, payload.description.trim(),
      payload.immediateAction.trim(), payload.rootCause?.trim() || null, payload.correctiveAction?.trim() || null,
      responsible.id, responsible.name, payload.status || 'open', user.id],
  )
  await logEvent('nonconformity', rows[0].id, 'created', user.id)
  return rows[0]
}

async function updateCycle(payload, user) {
  const operator = await operatorName(payload.operatorUserId, user)
  if (!operator || !validDate(payload.startedAt) || !validDate(payload.endedAt) || new Date(payload.endedAt) < new Date(payload.startedAt)) {
    throw Object.assign(new Error('Revisa el operador y el horario del ciclo.'), { status: 400 })
  }
  const rows = await query(
    `UPDATE autoclave_cycles SET
       equipment_id=$2, service_id=$3, load_type=$4, load_description=$5, cycle_number=$6,
       program_name=$7, started_at=$8, ended_at=$9, temperature_c=$10, pressure_bar=$11,
       holding_minutes=$12, operator_user_id=$13, operator_name=$14, chemical_indicator=$15,
       biological_indicator=$16, result=$17, observations=$18, updated_by_user_id=$19, updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [payload.id, payload.equipmentId, payload.serviceId, payload.loadType, payload.loadDescription,
      payload.cycleNumber || null, payload.programName || null, payload.startedAt, payload.endedAt,
      Number(payload.temperatureC), Number(payload.pressureBar), Number(payload.holdingMinutes), operator.id, operator.name,
      payload.chemicalIndicator, payload.biologicalIndicator, payload.result, payload.observations || null, user.id],
  )
  if (!rows[0]) throw Object.assign(new Error('Registro de autoclavado no encontrado.'), { status: 404 })
  await logEvent('autoclave_cycle', rows[0].id, 'updated', user.id)
  return rows[0]
}

async function updateRelease(payload, user) {
  const responsible = await operatorName(payload.releasedByUserId, user)
  if (!responsible || !validDate(payload.releasedAt)) throw Object.assign(new Error('Revisa el responsable y la fecha.'), { status: 400 })
  const rows = await query(
    `UPDATE autoclave_material_releases SET
       cycle_id=$2, released_at=$3, released_by_user_id=$4, released_by_name=$5,
       material_condition=$6, packaging_integrity=$7, chemical_indicator_result=$8,
       biological_indicator_result=$9, release_result=$10, observations=$11,
       updated_by_user_id=$12, updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [payload.id, payload.cycleId, payload.releasedAt, responsible.id, responsible.name,
      payload.materialCondition, payload.packagingIntegrity, payload.chemicalIndicatorResult,
      payload.biologicalIndicatorResult, payload.releaseResult, payload.observations || null, user.id],
  )
  if (!rows[0]) throw Object.assign(new Error('Liberación no encontrada.'), { status: 404 })
  await logEvent('material_release', rows[0].id, 'updated', user.id)
  return rows[0]
}

async function updateNonconformity(payload, user) {
  const responsible = await operatorName(payload.responsibleUserId, user)
  if (!responsible || !validDate(payload.detectedAt)) throw Object.assign(new Error('Revisa el responsable y la fecha.'), { status: 400 })
  const rows = await query(
    `UPDATE autoclave_nonconformities SET
       cycle_id=$2, release_id=$3, detected_at=$4, description=$5, immediate_action=$6,
       root_cause=$7, corrective_action=$8, responsible_user_id=$9, responsible_name=$10,
       status=$11, updated_by_user_id=$12, updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [payload.id, payload.cycleId, payload.releaseId || null, payload.detectedAt, payload.description,
      payload.immediateAction, payload.rootCause || null, payload.correctiveAction || null,
      responsible.id, responsible.name, payload.status, user.id],
  )
  if (!rows[0]) throw Object.assign(new Error('No conformidad no encontrada.'), { status: 404 })
  await logEvent('nonconformity', rows[0].id, 'updated', user.id)
  return rows[0]
}

async function createEquipment(payload, user) {
  if (user.role !== 'admin') throw Object.assign(new Error('Solo administración puede registrar equipos.'), { status: 403 })
  if (!required(payload, ['code', 'name', 'equipmentType'])) throw Object.assign(new Error('Completa código, nombre y tipo de equipo.'), { status: 400 })
  const rows = await query(
    `INSERT INTO laboratory_equipment
      (code, name, equipment_type, brand, model, serial_number, location, status, notes, created_by_user_id)
     VALUES (UPPER($1),$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [payload.code.trim(), payload.name.trim(), payload.equipmentType, payload.brand || null, payload.model || null,
      payload.serialNumber || null, payload.location || null, payload.status || 'active', payload.notes || null, user.id],
  )
  await logEvent('equipment', rows[0].id, 'created', user.id)
  return rows[0]
}

async function updateEquipment(payload, user) {
  if (user.role !== 'admin') throw Object.assign(new Error('Solo administración puede editar equipos.'), { status: 403 })
  const rows = await query(
    `UPDATE laboratory_equipment SET code=UPPER($2), name=$3, equipment_type=$4, brand=$5,
       model=$6, serial_number=$7, location=$8, status=$9, notes=$10, updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [payload.id, payload.code, payload.name, payload.equipmentType, payload.brand || null, payload.model || null,
      payload.serialNumber || null, payload.location || null, payload.status, payload.notes || null],
  )
  if (!rows[0]) throw Object.assign(new Error('Equipo no encontrado.'), { status: 404 })
  await logEvent('equipment', rows[0].id, 'updated', user.id)
  return rows[0]
}

async function equipmentRunRecord(id) {
  const rows = await query(
    `SELECT r.*,e.code AS equipment_code,e.name AS equipment_name,e.location AS equipment_location,
            COALESCE(links.services,'[]'::jsonb) AS services,
            COALESCE(ncs.items,'[]'::jsonb) AS nonconformities
     FROM laboratory_equipment_runs r
     JOIN laboratory_equipment e ON e.id=r.equipment_id
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object(
         'id',s.id,'code',s.code,
         'name',COALESCE(NULLIF(s.display_name,''),s.service_type_name),
         'stageId',rs.stage_id,'stageTitle',ws.title
       ) ORDER BY s.code) AS services
       FROM laboratory_equipment_run_services rs
       JOIN service_requests s ON s.id=rs.service_id
       LEFT JOIN service_workflow_stages ws ON ws.id=rs.stage_id
       WHERE rs.run_id=r.id
     ) links ON true
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object(
         'id',n.id,'recordCode',n.record_code,'status',n.status,'detectedAt',n.detected_at,
         'description',n.description,'immediateAction',n.immediate_action,
         'rootCause',n.root_cause,'correctiveAction',n.corrective_action,
         'responsibleName',n.responsible_name
       ) ORDER BY n.detected_at DESC) AS items
       FROM laboratory_equipment_run_nonconformities n WHERE n.run_id=r.id
     ) ncs ON true
     WHERE r.id=$1`,
    [id],
  )
  return rows[0] || null
}

async function runOperator(payload, user) {
  if (user.activeWorker) {
    return { userId: user.id, analystId: user.activeWorker.id, name: user.activeWorker.fullName }
  }
  const selected = await operatorName(payload.operatorUserId, user)
  if (!selected) throw Object.assign(new Error('El operador seleccionado no está disponible.'), { status: 400 })
  return { userId: selected.id, analystId: null, name: selected.name }
}

function runServiceIds(payload) {
  return [...new Set((Array.isArray(payload.serviceIds) ? payload.serviceIds : [])
    .filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()))]
}

async function startEquipmentRun(payload, user) {
  const serviceIds = runServiceIds(payload)
  const workArea = payload.workArea === 'biotechnology' ? 'biotechnology' : 'laboratory'
  const quickStart = payload.quickStart === true
  if (user.activeWorker && !user.activeWorker.canUseEquipment) {
    throw Object.assign(new Error('Tu PIN no tiene permiso para utilizar equipos.'), { status: 403 })
  }
  if (!payload.equipmentId || serviceIds.length > 20 || (workArea === 'laboratory' && !serviceIds.length)) {
    throw Object.assign(new Error('Selecciona el equipo y luego una orden o Biotecnología.'), { status: 400 })
  }
  const equipmentRows = await query(
    `SELECT * FROM laboratory_equipment WHERE id=$1 AND status='active'`,
    [payload.equipmentId],
  )
  const equipment = equipmentRows[0]
  if (!equipment || !equipmentTypes.includes(equipment.equipment_type)) {
    throw Object.assign(new Error('El equipo seleccionado no está disponible.'), { status: 400 })
  }
  const busy = await query(
    `SELECT id FROM laboratory_equipment_runs WHERE equipment_id=$1 AND status='running' LIMIT 1`,
    [equipment.id],
  )
  if (busy[0]) throw Object.assign(new Error('Este equipo ya tiene un uso activo. Finalízalo antes de iniciar otro.'), { status: 409 })
  const services = serviceIds.length ? await query(
    `SELECT id FROM service_requests
     WHERE id=ANY($1::uuid[]) AND status IN ('accepted','in_progress') AND archived_at IS NULL
       AND ($2::uuid IS NULL OR EXISTS (
         SELECT 1 FROM worker_service_assignments wsa
         WHERE wsa.service_id=service_requests.id AND wsa.analyst_id=$2 AND wsa.active=true
       ))`,
    [serviceIds, user.activeWorker?.id || null],
  ) : []
  if (services.length !== serviceIds.length) throw Object.assign(new Error('Una o más órdenes no están activas.'), { status: 400 })

  const hasDuration = payload.durationMinutes !== '' && payload.durationMinutes != null
  const duration = equipment.equipment_type === 'autoclave' && !hasDuration ? 15 : hasDuration ? Number(payload.durationMinutes) : null
  if (duration !== null && (!Number.isInteger(duration) || duration < 1 || duration > 43200)) {
    throw Object.assign(new Error('Indica una duración válida para el equipo.'), { status: 400 })
  }
  if (!quickStart && ['shaker_incubator', 'centrifuge'].includes(equipment.equipment_type) && (!Number.isFinite(Number(payload.rpm)) || Number(payload.rpm) <= 0)) {
    throw Object.assign(new Error('Indica las RPM del equipo.'), { status: 400 })
  }
  if (!quickStart && ['autoclave', 'oven'].includes(equipment.equipment_type)
      && (payload.temperatureC === '' || payload.temperatureC == null || !Number.isFinite(Number(payload.temperatureC)))) {
    throw Object.assign(new Error('Indica la temperatura del proceso.'), { status: 400 })
  }
  if (!quickStart && ['incubator', 'shaker_incubator'].includes(equipment.equipment_type) && !payload.storagePosition?.trim()) {
    throw Object.assign(new Error('Indica dónde quedará almacenada la muestra.'), { status: 400 })
  }
  const material = payload.materialDescription?.trim()
    || (workArea === 'biotechnology' ? `Biotecnología · ${equipment.name}` : null)
    || (quickStart && services[0] ? `Uso vinculado a orden ${services[0].id}` : null)
    || (equipment.equipment_type === 'flow_cabinet' ? 'Análisis realizado en cabina de flujo laminar' : null)
  if (!material) throw Object.assign(new Error('Describe qué material, muestra o carga se colocará.'), { status: 400 })

  const operator = await runOperator(payload, user)
  let stageId = null
  if (payload.stageId && serviceIds.length) {
    if (serviceIds.length !== 1) throw Object.assign(new Error('La etapa solo puede vincularse cuando registras el equipo desde una orden.'), { status: 400 })
    const stageRows = await query(
      `SELECT ws.id FROM service_workflow_stages ws
       JOIN service_requests s ON s.id=ws.service_id AND s.current_stage_position=ws.position
       WHERE ws.id=$1 AND ws.service_id=$2`,
      [payload.stageId, serviceIds[0]],
    )
    if (!stageRows[0]) throw Object.assign(new Error('La etapa actual ya no está disponible.'), { status: 400 })
    stageId = stageRows[0].id
  }
  const prefix = {
    autoclave: 'AUT', spectrophotometer: 'ESP', incubator: 'INC', shaker_incubator: 'SHK',
    centrifuge: 'CEN', oven: 'HOR', flow_cabinet: 'CFL',
  }[equipment.equipment_type]
  const temperature = equipment.equipment_type === 'autoclave' ? Number(payload.temperatureC || 121)
    : quickStart && equipment.equipment_type === 'oven' ? Number(payload.temperatureC || 105)
      : payload.temperatureC === '' || payload.temperatureC == null ? null : Number(payload.temperatureC)
  const pressure = equipment.equipment_type === 'autoclave' ? Number(payload.pressureBar || 1.05) : null
  const minutes = timedEquipment.has(equipment.equipment_type) ? duration : null
  const rows = await query(
    `INSERT INTO laboratory_equipment_runs
     (record_code,equipment_id,equipment_type,work_area,status,material_description,storage_position,
      started_at,expected_end_at,temperature_c,pressure_bar,duration_minutes,rpm,
      operator_user_id,operator_analyst_id,operator_name,observations,created_by_user_id,updated_by_user_id)
     VALUES ($1,$2,$3,$4,'running',$5,$6,NOW(),
       CASE WHEN $7::int IS NULL THEN NULL ELSE NOW()+($7::int*INTERVAL '1 minute') END,
       $8,$9,$7,$10,$11,$12,$13,$14,$15,$15) RETURNING *`,
    [code(prefix),equipment.id,equipment.equipment_type,workArea,material,payload.storagePosition?.trim() || null,
      minutes,temperature,pressure,payload.rpm === '' || payload.rpm == null ? null : Number(payload.rpm),
      operator.userId,operator.analystId,operator.name,payload.observations?.trim() || null,user.id],
  )
  if (serviceIds.length) {
    await query(
      `INSERT INTO laboratory_equipment_run_services (run_id,service_id,stage_id)
       SELECT $1,id,CASE WHEN id=$3::uuid THEN $4::uuid ELSE NULL END
       FROM service_requests WHERE id=ANY($2::uuid[])`,
      [rows[0].id,serviceIds,serviceIds[0],stageId],
    )
  }
  await query(
    `INSERT INTO laboratory_equipment_run_events (run_id,action,actor_user_id,actor_analyst_id,note)
     VALUES ($1,'started',$2,$3,$4)`,
    [rows[0].id,user.id,user.activeWorker?.id || null,`${operator.name} inició ${equipment.code}`],
  )
  return equipmentRunRecord(rows[0].id)
}

async function finishEquipmentRun(payload, user) {
  const rows = await query(
    `UPDATE laboratory_equipment_runs r SET
       status='completed',ended_at=NOW(),
       observations=CASE WHEN $2::text IS NULL THEN observations
         WHEN observations IS NULL THEN $2 ELSE observations || E'\n' || $2 END,
       updated_by_user_id=$3,updated_at=NOW()
     WHERE r.id=$1 AND r.status='running'
       AND ($4::uuid IS NULL OR r.operator_analyst_id=$4 OR EXISTS (
         SELECT 1 FROM laboratory_equipment_run_services rs
         JOIN worker_service_assignments wsa ON wsa.service_id=rs.service_id
         WHERE rs.run_id=r.id AND wsa.analyst_id=$4 AND wsa.active=true
       ))
     RETURNING id`,
    [payload.id,payload.observations?.trim() || null,user.id,user.activeWorker?.id || null],
  )
  if (!rows[0]) throw Object.assign(new Error('El uso ya fue finalizado o no existe.'), { status: 404 })
  await query(
    `INSERT INTO laboratory_equipment_run_events (run_id,action,actor_user_id,actor_analyst_id,note)
     VALUES ($1,'finished',$2,$3,$4)`,
    [payload.id,user.id,user.activeWorker?.id || null,`${user.activeWorker?.fullName || user.nombre} finalizó el uso`],
  )
  return equipmentRunRecord(payload.id)
}

async function createEquipmentRunNonconformity(payload, user) {
  const description = payload.description?.trim()
  const immediateAction = payload.immediateAction?.trim()
  if (!payload.runId || !description || !immediateAction || description.length > 1200 || immediateAction.length > 1200) {
    throw Object.assign(new Error('Describe la no conformidad y la acción inmediata.'), { status: 400 })
  }
  const allowed = await query(
    `SELECT r.id FROM laboratory_equipment_runs r
     WHERE r.id=$1 AND r.status='completed'
       AND ($2::uuid IS NULL OR r.operator_analyst_id=$2 OR EXISTS (
         SELECT 1 FROM laboratory_equipment_run_services rs
         JOIN worker_service_assignments wsa ON wsa.service_id=rs.service_id
         WHERE rs.run_id=r.id AND wsa.analyst_id=$2 AND wsa.active=true
       ))`,
    [payload.runId, user.activeWorker?.id || null],
  )
  if (!allowed[0]) throw Object.assign(new Error('Finaliza primero el equipo o verifica que la orden esté asignada a tu código.'), { status: 403 })
  const responsible = user.activeWorker?.fullName || user.nombre
  const rows = await query(
    `INSERT INTO laboratory_equipment_run_nonconformities
       (record_code,run_id,description,immediate_action,root_cause,corrective_action,
        responsible_user_id,responsible_analyst_id,responsible_name,created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$7) RETURNING *`,
    [code('NC-EQ'),payload.runId,description,immediateAction,payload.rootCause?.trim() || null,
      payload.correctiveAction?.trim() || null,user.id,user.activeWorker?.id || null,responsible],
  )
  return rows[0]
}

export default async function handler(req, res) {
  const action = req.method === 'GET' ? 'view' : req.method === 'POST' ? 'create' : 'edit'
  const user = await requireUser(req, res, 'lab_operations', action)
  if (!user) return
  if (user.activeWorker && !user.activeWorker.canUseEquipment) {
    return json(res, 403, { error: 'Tu PIN no tiene permiso para utilizar equipos.' })
  }

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, 'https://portal.aslabs.local')
      if (url.searchParams.get('format') === 'pdf') {
        const type = url.searchParams.get('type')
        const id = url.searchParams.get('id')
        if (type === 'equipment-run') {
          const record = await equipmentRunRecord(id)
          if (!record) return json(res, 404, { error: 'Formato no encontrado.' })
          if (user.activeWorker) {
            const visible = await query(
              `SELECT 1 FROM laboratory_equipment_run_services rs
               JOIN worker_service_assignments wsa ON wsa.service_id=rs.service_id
               WHERE rs.run_id=$1 AND wsa.analyst_id=$2 AND wsa.active=true LIMIT 1`,
              [id,user.activeWorker.id],
            )
            if (!visible[0] && record.operator_analyst_id !== user.activeWorker.id) return json(res, 404, { error: 'Formato no encontrado.' })
          }
          const pdf = await createEquipmentRunPdfBuffer(record)
          res.status(200)
          res.setHeader('Content-Type', 'application/pdf')
          res.setHeader('Content-Disposition', `inline; filename="${record.record_code}.pdf"`)
          res.setHeader('Cache-Control', 'private, no-store')
          return res.end(pdf)
        }
        if (user.role !== 'admin') return json(res, 403, { error: 'Formato interno no disponible.' })
        const record = await pdfRecord(type, id)
        if (!record) return json(res, 404, { error: 'Formato no encontrado.' })
        const pdf = await createAutoclavePdfBuffer({ type, record })
        res.status(200)
        res.setHeader('Content-Type', 'application/pdf')
        res.setHeader('Content-Disposition', `inline; filename="${record.record_code}.pdf"`)
        res.setHeader('Cache-Control', 'private, no-store')
        return res.end(pdf)
      }
      return json(res, 200, await listData(user))
    }

    const payload = await body(req)
    let result
    if (req.method === 'POST') {
      if (!can(user, 'lab_operations', 'create')) return json(res, 403, { error: 'No tienes permiso para registrar operaciones.' })
      if (user.role !== 'admin' && !['start_equipment_run','create_equipment_run_nonconformity'].includes(payload.action)) {
        return json(res, 403, { error: 'Este registro interno está disponible solo para administración.' })
      }
      if (payload.action === 'start_equipment_run') result = await startEquipmentRun(payload, user)
      else if (payload.action === 'create_equipment_run_nonconformity') result = await createEquipmentRunNonconformity(payload, user)
      else if (payload.action === 'create_cycle') result = await createCycle(payload, user)
      else if (payload.action === 'create_release') result = await createRelease(payload, user)
      else if (payload.action === 'create_nonconformity') result = await createNonconformity(payload, user)
      else if (payload.action === 'create_equipment') result = await createEquipment(payload, user)
      else return json(res, 400, { error: 'Acción no reconocida.' })
      return json(res, 201, { record: result })
    }

    if (req.method === 'PATCH') {
      if (!can(user, 'lab_operations', 'edit')) return json(res, 403, { error: 'No tienes permiso para editar operaciones.' })
      if (!payload.id) return json(res, 400, { error: 'Falta el registro.' })
      if (user.role !== 'admin' && payload.action !== 'finish_equipment_run') {
        return json(res, 403, { error: 'Este registro interno está disponible solo para administración.' })
      }
      if (payload.action === 'finish_equipment_run') result = await finishEquipmentRun(payload, user)
      else if (payload.action === 'update_cycle') result = await updateCycle(payload, user)
      else if (payload.action === 'update_release') result = await updateRelease(payload, user)
      else if (payload.action === 'update_nonconformity') result = await updateNonconformity(payload, user)
      else if (payload.action === 'update_equipment') result = await updateEquipment(payload, user)
      else return json(res, 400, { error: 'Acción no reconocida.' })
      return json(res, 200, { record: result })
    }
  } catch (error) {
    if (error.code === '23505') return json(res, 409, { error: 'Ya existe un registro con esos datos o ese ciclo ya fue liberado.' })
    if (error.code === '23503') return json(res, 400, { error: 'El equipo, servicio o registro relacionado no está disponible.' })
    if (error.code === '23514' || error.code === '22P02') return json(res, 400, { error: 'Revisa los valores ingresados.' })
    return json(res, error.status || 500, { error: error.status ? error.message : 'No fue posible guardar la operación.' })
  }

  return methodNotAllowed(res, ['GET', 'POST', 'PATCH'])
}
