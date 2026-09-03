import { requireUser } from './auth.js'
import { json, methodNotAllowed } from './http.js'
import { query } from './db.js'

function text(value) {
  return value == null ? '' : String(value)
}

function iso(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function documentItem(row, definition) {
  const serviceId = row.service_id ? text(row.service_id) : ''
  const serviceCode = text(row.service_code)
  return {
    id: `${definition.type}:${row.id}`,
    recordId: text(row.id),
    type: definition.type,
    folder: definition.folder,
    title: definition.title(row),
    fileName: definition.fileName(row),
    documentCode: text(row.document_code),
    date: iso(row.document_date),
    status: definition.status(row),
    statusLabel: definition.statusLabel(row),
    serviceId,
    serviceCode,
    serviceName: text(row.service_name),
    clientName: text(row.client_name),
    clientCompany: text(row.client_company),
    responsible: text(row.responsible_name),
    equipment: text(row.equipment_label),
    href: definition.href(row),
    meta: text(definition.meta?.(row)),
  }
}

export default async function handler(req, res) {
  const user = await requireUser(req, res, 'users', 'view')
  if (!user) return
  if (user.role !== 'admin') return json(res, 403, { error: 'La documentación administrativa está disponible solo para administradores.' })
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])

  const [samples, stages, labSteps, equipmentRuns, cycles, releases, nonconformities, finalReports] = await Promise.all([
    query(
      `SELECT i.id, i.sample_code AS document_code, i.received_at AS document_date,
              i.processing_status, i.sample_conforming, i.material_conforming,
              i.microbiologist_name AS responsible_name,
              s.id AS service_id, s.code AS service_code,
              COALESCE(NULLIF(s.display_name,''),s.service_type_name) AS service_name,
              u.full_name AS client_name, u.company AS client_company
       FROM sample_intakes i
       JOIN service_requests s ON s.id=i.service_id
       JOIN users u ON u.id=s.client_user_id
       ORDER BY i.received_at DESC`,
    ),
    query(
      `SELECT ws.id, ws.title, ws.stage_key, ws.status,
              COALESCE(ws.updated_at,ws.created_at) AS document_date,
              ws.performed_by AS responsible_name,
              s.id AS service_id, s.code AS service_code,
              COALESCE(NULLIF(s.display_name,''),s.service_type_name) AS service_name,
              u.full_name AS client_name, u.company AS client_company
       FROM service_workflow_stages ws
       JOIN service_requests s ON s.id=ws.service_id
       JOIN users u ON u.id=s.client_user_id
       WHERE ws.status IN ('current','completed')
       ORDER BY COALESCE(ws.updated_at,ws.created_at) DESC`,
    ),
    query(
      `SELECT ps.id, ps.process_id, ps.document_code, ps.title, ps.status,
              COALESCE(ps.completed_at,ps.updated_at,ps.created_at) AS document_date,
              ps.completed_by_name AS responsible_name,
              s.id AS service_id, s.code AS service_code,
              COALESCE(NULLIF(s.display_name,''),s.service_type_name) AS service_name,
              u.full_name AS client_name, u.company AS client_company
       FROM laboratory_process_steps ps
       JOIN laboratory_service_processes p ON p.id=ps.process_id
       JOIN service_requests s ON s.id=p.service_id
       JOIN users u ON u.id=s.client_user_id
       WHERE ps.status IN ('current','completed')
       ORDER BY COALESCE(ps.completed_at,ps.updated_at,ps.created_at) DESC`,
    ),
    query(
      `SELECT r.id, r.record_code AS document_code,
              COALESCE(r.ended_at,r.started_at,r.created_at) AS document_date,
              r.status, r.operator_name AS responsible_name, r.work_area,
              CONCAT_WS(' · ',e.code,e.name) AS equipment_label,
              COALESCE(string_agg(DISTINCT s.code, ', '),'') AS service_code,
              COALESCE(string_agg(DISTINCT COALESCE(NULLIF(s.display_name,''),s.service_type_name), ', '),'') AS service_name,
              COALESCE(string_agg(DISTINCT u.full_name, ', '),'') AS client_name,
              COALESCE(string_agg(DISTINCT u.company, ', '),'') AS client_company
       FROM laboratory_equipment_runs r
       JOIN laboratory_equipment e ON e.id=r.equipment_id
       LEFT JOIN laboratory_equipment_run_services rs ON rs.run_id=r.id
       LEFT JOIN service_requests s ON s.id=rs.service_id
       LEFT JOIN users u ON u.id=s.client_user_id
       WHERE r.status <> 'cancelled'
       GROUP BY r.id,e.code,e.name
       ORDER BY COALESCE(r.ended_at,r.started_at,r.created_at) DESC`,
    ),
    query(
      `SELECT c.id, c.record_code AS document_code, c.started_at AS document_date,
              c.result AS status, c.operator_name AS responsible_name,
              CONCAT_WS(' · ',e.code,e.name) AS equipment_label,
              s.id AS service_id, s.code AS service_code,
              COALESCE(NULLIF(s.display_name,''),s.service_type_name) AS service_name,
              u.full_name AS client_name, u.company AS client_company
       FROM autoclave_cycles c
       JOIN laboratory_equipment e ON e.id=c.equipment_id
       JOIN service_requests s ON s.id=c.service_id
       JOIN users u ON u.id=s.client_user_id
       ORDER BY c.started_at DESC`,
    ),
    query(
      `SELECT r.id, r.record_code AS document_code, r.released_at AS document_date,
              r.release_result AS status, r.released_by_name AS responsible_name,
              CONCAT_WS(' · ',e.code,e.name) AS equipment_label,
              s.id AS service_id, s.code AS service_code,
              COALESCE(NULLIF(s.display_name,''),s.service_type_name) AS service_name,
              u.full_name AS client_name, u.company AS client_company
       FROM autoclave_material_releases r
       JOIN autoclave_cycles c ON c.id=r.cycle_id
       JOIN laboratory_equipment e ON e.id=c.equipment_id
       JOIN service_requests s ON s.id=c.service_id
       JOIN users u ON u.id=s.client_user_id
       ORDER BY r.released_at DESC`,
    ),
    query(
      `SELECT n.id, n.record_code AS document_code, n.detected_at AS document_date,
              n.status, n.responsible_name,
              CONCAT_WS(' · ',e.code,e.name) AS equipment_label,
              s.id AS service_id, s.code AS service_code,
              COALESCE(NULLIF(s.display_name,''),s.service_type_name) AS service_name,
              u.full_name AS client_name, u.company AS client_company
       FROM autoclave_nonconformities n
       JOIN autoclave_cycles c ON c.id=n.cycle_id
       JOIN laboratory_equipment e ON e.id=c.equipment_id
       JOIN service_requests s ON s.id=c.service_id
       JOIN users u ON u.id=s.client_user_id
       ORDER BY n.detected_at DESC`,
    ),
    query(
      `SELECT r.id, r.file_name, r.version, r.approval_status AS status,
              COALESCE(r.approved_at,r.created_at) AS document_date,
              uploader.full_name AS responsible_name,
              s.id AS service_id, s.code AS service_code,
              COALESCE(NULLIF(s.display_name,''),s.service_type_name) AS service_name,
              u.full_name AS client_name, u.company AS client_company
       FROM service_final_reports r
       JOIN service_requests s ON s.id=r.service_id
       JOIN users u ON u.id=s.client_user_id
       LEFT JOIN users uploader ON uploader.id=r.uploaded_by_user_id
       ORDER BY COALESCE(r.approved_at,r.created_at) DESC`,
    ),
  ])

  const documents = [
    ...samples.map((row) => documentItem(row, {
      type: 'sample', folder: 'samples',
      title: (item) => `Ingreso de muestra ${item.document_code}`,
      fileName: (item) => `${item.document_code}.pdf`,
      status: (item) => item.sample_conforming && item.material_conforming ? 'available' : 'attention',
      statusLabel: (item) => item.sample_conforming && item.material_conforming ? 'Conforme' : 'Revisar conformidad',
      href: (item) => `/api/service-workflow?sampleIntake=1&serviceId=${encodeURIComponent(item.service_id)}&id=${encodeURIComponent(item.id)}&format=pdf`,
      meta: (item) => item.processing_status === 'completed' ? 'Procesamiento finalizado' : item.processing_status === 'processing' ? 'En procesamiento' : 'Muestra almacenada',
    })),
    ...stages.map((row) => documentItem(row, {
      type: 'stage', folder: 'traceability',
      title: (item) => `Trazabilidad · ${item.title}`,
      fileName: (item) => `${item.service_code}-${item.stage_key || 'etapa'}.pdf`,
      status: (item) => item.status === 'completed' ? 'available' : 'active',
      statusLabel: (item) => item.status === 'completed' ? 'Etapa completada' : 'Etapa actual',
      href: (item) => `/api/service-workflow?serviceId=${encodeURIComponent(item.service_id)}&stageId=${encodeURIComponent(item.id)}&format=pdf`,
      meta: (item) => item.title,
    })),
    ...labSteps.map((row) => documentItem(row, {
      type: 'lab-step', folder: 'microbiology',
      title: (item) => `${item.document_code} · ${item.title}`,
      fileName: (item) => `${item.service_code}-${item.document_code}.pdf`,
      status: (item) => item.status === 'completed' ? 'available' : 'active',
      statusLabel: (item) => item.status === 'completed' ? 'Completado' : 'En curso',
      href: (item) => `/api/service-workflow?serviceId=${encodeURIComponent(item.service_id)}&format=lab-step&processId=${encodeURIComponent(item.process_id)}&labStepId=${encodeURIComponent(item.id)}`,
      meta: (item) => item.title,
    })),
    ...equipmentRuns.map((row) => documentItem(row, {
      type: 'equipment-run', folder: 'equipment',
      title: (item) => `Uso de equipo · ${item.equipment_label}`,
      fileName: (item) => `${item.document_code}.pdf`,
      status: (item) => item.status === 'completed' ? 'available' : 'active',
      statusLabel: (item) => item.status === 'completed' ? 'Finalizado' : 'Equipo en uso',
      href: (item) => `/api/services?labOperations=1&format=pdf&type=equipment-run&id=${encodeURIComponent(item.id)}`,
      meta: (item) => item.work_area === 'biotechnology' ? 'Área de Biotecnología' : 'Laboratorio de análisis',
    })),
    ...cycles.map((row) => documentItem(row, {
      type: 'autoclave-cycle', folder: 'equipment',
      title: (item) => `Ciclo de autoclave · ${item.document_code}`,
      fileName: (item) => `${item.document_code}.pdf`,
      status: (item) => item.status === 'nonconforming' ? 'attention' : item.status === 'pending' ? 'active' : 'available',
      statusLabel: (item) => item.status === 'nonconforming' ? 'No conforme' : item.status === 'pending' ? 'Pendiente' : 'Conforme',
      href: (item) => `/api/services?labOperations=1&format=pdf&type=cycle&id=${encodeURIComponent(item.id)}`,
      meta: (item) => item.equipment_label,
    })),
    ...releases.map((row) => documentItem(row, {
      type: 'material-release', folder: 'equipment',
      title: (item) => `Liberación de material · ${item.document_code}`,
      fileName: (item) => `${item.document_code}.pdf`,
      status: (item) => item.status === 'rejected' ? 'attention' : item.status === 'pending' ? 'active' : 'available',
      statusLabel: (item) => item.status === 'rejected' ? 'Rechazado' : item.status === 'pending' ? 'Pendiente' : 'Liberado',
      href: (item) => `/api/services?labOperations=1&format=pdf&type=release&id=${encodeURIComponent(item.id)}`,
      meta: (item) => item.equipment_label,
    })),
    ...nonconformities.map((row) => documentItem(row, {
      type: 'nonconformity', folder: 'nonconformities',
      title: (item) => `No conformidad · ${item.document_code}`,
      fileName: (item) => `${item.document_code}.pdf`,
      status: (item) => item.status === 'closed' ? 'available' : 'attention',
      statusLabel: (item) => item.status === 'closed' ? 'Cerrada' : item.status === 'in_review' ? 'En revisión' : 'Abierta',
      href: (item) => `/api/services?labOperations=1&format=pdf&type=nonconformity&id=${encodeURIComponent(item.id)}`,
      meta: (item) => item.equipment_label,
    })),
    ...finalReports.map((row) => documentItem({ ...row, document_code: `v${row.version}` }, {
      type: 'final-report', folder: 'reports',
      title: (item) => `Informe final · ${item.file_name}`,
      fileName: (item) => item.file_name,
      status: (item) => item.status === 'approved' ? 'available' : item.status === 'rejected' ? 'attention' : 'active',
      statusLabel: (item) => item.status === 'approved' ? 'Aprobado' : item.status === 'rejected' ? 'Rechazado' : 'Por aprobar',
      href: (item) => `/api/service-workflow?serviceId=${encodeURIComponent(item.service_id)}&format=final-report&reportId=${encodeURIComponent(item.id)}`,
      meta: (item) => `Versión ${item.version}`,
    })),
  ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))

  const byFolder = documents.reduce((totals, item) => ({ ...totals, [item.folder]: (totals[item.folder] || 0) + 1 }), {})
  return json(res, 200, {
    documents,
    summary: {
      total: documents.length,
      available: documents.filter((item) => item.status === 'available').length,
      active: documents.filter((item) => item.status === 'active').length,
      attention: documents.filter((item) => item.status === 'attention').length,
      byFolder,
    },
  })
}
