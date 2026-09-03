import crypto from 'node:crypto'
import { can, requireUser } from './auth.js'
import { query } from './db.js'
import { body, json, methodNotAllowed } from './http.js'

function clean(value) { return typeof value === 'string' && value.trim() ? value.trim() : null }
function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null
}
function decimal(value, min = 0.001, max = 100) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null
}
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }) }

function limaToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {})
  return `${parts.year}-${parts.month}-${parts.day}`
}
function recordDate(value) {
  const date = clean(value) || limaToday()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) fail('Selecciona una fecha válida para el registro.')
  const [,year,month,day] = match
  const checked = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  if (checked.getUTCFullYear() !== Number(year) || checked.getUTCMonth() !== Number(month) - 1 || checked.getUTCDate() !== Number(day)) {
    fail('Selecciona una fecha válida para el registro.')
  }
  return date
}
function displayRecordDate(date) {
  const [year,month,day] = String(date).split('-')
  return `${day}/${month}/${year}`
}

const ADMIN_MANAGERS = new Set(['antoniog@aslaboratorios.com', 'luisg@aslaboratorios.com'])
function normalized(value) { return String(value || '').trim().toLowerCase() }
function namedAssignmentManager(user) {
  const name = normalized(user.activeWorker?.fullName)
  return name.includes('rosa cabanillas') || name.includes('rosa cabañas') || name.includes('hassan') || name === 'hasa'
}
function canAdminCodes(user) {
  return user.role === 'admin' && ADMIN_MANAGERS.has(normalized(user.email))
}
function canCreateCodes(user) {
  return canAdminCodes(user) || Boolean(user.activeWorker?.canCreateBiotechnologyCodes)
}
function canManageAssignments(user) {
  return canAdminCodes(user) || namedAssignmentManager(user)
}

async function assignedWorker(id) {
  const rows = await query(
    `SELECT id,full_name FROM analysts WHERE id=$1 AND status='active' AND biotechnology_access=true`,
    [id],
  )
  if (!rows[0]) fail('La persona seleccionada no está habilitada para Biotecnología.')
  return rows[0]
}

function assignmentStage(batch) {
  return {
    stage: batch.current_stage,
    subculture: batch.current_stage === 'multiplication' ? Number(batch.current_subculture) + 1 : null,
  }
}

async function batchRows(user, showAllCodes) {
  const workerId = showAllCodes ? null : user.activeWorker?.id || null
  return query(
    `SELECT b.id,b.code,b.cultivar_id,
            CASE WHEN $2 THEN b.crop_name ELSE NULL END AS crop_name,
            CASE WHEN $2 THEN b.variety ELSE NULL END AS variety,
            b.initial_plants,b.multiplication_factor,b.target_subcultures,b.plants_per_bag,
            b.current_stage,b.current_subculture,b.current_viable_plants,b.rooting_bags,b.status,
            b.assigned_analyst_id,b.assigned_analyst_name,b.archived_at,b.archived_by_user_id,
            b.started_on,b.current_stage_started_on,CASE WHEN $2 THEN b.source_note ELSE NULL END AS source_note,
            b.needs_review,b.created_at,b.updated_at,
            COALESCE(stats.total_contaminated,0)::int AS total_contaminated,
            COALESCE(stats.total_output,0)::int AS total_viable_output,
            COALESCE(stats.total_input,0)::int AS total_input,
            COALESCE(stats.event_count,0)::int AS event_count,
            COALESCE(events.items,'[]'::jsonb) AS events
     FROM biotechnology_batches b
     LEFT JOIN LATERAL (
       SELECT SUM(e.contaminated_plants) AS total_contaminated,SUM(e.viable_output_plants) AS total_output,
              SUM(e.input_plants) AS total_input,COUNT(*) AS event_count
       FROM biotechnology_events e
       WHERE e.batch_id=b.id AND ($1::uuid IS NULL OR e.worker_analyst_id=$1)
     ) stats ON true
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object(
         'id',e.id,'stage',e.stage,'subcultureNumber',e.subculture_number,'performedAt',e.performed_at,
         'inputPlants',e.input_plants,'bagsProcessed',e.bags_processed,'plantsPerBag',e.plants_per_bag,
         'expectedOutputPlants',e.expected_output_plants,'viableOutputPlants',e.viable_output_plants,
         'contaminatedPlants',e.contaminated_plants,'discardedPlants',e.discarded_plants,
         'workerName',e.worker_name,'collaboratorName',e.collaborator_name,'rootingBags',e.rooting_bags,'createdAt',e.created_at
       ) ORDER BY e.performed_at,e.created_at) AS items
       FROM biotechnology_events e
       WHERE e.batch_id=b.id AND ($1::uuid IS NULL OR e.worker_analyst_id=$1)
     ) events ON true
     WHERE $1::uuid IS NULL OR (b.archived_at IS NULL AND EXISTS (
       SELECT 1 FROM biotechnology_assignments a WHERE a.batch_id=b.id AND a.analyst_id=$1
     ))
     ORDER BY b.archived_at IS NOT NULL,b.archived_at DESC,
              CASE b.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,b.updated_at DESC`,
    [workerId, canCreateCodes(user)],
  )
}

