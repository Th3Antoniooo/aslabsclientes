import crypto from 'node:crypto'
import { query } from './db.js'
import { json, methodNotAllowed } from './http.js'
import { createSampleIntakePdf } from './sample-intake-pdf.js'

function safeName(value, fallback) {
  return String(value || fallback).replace(/[\r\n"]/g, '').replace(/[^A-Za-z0-9._-]/g, '_')
}

async function sampleRecord(id, serviceId) {
  const rows = await query(
    `SELECT i.*,s.code AS service_code,
            COALESCE(NULLIF(s.display_name,''),s.service_type_name) AS service_name,
            s.service_category_name,s.quote_reference,s.zone_name,s.sample_count,s.status AS service_status,
            u.full_name AS client_name,u.company AS client_company,u.email AS client_email,
            ws.title AS current_stage_title,ws.position AS current_stage_position,
            fs.name AS sampling_site_name,fs.address AS sampling_site_address,
            COALESCE(items.analysis_names,'Análisis por definir') AS analysis_names
     FROM sample_intakes i
     JOIN service_requests s ON s.id=i.service_id JOIN users u ON u.id=s.client_user_id
     LEFT JOIN service_workflow_stages ws ON ws.service_id=s.id AND ws.position=s.current_stage_position
     LEFT JOIN field_sites fs ON fs.id=s.sampling_site_id
     LEFT JOIN LATERAL (
       SELECT STRING_AGG(sri.service_name,' · ' ORDER BY sri.sort_order,sri.created_at) AS analysis_names
       FROM service_request_items sri WHERE sri.service_id=s.id
     ) items ON true
     WHERE i.id=$1 AND i.service_id=$2`,
    [id, serviceId],
  )
  return rows[0]
}

export default async function publicDocumentHandler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  const token = String(req.query?.token || '')
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return json(res, 404, { error: 'Documento no disponible.' })
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const rows = await query(`SELECT * FROM public_document_links WHERE token_hash=$1 AND active=true`, [tokenHash])
  const link = rows[0]
  if (!link) return json(res, 404, { error: 'Documento no disponible.' })
  try {
    let content
    let fileName
    if (link.document_type === 'sample_intake') {
      const record = await sampleRecord(link.sample_intake_id, link.service_id)
      if (!record) return json(res, 404, { error: 'Documento no disponible.' })
      content = await createSampleIntakePdf(record)
      fileName = `${record.sample_code}.pdf`
    } else {
      const reports = await query(
        `SELECT file_name,data_url FROM service_final_reports
         WHERE id=$1 AND service_id=$2 AND approval_status='approved' AND is_current=true`,
        [link.final_report_id, link.service_id],
      )
      if (!reports[0]) return json(res, 404, { error: 'Documento no disponible.' })
      content = Buffer.from(String(reports[0].data_url || '').split(',')[1] || '', 'base64')
      fileName = reports[0].file_name
    }
    await query(`UPDATE public_document_links SET last_accessed_at=NOW() WHERE id=$1`, [link.id])
    res.status(200)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Length', String(content.length))
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Disposition', `inline; filename="${safeName(fileName, 'documento.pdf')}"`)
    return res.end(content)
  } catch (error) {
    console.error(error)
    return json(res, 500, { error: 'No fue posible abrir el documento.' })
  }
}
