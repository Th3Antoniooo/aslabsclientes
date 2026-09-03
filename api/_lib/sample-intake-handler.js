import { requireUser } from './auth.js'
import { body, json, methodNotAllowed } from './http.js'
import { query } from './db.js'
import { createSampleIntakePdf } from './sample-intake-pdf.js'
import { sendSampleReceivedEmail } from './email.js'

const locations = new Set(['refrigerator', 'room_temperature_table', 'other'])
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }) }
function validSignature(value) { return typeof value === 'string' && value.startsWith('data:image/png;base64,') && value.length < 450000 }
function actorName(user) { return user.activeWorker?.fullName || user.nombre }
function canReceive(user) { return user.role === 'admin' || Boolean(user.activeWorker) }

async function receivingAnalysts() {
  return query(
    `SELECT id,full_name,
            CASE WHEN LOWER(full_name) LIKE '%melissa%' THEN 'digital' ELSE 'image' END AS signature_type
     FROM analysts
     WHERE status='active' AND (
       LOWER(full_name) LIKE '%antonio guevara%'
       OR LOWER(full_name) LIKE '%melissa%torres%'
       OR LOWER(full_name) LIKE '%renzo%'
       OR LOWER(full_name) LIKE '%nancy%mejia%'
     )
     ORDER BY CASE
       WHEN LOWER(full_name) LIKE '%antonio%' THEN 1
       WHEN LOWER(full_name) LIKE '%melissa%' THEN 2
       WHEN LOWER(full_name) LIKE '%renzo%' THEN 3
       ELSE 4 END`,
  )
}

async function serviceAccess(user, serviceId) {
  const rows = await query(
    `SELECT s.id,s.code,s.client_user_id,s.sample_count,s.sample_intake_mode
     FROM service_requests s WHERE s.id=$1 AND s.archived_at IS NULL AND
       ($2=true OR s.client_user_id=$3 OR EXISTS (SELECT 1 FROM worker_service_assignments w WHERE w.service_id=s.id AND w.analyst_id=$4 AND w.active=true))`,
    [serviceId,user.role==='admin',user.id,user.activeWorker?.id || null],
  )
  return rows[0]
}

async function rows(serviceId) {
  return query(
    `SELECT i.*,s.code AS service_code FROM sample_intakes i JOIN service_requests s ON s.id=i.service_id
     WHERE i.service_id=$1 ORDER BY i.received_at DESC`, [serviceId],
  )
}

function publicRecord(record, internal) {
  if (internal) return record
  return {
    id: record.id, sample_code: record.sample_code, service_code: record.service_code,
    received_at: record.received_at,
  }
}