async function assignmentRows(user, managerView) {
  const workerId = managerView ? null : user.activeWorker?.id || null
  return query(
    `SELECT a.*,b.code,b.current_stage,b.current_subculture,b.current_viable_plants,b.status AS batch_status,
            b.multiplication_factor,b.target_subcultures,
            CASE WHEN $2 THEN b.crop_name ELSE NULL END AS crop_name,
            CASE WHEN $2 THEN b.variety ELSE NULL END AS variety,
            CASE WHEN a.started_at IS NULL THEN NULL
                 ELSE EXTRACT(EPOCH FROM (COALESCE(a.ended_at,NOW())-a.started_at))::int END AS elapsed_seconds
     FROM biotechnology_assignments a
     JOIN biotechnology_batches b ON b.id=a.batch_id
     WHERE ($1::uuid IS NULL OR a.analyst_id=$1) AND ($1::uuid IS NULL OR b.archived_at IS NULL)
     ORDER BY CASE a.status WHEN 'in_progress' THEN 0 WHEN 'assigned' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
              a.scheduled_for DESC,a.created_at DESC`,
    [workerId, canCreateCodes(user)],
  )
}

async function listData(user) {
  const workerId = user.activeWorker?.id || null
  const managerView = user.role === 'admin' || canManageAssignments(user)
  const adminView = canCreateCodes(user)
  const fullAdminView = canAdminCodes(user)
  const [settingsRows,cultivars,batches,assignments,workers,recentEvents,analyticsEvents] = await Promise.all([
    query(`SELECT default_plants_per_bag,updated_at FROM biotechnology_settings WHERE id=1`),
    adminView ? query(`SELECT id,crop_name,variety,multiplication_factor,target_subcultures,active,updated_at
                       FROM biotechnology_cultivars ORDER BY active DESC,crop_name,variety`) : Promise.resolve([]),
    batchRows(user,Boolean(user.activeWorker?.biotechnologyAccess) || managerView),
    Promise.resolve([]),
    query(
      `SELECT a.id,a.full_name,a.specialty,
              COUNT(e.id)::int AS event_count,
              COALESCE(SUM(e.viable_output_plants),0)::int AS viable_output,
              COALESCE(SUM(e.input_plants),0)::int AS total_input,
              COALESCE(SUM(e.contaminated_plants),0)::int AS contaminated,
              COALESCE(SUM(e.input_plants) FILTER (WHERE e.stage='multiplication'),0)::int AS multiplication_input,
              COALESCE(SUM(e.viable_output_plants) FILTER (WHERE e.stage='multiplication'),0)::int AS multiplication_output
       FROM analysts a LEFT JOIN biotechnology_events e ON e.worker_analyst_id=a.id
       WHERE a.status='active' AND a.biotechnology_access=true AND ($1::uuid IS NULL OR a.id=$1)
       GROUP BY a.id ORDER BY viable_output DESC,a.full_name`,
      [null],
    ),
    query(
      `SELECT e.id,b.code,e.stage,e.subculture_number,e.performed_at,e.input_plants,
              e.viable_output_plants,e.worker_name
       FROM biotechnology_events e JOIN biotechnology_batches b ON b.id=e.batch_id
       WHERE $1::uuid IS NULL OR e.worker_analyst_id=$1
       ORDER BY e.performed_at DESC,e.created_at DESC LIMIT 16`,
      [managerView ? null : workerId],
    ),
    query(
      `SELECT e.id,b.code,e.stage,e.subculture_number,e.performed_at,e.input_plants,e.bags_processed,
              e.plants_per_bag,e.expected_output_plants,e.viable_output_plants,e.contaminated_plants,
              e.discarded_plants,e.rooting_bags,e.worker_analyst_id,e.worker_name,
              e.collaborator_analyst_id,e.collaborator_name
       FROM biotechnology_events e JOIN biotechnology_batches b ON b.id=e.batch_id
       WHERE ($1::uuid IS NULL OR e.worker_analyst_id=$1)
       ORDER BY e.performed_at DESC,e.created_at DESC LIMIT 5000`,
      [managerView ? null : workerId],
    ),
  ])

  const personalAssignments = workerId ? assignments.filter((item) => item.analyst_id === workerId) : []
  const personalMetrics = {}
  for (const [key,days] of [['week',7],['month',31],['quarter',92]]) {
    const cutoff = Date.now() - days * 86400000
    const rows = personalAssignments.filter((item) => new Date(`${item.scheduled_for}T00:00:00`).getTime() >= cutoff)
    const completed = rows.filter((item) => item.status === 'completed')
    const seconds = completed.reduce((sum,item) => sum + Number(item.elapsed_seconds || 0),0)
    personalMetrics[key] = {
      assigned: rows.length,
      completed: completed.length,
      inputBags: completed.reduce((sum,item) => sum + Number(item.input_bags || 0),0),
      outputBags: completed.reduce((sum,item) => sum + Number(item.output_bags || item.introduced_plants || 0),0),
      outputPlants: completed.reduce((sum,item) => sum + Number(item.output_plants || item.introduced_plants || 0),0),
      minutes: Math.round(seconds / 60),
    }
  }
  const totalPlants = batches.reduce((sum,item) => sum + Number(item.current_viable_plants || 0),0)
  return {
    settings: settingsRows[0] || { default_plants_per_bag: 4 },cultivars,batches,assignments,
    personalAssignments,personalMetrics,workers,recentEvents,analyticsEvents,
    availableWorkers: workers,
    canManageCodes: canManageAssignments(user),canManageAssignments: canManageAssignments(user),
    canCreateCodes: canCreateCodes(user),canAdminCodes: fullAdminView,canManageCultivars: fullAdminView,
    metrics: {
      activeCodes: batches.filter((item) => item.status === 'active' && !item.archived_at).length,
      archivedCodes: batches.filter((item) => item.archived_at).length,
      currentPlants: batches.filter((item) => !item.archived_at).reduce((sum,item) => sum + Number(item.current_viable_plants || 0),0),
      pendingAssignments: assignments.filter((item) => item.status === 'assigned').length,
      runningAssignments: assignments.filter((item) => item.status === 'in_progress').length,
      inIntroduction: batches.filter((item) => item.current_stage === 'introduction').length,
      inMultiplication: batches.filter((item) => item.current_stage === 'multiplication').length,
      inRooting: batches.filter((item) => item.current_stage === 'rooting').length,
      readyForField: batches.filter((item) => item.current_stage === 'field_ready').length,
    },
  }
}

async function createBatch(payload,user) {
  if (!canCreateCodes(user)) fail('Tu PIN no tiene permiso para crear códigos de propagación.',403)
  const code = clean(payload.code)
  if (!code) fail('Escribe el nombre del código.')
  const cultivarRows = await query(`SELECT * FROM biotechnology_cultivars WHERE id=$1 AND active=true`,[payload.cultivarId])
  const cultivar = cultivarRows[0]
  if (!cultivar) fail('Selecciona una planta y variedad activas.')
  const settings = (await query(`SELECT default_plants_per_bag FROM biotechnology_settings WHERE id=1`))[0]
  const requestedStage = String(payload.initialStage || 'introduction')
  const stage = ['introduction','multiplication','rooting'].includes(requestedStage) ? requestedStage : 'introduction'
  const target = Number(cultivar.target_subcultures || 10)
  const firstSubculture = stage === 'multiplication' ? integer(payload.initialSubculture || 1,1,target) : null
  if (stage === 'multiplication' && !firstSubculture) fail('Selecciona el subcultivo inicial.')
  await query(
    `INSERT INTO biotechnology_batches
     (code,crop_name,variety,initial_plants,multiplication_factor,target_subcultures,plants_per_bag,
      current_stage,current_subculture,current_viable_plants,status,created_by_user_id,updated_by_user_id,cultivar_id,
      started_on,current_stage_started_on)
     VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,1,'active',$9,$9,$10,$11,$11)`,
    [code,cultivar.crop_name,clean(cultivar.variety),cultivar.multiplication_factor,target,
      Number(settings?.default_plants_per_bag || 4),stage,firstSubculture ? firstSubculture - 1 : 0,user.id,cultivar.id,payload.startedOn || null],
  )
}