export default async function handler(req, res) {
  const user = await requireUser(req, res)
  if (!user) return
  const serviceId = req.query?.serviceId
  const service = await serviceAccess(user, serviceId)
  if (!service) return json(res, 404, { error: 'Orden no disponible.' })
  const internal = user.role === 'admin' || Boolean(user.activeWorker)
  try {
    if (req.method === 'GET' && req.query?.format === 'pdf') {
      const records = await query(
        `SELECT i.*,s.code AS service_code,
                COALESCE(NULLIF(s.display_name,''),s.service_type_name) AS service_name,
                s.service_category_name,s.quote_reference,s.zone_name,s.sample_count,s.status AS service_status,
                u.full_name AS client_name,u.company AS client_company,u.email AS client_email,
                ws.title AS current_stage_title,ws.position AS current_stage_position,
                fs.name AS sampling_site_name,fs.address AS sampling_site_address,
                COALESCE(items.analysis_names,'Análisis por definir') AS analysis_names
         FROM sample_intakes i
         JOIN service_requests s ON s.id=i.service_id
         JOIN users u ON u.id=s.client_user_id
         LEFT JOIN service_workflow_stages ws ON ws.service_id=s.id AND ws.position=s.current_stage_position
         LEFT JOIN field_sites fs ON fs.id=s.sampling_site_id
         LEFT JOIN LATERAL (
           SELECT STRING_AGG(sri.service_name, ' · ' ORDER BY sri.sort_order,sri.created_at) AS analysis_names
           FROM service_request_items sri WHERE sri.service_id=s.id
         ) items ON true
         WHERE i.id=$1 AND i.service_id=$2`,
        [req.query.id,serviceId],
      )
      if (!records[0]) return json(res, 404, { error: 'Formato no disponible.' })
      const pdf = await createSampleIntakePdf(records[0])
      res.status(200); res.setHeader('Content-Type','application/pdf'); res.setHeader('Content-Length',String(pdf.length)); res.setHeader('Cache-Control','private, no-store'); res.setHeader('Content-Disposition',`inline; filename="${records[0].sample_code}.pdf"`); return res.end(pdf)
    }
    if (req.method === 'GET') {
      const records = await rows(serviceId)
      return json(res, 200, { intakes: records.map((item) => publicRecord(item, internal)), canReceive: internal && canReceive(user) && service.sample_intake_mode !== 'none', sampleRequired: service.sample_intake_mode !== 'none', receivingAnalysts: internal ? await receivingAnalysts() : [], internal })
    }
    const payload = await body(req)
    if (req.method === 'POST') {
      if (!internal || !canReceive(user)) fail('Tu perfil no está autorizado para registrar el ingreso de muestras.', 403)
      if (service.sample_intake_mode === 'none') fail('Esta orden fue configurada sin ingreso de muestra.', 409)
      if (!['client_delivery','aslabs_collection'].includes(payload.intakeType)) fail('Selecciona cómo ingresó la muestra.')
      const allowedReceivers = await receivingAnalysts()
      const receiver = allowedReceivers.find((item) => item.id === payload.receivedByAnalystId)
      if (!receiver) fail('Selecciona quién recibió la muestra entre los analistas con firma disponible.')
      if (!validSignature(payload.clientSignature)) fail('Se requiere la firma de conformidad del cliente.')
      const sampleConforming = payload.sampleConforming !== false
      const materialConforming = payload.materialConforming !== false
      if ((!sampleConforming || !materialConforming) && !payload.nonconformityNotes?.trim()) fail('Describe la no conformidad encontrada.')
      const rating = payload.intakeType === 'aslabs_collection' ? Number(payload.satisfactionRating) : null
      if (payload.intakeType === 'aslabs_collection' && (!Number.isInteger(rating) || rating < 1 || rating > 5)) fail('Registra la satisfacción del cliente de 1 a 5.')
      const created = []
      const sampleCount = Math.max(1, Number(service.sample_count || 1))
      for (let index = 0; index < sampleCount; index += 1) {
        const description = sampleCount > 1
          ? `${payload.sampleDescription?.trim() || 'Muestra recibida'} · Muestra ${index + 1}`
          : payload.sampleDescription?.trim() || 'Muestra recibida'
        const inserted = await query(
          `INSERT INTO sample_intakes
           (service_id,sample_code,intake_type,received_at,analysis_due_at,sample_description,collected_by_name,
            client_representative_name,client_signature_data_url,microbiologist_name,received_by_analyst_id,microbiologist_signature_data_url,
            material_conforming,sample_conforming,nonconformity_notes,satisfaction_rating,satisfaction_notes,
            storage_location,storage_detail,created_by_user_id,updated_by_user_id)
           VALUES ($1,$2,$3,COALESCE($4::timestamptz,NOW()),$5::timestamptz,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20)
           ON CONFLICT (sample_code) DO NOTHING
           RETURNING id,sample_code,sample_description,intake_type,received_at`,
          [serviceId,`${service.code}-${index + 1}`,payload.intakeType,payload.receivedAt || null,payload.analysisDueAt || null,description,actorName(user),payload.clientRepresentativeName?.trim() || 'Cliente / representante',payload.clientSignature,receiver.full_name,receiver.id,null,materialConforming,sampleConforming,payload.nonconformityNotes?.trim() || null,rating,payload.satisfactionNotes?.trim() || null,locations.has(payload.storageLocation) ? payload.storageLocation : null,payload.storageDetail?.trim() || null,user.id],
        )
        if (inserted[0]) created.push(inserted[0])
      }
      if (!created.length) fail('Las muestras de esta orden ya fueron registradas.', 409)
      await query(
        `INSERT INTO notifications (user_id,title,body,type,priority,audience,action_url)
         SELECT worker.id,
                CASE WHEN assigned.full_name IS NULL THEN 'Nueva muestra recibida'
                     ELSE assigned.full_name || ' tiene nueva muestra' END,
                $2 || ' · ' || $3 || ' · ' || $4,
                'sample','high','all','dashboard'
         FROM users worker
         LEFT JOIN LATERAL (
           SELECT a.full_name FROM worker_service_assignments wsa
           JOIN analysts a ON a.id=wsa.analyst_id
           WHERE wsa.service_id=$1 AND wsa.active=true AND a.biotechnology_access=false
           ORDER BY a.full_name
         ) assigned ON true
         WHERE LOWER(worker.email)='as@aslaboratorios.com' AND worker.status='active'`,
        [serviceId,created[0].sample_code,service.code,created[0].sample_description],
      )
      await query(
        `UPDATE crew_service_assignments
         SET status='completed',progress=100,updated_at=NOW()
         WHERE service_id=$1 AND assignment_type='sampling'`,
        [serviceId],
      )
      await sendSampleReceivedEmail(
        serviceId,
        created[0].id,
        created[0].intake_type,
        created[0].received_at,
      )
      return json(res, 201, { intakes: await rows(serviceId), canReceive: true, sampleRequired: true, receivingAnalysts: allowedReceivers, internal: true, createdIntakeId: created[0].id })
    }
    if (req.method === 'PATCH') {
      if (!internal) fail('Acción interna no disponible.', 403)
      const records = await query(`SELECT * FROM sample_intakes WHERE id=$1 AND service_id=$2`, [payload.id,serviceId])
      const record = records[0]
      if (!record) fail('Muestra no encontrada.', 404)
      if (payload.action === 'set_storage') {
        if (!locations.has(payload.storageLocation)) fail('Selecciona una ubicación válida.')
        await query(`UPDATE sample_intakes SET storage_location=$2,storage_detail=$3,updated_by_user_id=$4,updated_at=NOW() WHERE id=$1`, [record.id,payload.storageLocation,payload.storageDetail?.trim() || null,user.id])
      } else if (payload.action === 'start_processing') {
        if (!user.activeWorker && user.role !== 'admin') fail('Solo un analista asignado puede iniciar el procesamiento.', 403)
        await query(`UPDATE sample_intakes SET processing_status='processing',processing_started_at=COALESCE(processing_started_at,NOW()),processing_by_analyst_id=$2,processing_by_name=$3,updated_by_user_id=$4,updated_at=NOW() WHERE id=$1 AND processing_status='stored'`, [record.id,user.activeWorker?.id || null,actorName(user),user.id])
      } else if (payload.action === 'mark_client_copy_printed') {
        await query(
          `UPDATE sample_intakes
           SET client_copy_printed_at=COALESCE(client_copy_printed_at,NOW()),
               client_copy_printed_by_user_id=COALESCE(client_copy_printed_by_user_id,$2),
               updated_by_user_id=$2,updated_at=NOW()
           WHERE id=$1`,
          [record.id,user.id],
        )
      } else if (payload.action === 'finish_processing') {
        fail('El cronómetro se detiene automáticamente al pasar a la etapa de emisión del informe.', 409)
      } else fail('Acción no reconocida.')
      return json(res, 200, { intakes: await rows(serviceId), canReceive: canReceive(user) && service.sample_intake_mode !== 'none', sampleRequired: service.sample_intake_mode !== 'none', receivingAnalysts: await receivingAnalysts(), internal: true })
    }
    return methodNotAllowed(res,['GET','POST','PATCH'])
  } catch (error) {
    console.error(error)
    return json(res,error.status || 500,{ error: error.status ? error.message : 'No fue posible actualizar el flujo de muestras.' })
  }
}