async function saveCultivar(payload,user,updating=false) {
  if (!canAdminCodes(user)) fail('Solo administración puede gestionar plantas y variedades.',403)
  const cropName = clean(payload.cropName)
  const variety = String(payload.variety || '').trim()
  const factor = decimal(payload.multiplicationFactor,0.1,100)
  const subcultures = integer(payload.targetSubcultures,1,20)
  if (!cropName || !factor || !subcultures) fail('Completa planta, multiplicador y subcultivos planificados.')
  const global = (await query(`SELECT default_plants_per_bag FROM biotechnology_settings WHERE id=1`))[0]
  if (updating) {
    const rows = await query(
      `UPDATE biotechnology_cultivars SET crop_name=$2,variety=$3,multiplication_factor=$4,
       target_subcultures=$5,active=$6,updated_by_user_id=$7,updated_at=NOW() WHERE id=$1 RETURNING id`,
      [payload.id,cropName,variety,factor,subcultures,payload.active !== false,user.id],
    )
    if (!rows[0]) fail('Planta o variedad no encontrada.',404)
  } else {
    await query(
      `INSERT INTO biotechnology_cultivars
       (crop_name,variety,multiplication_factor,target_subcultures,plants_per_bag,created_by_user_id,updated_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$6)`,
      [cropName,variety,factor,subcultures,Number(global?.default_plants_per_bag || 4),user.id],
    )
  }
}

async function updateSettings(payload,user) {
  if (!canAdminCodes(user)) fail('Solo administración puede cambiar parámetros globales.',403)
  const plantsPerBag = integer(payload.defaultPlantsPerBag,1,20)
  if (!plantsPerBag) fail('El estándar debe estar entre 1 y 20 plantas por bolsa.')
  await query(
    `INSERT INTO biotechnology_settings (id,default_plants_per_bag,updated_by_user_id,updated_at)
     VALUES (1,$1,$2,NOW()) ON CONFLICT (id) DO UPDATE SET
     default_plants_per_bag=EXCLUDED.default_plants_per_bag,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=NOW()`,
    [plantsPerBag,user.id],
  )
  await query(`UPDATE biotechnology_cultivars SET plants_per_bag=$1,updated_by_user_id=$2,updated_at=NOW()`,[plantsPerBag,user.id])
  await query(`UPDATE biotechnology_batches SET plants_per_bag=$1,updated_by_user_id=$2,updated_at=NOW() WHERE status='active'`,[plantsPerBag,user.id])
}

async function updateBatch(payload,user) {
  if (!canAdminCodes(user)) fail('Solo administración puede cambiar los parámetros del código.',403)
  const current = (await query(`SELECT current_subculture,current_stage,current_stage_started_on FROM biotechnology_batches WHERE id=$1`,[payload.batchId]))[0]
  if (!current) fail('Código no encontrado.',404)
  const factor = decimal(payload.multiplicationFactor,0.1,100)
  const target = integer(payload.targetSubcultures,1,20)
  const stage = ['introduction','multiplication','rooting','field_ready','completed'].includes(payload.currentStage) ? payload.currentStage : current.current_stage
  const activeSubculture = stage === 'multiplication'
    ? integer(payload.activeSubculture || Number(current.current_subculture) + 1,1,target)
    : null
  const storedSubculture = activeSubculture ? activeSubculture - 1 : Number(current.current_subculture)
  const code = clean(payload.code)
  const status = ['active','paused','completed'].includes(payload.status) ? payload.status : 'active'
  if (!code) fail('Escribe el nombre del código.')
  if (!factor || !target || (stage === 'multiplication' && !activeSubculture)) fail('Revisa la etapa y los subcultivos planificados.')
  await query(
    `UPDATE biotechnology_batches SET code=$2,multiplication_factor=$3,target_subcultures=$4,
       current_stage=$5,current_subculture=$6,started_on=$7,
       current_stage_started_on=COALESCE($8::date,CASE WHEN current_stage IS DISTINCT FROM $5 OR current_subculture IS DISTINCT FROM $6 THEN CURRENT_DATE ELSE current_stage_started_on END),
       needs_review=$9,status=$10,updated_by_user_id=$11,updated_at=NOW() WHERE id=$1`,
    [payload.batchId,code,factor,target,stage,storedSubculture,payload.startedOn || null,
      payload.currentStageStartedOn || null,payload.needsReview === true || payload.needsReview === 'true',status,user.id],
  )
}

async function archiveBatch(payload,user,restoring=false) {
  if (!canAdminCodes(user)) fail('Solo administración puede gestionar la papelera de códigos.',403)
  if (!restoring) {
    const running = await query(`SELECT id FROM biotechnology_assignments WHERE batch_id=$1 AND status='in_progress'`,[payload.batchId])
    if (running[0]) fail('Finaliza el trabajo en curso antes de enviar este código a la papelera.',409)
  }
  const rows = await query(
    restoring
      ? `UPDATE biotechnology_batches SET archived_at=NULL,archived_by_user_id=NULL,updated_by_user_id=$2,updated_at=NOW()
         WHERE id=$1 AND archived_at IS NOT NULL RETURNING id`
      : `UPDATE biotechnology_batches SET archived_at=NOW(),archived_by_user_id=$2,
           assigned_analyst_id=NULL,assigned_analyst_name=NULL,updated_by_user_id=$2,updated_at=NOW()
         WHERE id=$1 AND archived_at IS NULL RETURNING id`,
    [payload.batchId,user.id],
  )
  if (!rows[0]) fail(restoring ? 'El código no está en la papelera.' : 'El código ya está en la papelera.',404)
  if (!restoring) {
    await query(
      `UPDATE biotechnology_assignments SET status='cancelled',updated_at=NOW()
       WHERE batch_id=$1 AND status='assigned'`,
      [payload.batchId],
    )
  }
}

async function createAssignment(payload,user) {
  if (!canManageAssignments(user)) fail('No tienes permiso para asignar códigos.',403)
  const worker = await assignedWorker(payload.analystId)
  const batch = (await query(`SELECT * FROM biotechnology_batches WHERE id=$1 AND status='active' AND archived_at IS NULL`,[payload.batchId]))[0]
  if (!batch || batch.current_stage === 'completed') fail('El código no está activo.',404)
  const running = await query(`SELECT id FROM biotechnology_assignments WHERE batch_id=$1 AND status='in_progress'`,[batch.id])
  if (running[0]) fail('Este código ya está siendo trabajado. Finaliza esa actividad antes de reasignarlo.',409)
  const periodType = payload.periodType === 'week' ? 'week' : 'day'
  const scheduledFor = /^\d{4}-\d{2}-\d{2}$/.test(payload.scheduledFor || '') ? payload.scheduledFor : new Date().toISOString().slice(0,10)
  const next = assignmentStage(batch)
  if (next.subculture && next.subculture > Number(batch.target_subcultures)) fail('El código ya completó los subcultivos planificados.')
  await query(
    `UPDATE biotechnology_assignments SET status='cancelled',updated_at=NOW()
     WHERE batch_id=$1 AND status='assigned'`,
    [batch.id],
  )
  await query(
    `INSERT INTO biotechnology_assignments
     (batch_id,analyst_id,analyst_name,period_type,scheduled_for,stage,subculture_number,plants_per_bag,created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [batch.id,worker.id,worker.full_name,periodType,scheduledFor,next.stage,next.subculture,batch.plants_per_bag,user.id],
  )
  await query(
    `UPDATE biotechnology_batches SET assigned_analyst_id=$2,assigned_analyst_name=$3,updated_by_user_id=$4,updated_at=NOW() WHERE id=$1`,
    [batch.id,worker.id,worker.full_name,user.id],
  )
}

async function ownedAssignment(payload,user,statuses) {
  if (!user.activeWorker?.id) fail('Identifícate con tu PIN para trabajar este código.',403)
  const rows = await query(
    `SELECT a.*,b.code,b.current_stage,b.current_subculture,b.current_viable_plants,b.multiplication_factor,
            b.target_subcultures,b.status AS batch_status,b.archived_at
     FROM biotechnology_assignments a JOIN biotechnology_batches b ON b.id=a.batch_id
     WHERE a.id=$1 AND a.analyst_id=$2 AND a.status=ANY($3::text[])`,
    [payload.assignmentId,user.activeWorker.id,statuses],
  )
  if (!rows[0]) fail('Esta actividad no está asignada a tu PIN o ya cambió de estado.',404)
  const item = rows[0]
  const expectedSubculture = item.current_stage === 'multiplication' ? Number(item.current_subculture) + 1 : null
  if (item.archived_at || item.batch_status !== 'active' || item.stage !== item.current_stage || Number(item.subculture_number || 0) !== Number(expectedSubculture || 0)) {
    fail('El código avanzó desde que fue asignado. Solicita una nueva asignación.',409)
  }
  return item
}

function runCode() {
  const stamp = new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'America/Lima'}).format(new Date()).replaceAll('-','')
  return `BIO-CFL-${stamp}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`
}

function branchCode(code, performedOn = limaToday()) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(performedOn)) return `${code} ${performedOn.slice(8,10)}-${performedOn.slice(5,7)}`
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', timeZone: 'America/Lima',
  }).formatToParts(new Date())
  const day = parts.find((part) => part.type === 'day')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  return `${code} ${day}-${month}`
}

async function startAssignment(payload,user) {
  const assignment = await ownedAssignment(payload,user,['assigned'])
  let equipment = null
  let run = null
  if (assignment.stage === 'multiplication') {
    const equipmentRows = await query(
      `SELECT e.* FROM laboratory_equipment e
       WHERE e.status='active' AND e.equipment_type='flow_cabinet'
         AND NOT EXISTS (SELECT 1 FROM laboratory_equipment_runs r WHERE r.equipment_id=e.id AND r.status='running')
       ORDER BY e.code LIMIT 1`,
    )
    equipment = equipmentRows[0]
    if (!equipment) fail('Todas las cabinas de flujo están ocupadas. Intenta cuando una quede libre.',409)
    const runRows = await query(
      `INSERT INTO laboratory_equipment_runs
       (record_code,equipment_id,equipment_type,status,material_description,started_at,
        operator_user_id,operator_analyst_id,operator_name,created_by_user_id,updated_by_user_id)
       VALUES ($1,$2,'flow_cabinet','running',$3,NOW(),$4,$5,$6,$4,$4) RETURNING id`,
      [runCode(),equipment.id,`Biotecnología · ${assignment.code} · Subcultivo ${assignment.subculture_number}`,
        user.id,user.activeWorker.id,user.activeWorker.fullName],
    )
    run = runRows[0]
    await query(
      `INSERT INTO laboratory_equipment_run_events (run_id,action,actor_user_id,actor_analyst_id,note)
       VALUES ($1,'started',$2,$3,$4)`,
      [run.id,user.id,user.activeWorker.id,`${user.activeWorker.fullName} inició ${equipment.code} para ${assignment.code}`],
    )
  }
  await query(
    `UPDATE biotechnology_assignments SET status='in_progress',started_at=NOW(),equipment_run_id=$2,
       equipment_code=$3,updated_at=NOW() WHERE id=$1`,
    [assignment.id,run?.id || null,equipment?.code || null],
  )
}

async function createEventFromAssignment(assignment,user,values) {
  await query(
    `INSERT INTO biotechnology_events
     (batch_id,stage,subculture_number,performed_at,input_plants,bags_processed,plants_per_bag,
      expected_output_plants,viable_output_plants,contaminated_plants,discarded_plants,
      worker_analyst_id,worker_name,recorded_by_user_id)
     VALUES ($1,$2,$3,NOW(),$4,$5,$6,$7,$8,0,0,$9,$10,$11)`,
    [assignment.batch_id,assignment.stage,assignment.subculture_number,values.inputPlants,values.outputBags,
      values.plantsPerBag,values.expected,values.outputPlants,user.activeWorker.id,user.activeWorker.fullName,user.id],
  )
}

async function finishAssignment(payload,user) {
  const pre = await query(`SELECT stage,status FROM biotechnology_assignments WHERE id=$1`,[payload.assignmentId])
  const introduction = pre[0]?.stage === 'introduction'
  const assignment = await ownedAssignment(payload,user,introduction ? ['assigned','in_progress'] : ['in_progress'])
  let inputBags = null
  let outputBags = null
  let introducedPlants = null
  let plantsPerBag = Number(assignment.plants_per_bag)
  let inputPlants
  let outputPlants
  if (assignment.stage === 'introduction') {
    introducedPlants = integer(payload.introducedPlants,1,10_000_000)
    if (!introducedPlants) fail('Indica cuántas plantas, cormos o meristemos introdujiste.')
    plantsPerBag = 1
    inputPlants = introducedPlants
    outputPlants = introducedPlants
    outputBags = introducedPlants
  } else {
    inputBags = integer(payload.inputBags,0)
    outputBags = integer(payload.outputBags,0)
    if (inputBags === null || outputBags === null) fail('Indica las bolsas iniciales y finales.')
    inputPlants = inputBags * plantsPerBag
    outputPlants = outputBags * plantsPerBag
  }
  const expected = assignment.stage === 'multiplication'
    ? inputPlants * Number(assignment.multiplication_factor)
    : outputPlants
  await createEventFromAssignment(assignment,user,{inputPlants,outputPlants,outputBags,plantsPerBag,expected})
  if (assignment.equipment_run_id) {
    await query(`UPDATE laboratory_equipment_runs SET status='completed',ended_at=NOW(),updated_by_user_id=$2,updated_at=NOW() WHERE id=$1 AND status='running'`,[assignment.equipment_run_id,user.id])
    await query(
      `INSERT INTO laboratory_equipment_run_events (run_id,action,actor_user_id,actor_analyst_id,note)
       VALUES ($1,'finished',$2,$3,$4)`,
      [assignment.equipment_run_id,user.id,user.activeWorker.id,`${user.activeWorker.fullName} finalizó el uso automático`],
    )
  }
  await query(
    `UPDATE biotechnology_assignments SET status='completed',started_at=COALESCE(started_at,NOW()),ended_at=NOW(),
       input_bags=$2,output_bags=$3,introduced_plants=$4,input_plants=$5,output_plants=$6,
       expected_output_plants=$7,completed_by_user_id=$8,updated_at=NOW() WHERE id=$1`,
    [assignment.id,inputBags,outputBags,introducedPlants,inputPlants,outputPlants,expected,user.id],
  )
  let nextStage = assignment.stage
  let nextSubculture = Number(assignment.current_subculture)
  let status = 'active'
  if (assignment.stage === 'introduction') nextStage = 'multiplication'
  else if (assignment.stage === 'multiplication') {
    nextSubculture = Number(assignment.subculture_number)
    if (nextSubculture >= Number(assignment.target_subcultures)) nextStage = 'rooting'
  } else if (assignment.stage === 'rooting') {
    nextStage = 'field_ready'
  } else {
    nextStage = 'completed'
    status = 'completed'
  }
  await query(
    `UPDATE biotechnology_batches SET current_stage=$2,current_subculture=$3,current_viable_plants=$4,status=$5,
       current_stage_started_on=CURRENT_DATE,
       assigned_analyst_id=NULL,assigned_analyst_name=NULL,updated_by_user_id=$6,updated_at=NOW() WHERE id=$1`,
    [assignment.batch_id,nextStage,nextSubculture,outputPlants,status,user.id],
  )
}

async function recordSimple(payload,user) {
  if (!user.activeWorker?.id || !user.activeWorker?.biotechnologyAccess || user.activeWorker?.codeCreatorOnly) {
    fail('Identifícate con un PIN autorizado de Biotecnología.',403)
  }
  const analyst = await assignedWorker(payload.analystId)
  const collaborator = payload.collaboratorAnalystId
    ? await assignedWorker(payload.collaboratorAnalystId)
    : null
  if (collaborator?.id === analyst.id) fail('Selecciona una colaboradora diferente.')
  const batch = (await query(
    `SELECT * FROM biotechnology_batches WHERE id=$1 AND status='active' AND archived_at IS NULL`,
    [payload.batchId],
  ))[0]
  if (!batch || ['field_ready','completed'].includes(batch.current_stage)) fail('El código ya no está disponible para multiplicación.',404)
  const inputBags = integer(payload.inputBags,0)
  const outputBags = integer(payload.outputBags,0)
  if (inputBags === null || outputBags === null) fail('Indica las bolsas iniciales y finales.')
  const performedOn = recordDate(payload.performedOn)
  const plantsPerBag = Number(batch.plants_per_bag || 1)
  const inputPlants = inputBags * plantsPerBag
  const outputPlants = outputBags * plantsPerBag
  const stage = batch.current_stage
  const currentSubculture = stage === 'multiplication' ? Number(batch.current_subculture) + 1 : null
  const requestedSubculture = payload.targetSubculture === '' || payload.targetSubculture === undefined || payload.targetSubculture === null
    ? null
    : integer(payload.targetSubculture, 1, Number(batch.target_subcultures))
  if (payload.targetSubculture !== '' && payload.targetSubculture !== undefined && payload.targetSubculture !== null && !requestedSubculture) {
    fail('Selecciona un subcultivo de destino válido.')
  }
  const subculture = stage === 'multiplication' ? (requestedSubculture || currentSubculture + 1) : null
  if (subculture && subculture > Number(batch.target_subcultures)) fail('El código ya completó los subcultivos planificados.')
  if (subculture && subculture <= currentSubculture) fail(`El destino debe ser posterior al Subcultivo ${currentSubculture}.`)
  const expected = stage === 'multiplication' ? inputPlants * Number(batch.multiplication_factor) : outputPlants
  const requestedRootingBags = integer(payload.rootingBags ?? (payload.sendToRooting === true ? outputBags : 0),0)
  if (requestedRootingBags === null) fail('Indica una cantidad válida de bolsas para enraizamiento.')
  const rootingBags = stage === 'multiplication' ? requestedRootingBags : 0

  let branchStage = stage
  let branchSubculture = Number(batch.current_subculture)
  let branchStatus = 'active'
  if (stage === 'introduction') {
    branchStage = 'multiplication'
    branchSubculture = 0
  } else if (stage === 'multiplication') {
    branchSubculture = subculture - 1
    if (subculture >= Number(batch.target_subcultures)) branchStage = 'rooting'
  } else if (stage === 'rooting') {
    branchStage = 'field_ready'
  } else {
    branchStage = 'completed'
    branchStatus = 'completed'
  }

  const branch = (await query(
    `INSERT INTO biotechnology_batches
     (code,crop_name,variety,source_material,initial_plants,multiplication_factor,target_subcultures,plants_per_bag,
      current_stage,current_subculture,current_viable_plants,rooting_bags,status,created_by_user_id,updated_by_user_id,cultivar_id,
      started_on,current_stage_started_on,source_note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,$16::date,$16::date,$17)
     RETURNING id`,
    [branchCode(batch.code,performedOn),batch.crop_name,batch.variety,`Rama de ${batch.code}`,
      Math.max(1,outputPlants),batch.multiplication_factor,batch.target_subcultures,plantsPerBag,
      branchStage,branchSubculture,outputPlants,rootingBags,branchStatus,user.id,batch.cultivar_id,
      performedOn,`Generado desde ${batch.code} el ${displayRecordDate(performedOn)}`],
  ))[0]

  await query(
    `INSERT INTO biotechnology_events
     (batch_id,stage,subculture_number,performed_at,input_plants,bags_processed,plants_per_bag,
      expected_output_plants,viable_output_plants,contaminated_plants,discarded_plants,
      worker_analyst_id,worker_name,recorded_by_user_id,collaborator_analyst_id,collaborator_name,rooting_bags)
     VALUES ($1,$2,$3,$4::date + TIME '12:00',$5,$6,$7,$8,$9,0,0,$10,$11,$12,$13,$14,$15)`,
    [branch.id,stage,subculture,performedOn,inputPlants,outputBags,plantsPerBag,expected,outputPlants,
      analyst.id,analyst.full_name,user.id,collaborator?.id || null,collaborator?.full_name || null,rootingBags],
  )
}

export default async function biotechnologyHandler(req,res) {
  const action = req.method === 'GET' ? 'view' : req.method === 'POST' ? 'create' : 'edit'
  const user = await requireUser(req,res,'biotechnology',action)
  if (!user) return
  if (user.role !== 'admin' && !user.activeWorker?.biotechnologyAccess) {
    return json(res,403,{ error:'Biotecnología está habilitada únicamente para el equipo autorizado.' })
  }
  try {
    if (req.method === 'GET') return json(res,200,await listData(user))
    const payload = await body(req)
    if (req.method === 'POST') {
      if (!can(user,'biotechnology','create')) return json(res,403,{ error:'No tienes permiso para registrar producción.' })
      if (payload.action === 'create_batch') await createBatch(payload,user)
      else if (payload.action === 'create_cultivar') await saveCultivar(payload,user)
      else if (payload.action === 'record_simple') await recordSimple(payload,user)
      else if (payload.action === 'record_simple_bulk') {
        if (!Array.isArray(payload.records) || !payload.records.length || payload.records.length > 12) {
          fail('Agrega entre 1 y 12 registros.')
        }
        for (const record of payload.records) await recordSimple(record,user)
      }
      else return json(res,400,{ error:'Acción no reconocida.' })
      return json(res,201,await listData(user))
    }
    if (req.method === 'PATCH') {
      if (!can(user,'biotechnology','edit')) return json(res,403,{ error:'No tienes permiso para editar biotecnología.' })
      if (payload.action === 'update_settings') await updateSettings(payload,user)
      else if (payload.action === 'update_batch') await updateBatch(payload,user)
      else if (payload.action === 'update_cultivar') await saveCultivar(payload,user,true)
      else if (payload.action === 'archive_batch') await archiveBatch(payload,user,false)
      else if (payload.action === 'restore_batch') await archiveBatch(payload,user,true)
      else return json(res,400,{ error:'Acción no reconocida.' })
      return json(res,200,await listData(user))
    }
    return methodNotAllowed(res,['GET','POST','PATCH'])
  } catch (error) {
    if (error.code === '23505') return json(res,409,{ error:'Ese código o esa etapa ya fue registrada.' })
    if (error.code === '23503') return json(res,400,{ error:'El código o la persona ya no está disponible.' })
    if (error.code === '23514' || error.code === '22P02') return json(res,400,{ error:'Revisa los valores ingresados.' })
    console.error(error)
    return json(res,error.status || 500,{ error:error.status ? error.message : 'No fue posible guardar la operación de biotecnología.' })
  }
}
