import fs from 'node:fs'
import PDFDocument from 'pdfkit'
import { json } from './http.js'
import { query } from './db.js'
import { drawOfficialSignatures, setupPdfStyle } from './pdf-style.js'

const COLORS = {
  brand: '#559642',
  brandDark: '#17651f',
  brandDeep: '#153d26',
  text: '#171c19',
  muted: '#65716a',
  line: '#d6ddd8',
  pale: '#f4f7f4',
  paleGreen: '#edf5eb',
  white: '#ffffff',
  amber: '#b96d22',
}

const PAGE = { left: 46, right: 549, width: 503, bottom: 774 }

let logoBuffer
try {
  logoBuffer = fs.readFileSync(new URL('../../src/assets/aslabs-logo.png', import.meta.url))
} catch {
  logoBuffer = null
}

function formatDate(value) {
  if (!value) return 'Sin registrar'
  return new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Lima',
  }).format(new Date(value))
}

function formatDateOnly(value) {
  if (!value) return 'Sin registrar'
  return new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'medium',
    timeZone: 'America/Lima',
  }).format(new Date(value))
}

function statusLabel(status) {
  return {
    pending: 'Pendiente',
    current: 'Etapa actual',
    completed: 'Completada',
    accepted: 'Aceptado',
    in_progress: 'En proceso',
    rejected: 'Rechazado',
  }[status] || status || 'Sin registrar'
}

function drawCompanyHeader(doc) {
  doc.rect(PAGE.left, 24, PAGE.width, 5).fill(COLORS.brand)
  doc.fillColor(COLORS.text).font('Arial-Bold').fontSize(11)
    .text('REPORTE DE TRAZABILIDAD', PAGE.left, 43)
  doc.fillColor(COLORS.text).font('Arial').fontSize(11)
    .text('AS LABORATORIOS CONTROL BIOLÓGICO S.A.C. · RUC 20440181792', PAGE.left, 60)
    .text('Jr. Huancavelica 315, Palermo, Trujillo · ventas@aslaboratorios.com · +51 961 996 645', PAGE.left, 73, { width: 365 })
  if (logoBuffer) {
    doc.image(logoBuffer, 416, 36, { fit: [132, 58], align: 'right', valign: 'center' })
  } else {
    doc.fillColor(COLORS.brandDark).font('Arial-Bold').fontSize(11)
      .text('ASLabs', 420, 73, { width: 128, align: 'right' })
  }
  doc.moveTo(PAGE.left, 103).lineTo(PAGE.right, 103).strokeColor(COLORS.line).lineWidth(1).stroke()
}

function drawContinuationHeader(doc, stage) {
  doc.rect(PAGE.left, 32, PAGE.width, 5).fill(COLORS.brand)
  if (logoBuffer) doc.image(logoBuffer, 444, 43, { fit: [104, 47], align: 'right' })
  doc.fillColor(COLORS.brandDark).font('Arial-Bold').fontSize(11)
    .text('AS LABORATORIOS', PAGE.left, 49)
  doc.fillColor(COLORS.text).font('Arial-Bold').fontSize(11)
    .text('Reporte de trazabilidad', PAGE.left, 63)
  doc.fillColor(COLORS.muted).font('Arial').fontSize(11)
    .text(`${stage.code}  |  ${stage.title}`, PAGE.left, 80, { width: 350 })
  doc.moveTo(PAGE.left, 97).lineTo(PAGE.right, 97).strokeColor(COLORS.line).stroke()
  return 114
}

function drawSectionBar(doc, title, y) {
  doc.roundedRect(PAGE.left, y, PAGE.width, 20, 6).fill(COLORS.brand)
  doc.fillColor(COLORS.white).font('Arial-Bold').fontSize(11)
    .text(title.toUpperCase(), PAGE.left + 10, y + 6, { width: PAGE.width - 20 })
  return y + 20
}

function drawFourColumnTable(doc, rows, y) {
  const widths = [85, 171, 84, 163]
  const x = [
    PAGE.left,
    PAGE.left + widths[0],
    PAGE.left + widths[0] + widths[1],
    PAGE.left + widths[0] + widths[1] + widths[2],
  ]
  for (const [index, row] of rows.entries()) {
    const heights = row.map((cell,index) => doc.heightOfString(String(cell || 'Sin registrar'), { width: widths[index] - 18 }))
    const rowHeight = Math.max(22, Math.max(...heights) + 10)
    if (index % 2 === 0) doc.rect(PAGE.left, y, PAGE.width, rowHeight).fill(COLORS.pale)
    doc.fillColor(COLORS.muted).font('Arial-Bold').fontSize(11)
      .text(String(row[0]).toUpperCase(), x[0] + 9, y + 6, { width: widths[0] - 18 })
      .text(String(row[2]).toUpperCase(), x[2] + 9, y + 6, { width: widths[2] - 18 })
    doc.fillColor(COLORS.text).font('Arial').fontSize(11)
      .text(String(row[1] || 'Sin registrar'), x[1] + 9, y + 6, { width: widths[1] - 18 })
      .text(String(row[3] || 'Sin registrar'), x[3] + 9, y + 6, { width: widths[3] - 18 })
    doc.moveTo(PAGE.left, y + rowHeight).lineTo(PAGE.right, y + rowHeight)
      .strokeColor(COLORS.line).lineWidth(.7).stroke()
    y += rowHeight
  }
  return y
}

function drawStageTable(doc, stage, y) {
  const columns = [
    { title: 'Etapa', width: 165, value: stage.title },
    { title: 'Estado', width: 82, value: statusLabel(stage.stage_status) },
    { title: 'Responsable', width: 128, value: stage.performed_by || 'Sin registrar' },
    { title: 'Analista', width: 128, value: stage.analyst || 'Sin registrar' },
  ]
  let x = PAGE.left
  for (const column of columns) {
    doc.rect(x, y, column.width, 20).fill(COLORS.brand)
    doc.fillColor(COLORS.white).font('Arial-Bold').fontSize(11)
      .text(column.title, x + 8, y + 6, { width: column.width - 16 })
    x += column.width
  }
  y += 20
  const rowHeight = Math.max(
    30,
    ...columns.map((column) => doc.heightOfString(String(column.value), { width: column.width - 16 }) + 12),
  )
  x = PAGE.left
  for (const column of columns) {
    doc.rect(x, y, column.width, rowHeight).fill(COLORS.white)
      .strokeColor(COLORS.line).lineWidth(.6).stroke()
    doc.fillColor(COLORS.text).font('Arial').fontSize(11)
      .text(String(column.value), x + 8, y + 6, { width: column.width - 16 })
    x += column.width
  }
  return y + rowHeight
}

function addFooter(doc, pageNumber, totalPages) {
  const previousBottom = doc.page.margins.bottom
  doc.page.margins.bottom = 0
  doc.moveTo(PAGE.left, 791).lineTo(PAGE.right, 791).strokeColor(COLORS.line).lineWidth(.7).stroke()
  doc.fillColor(COLORS.muted).font('Arial').fontSize(11)
    .text('AS LABORATORIOS | Documento de trazabilidad', PAGE.left, 801, { width: 390, lineBreak: false })
    .text(`Página ${pageNumber} de ${totalPages}`, 450, 801, { width: 99, align: 'right', lineBreak: false })
  doc.page.margins.bottom = previousBottom
}

export default async function generateStagePdf({ res, user, serviceId, stageId }) {
  if (!serviceId || !stageId) return json(res, 400, { error: 'Falta la etapa del servicio.' })

  const rows = await query(
    `SELECT s.id AS service_id, s.code,
            COALESCE(NULLIF(s.display_name, ''), s.service_type_name) AS service_type_name,
            s.service_category_name, s.quote_reference, s.zone_name,
            s.sample_count, s.requested_at, s.accepted_at,s.current_stage_position,s.status AS service_status,
            c.full_name AS client_name, c.company AS client_company, c.email AS client_email,
            ws.id AS stage_id, ws.stage_key,ws.position, ws.title, ws.status AS stage_status,
            ws.performed_by, ws.analyst, ws.observations, ws.started_at, ws.completed_at,
            ws.created_at, ws.updated_at, a.specialty, a.license_number,
            fs.name AS sampling_site_name,fs.address AS sampling_site_address,
            (SELECT COUNT(*)::int FROM service_workflow_stages count_ws WHERE count_ws.service_id=s.id) AS total_stages,
            COALESCE(items.service_items, '[]'::jsonb) AS service_items
     FROM service_requests s
     JOIN users c ON c.id = s.client_user_id
     JOIN service_workflow_stages ws ON ws.service_id = s.id
     LEFT JOIN analysts a ON a.id = ws.analyst_id
     LEFT JOIN field_sites fs ON fs.id=s.sampling_site_id
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object(
         'name', item.service_name,
         'categoryName', item.category_name
       ) ORDER BY item.sort_order, item.created_at) AS service_items
       FROM service_request_items item
       WHERE item.service_id = s.id
     ) items ON true
     WHERE s.id = $1 AND ws.id = $2 AND ($3 = true OR s.client_user_id = $4)`,
    [serviceId, stageId, user.role === 'admin', user.id],
  )
  const stage = rows[0]
  if (!stage) return json(res, 404, { error: 'Etapa no encontrada.' })

  const [photos, crews, sampleIntakes, equipmentRuns] = await Promise.all([
    query(
      `SELECT id, file_name, mime_type, data_url, created_at
       FROM service_stage_photos WHERE stage_id = $1 ORDER BY created_at`,
      [stageId],
    ),
    query(
      `SELECT c.name, c.status_text, c.operational_state, a.assignment_type,
              a.status, a.scheduled_at,
              COALESCE((
                SELECT string_agg(m.full_name, ', ' ORDER BY m.full_name)
                FROM crew_memberships cm JOIN crew_members m ON m.id = cm.member_id
                WHERE cm.crew_id = c.id AND cm.active = true AND m.status = 'active'
              ), 'Integrantes por asignar') AS members
       FROM crew_service_assignments a
       JOIN field_crews c ON c.id = a.crew_id
       WHERE a.service_id = $1
       ORDER BY COALESCE(a.scheduled_at, a.created_at)`,
      [serviceId],
    ),
    query(
      `SELECT sample_code,intake_type,received_at,sample_description,sample_conforming,material_conforming,
              processing_status,processing_started_at,processing_ended_at,analysis_due_at,
              client_representative_name,microbiologist_name,storage_location,storage_detail,
              nonconformity_notes,satisfaction_rating
       FROM sample_intakes WHERE service_id=$1 ORDER BY received_at`,
      [serviceId],
    ),
    query(
      `SELECT r.record_code,e.code AS equipment_code,e.name AS equipment_name,r.material_description,r.status,
              r.operator_name,r.started_at,r.ended_at,r.expected_end_at,r.temperature_c,r.pressure_bar,r.rpm,
              (SELECT COUNT(*)::int FROM laboratory_equipment_run_nonconformities nc WHERE nc.run_id=r.id) AS nonconformities
       FROM laboratory_equipment_run_services rs
       JOIN laboratory_equipment_runs r ON r.id=rs.run_id
       JOIN laboratory_equipment e ON e.id=r.equipment_id
       WHERE rs.service_id=$1 AND (rs.stage_id=$2 OR rs.stage_id IS NULL)
       ORDER BY r.started_at`,
      [serviceId,stageId],
    ),
  ])

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 32, right: 46, bottom: 50, left: 46 },
    bufferPages: true,
    info: {
      Title: `${stage.code} - ${stage.title}`,
      Author: 'AS Laboratorios',
      Subject: 'Reporte de trazabilidad por etapa',
    },
  })
  setupPdfStyle(doc)
  const chunks = []
  doc.on('data', (chunk) => chunks.push(chunk))
  const completed = new Promise((resolve, reject) => {
    doc.on('end', resolve)
    doc.on('error', reject)
  })

  drawCompanyHeader(doc)
  let y = 114

  doc.fillColor(COLORS.text).font('Arial-Bold').fontSize(11)
    .text(`Cliente: ${stage.client_name}`, PAGE.left, y, { width: 300 })
  doc.fillColor(COLORS.text).font('Arial').fontSize(11)
    .text(stage.client_company || 'Organización sin registrar', PAGE.left, y + 13, { width: 300 })
    .text(stage.client_email || '', PAGE.left, y + 25, { width: 300 })
  doc.fillColor(COLORS.text).font('Arial-Bold').fontSize(11)
    .text('Fecha de emisión:', 350, y, { width: 103, align: 'right' })
    .text('Código:', 350, y + 13, { width: 103, align: 'right' })
    .text('Cotización:', 350, y + 26, { width: 103, align: 'right' })
  doc.fillColor(COLORS.text).font('Arial').fontSize(11)
    .text(formatDateOnly(new Date()), 458, y, { width: 91, align: 'right' })
    .text(stage.code, 458, y + 13, { width: 91, align: 'right' })
    .text(stage.quote_reference || 'Sin referencia', 458, y + 26, { width: 91, align: 'right' })
  y += 45
  doc.moveTo(PAGE.left, y).lineTo(PAGE.right, y).strokeColor(COLORS.line).stroke()
  y += 10

  y = drawSectionBar(doc, 'Información del servicio', y)
  y = drawFourColumnTable(doc, [
    ['Servicio', stage.service_type_name, 'Categoría', stage.service_category_name || 'Servicios de laboratorio'],
    ['Ubicación', stage.sampling_site_name || stage.zone_name, 'Muestras', String(stage.sample_count)],
    ['Fecha de solicitud', formatDate(stage.requested_at), 'Estado general', statusLabel(stage.service_status)],
    ['Fecha de aceptación', formatDate(stage.accepted_at), 'Etapa del flujo', `${Number(stage.position) + 1} de ${stage.total_stages}`],
  ], y)
  if (stage.service_items?.length > 1) {
    const itemText = stage.service_items
      .map((item) => `${item.name} (${item.categoryName})`)
      .join('  •  ')
    const itemHeight = Math.max(39, doc.heightOfString(itemText, { width: PAGE.width - 28 }) + 27)
    doc.rect(PAGE.left, y, PAGE.width, itemHeight).fill(COLORS.paleGreen)
    doc.fillColor(COLORS.brandDark).font('Arial-Bold').fontSize(11)
      .text('ANÁLISIS INCLUIDOS', PAGE.left + 14, y + 9, { width: PAGE.width - 28 })
    doc.fillColor(COLORS.text).font('Arial').fontSize(11)
      .text(itemText, PAGE.left + 14, y + 21, { width: PAGE.width - 28, lineGap: 2 })
    y += itemHeight
  }
  y += 10

  doc.fillColor(COLORS.brandDark).font('Arial-Bold').fontSize(11)
    .text(stage.title, PAGE.left, y, { width: 385 })
  const stageStatus = statusLabel(stage.stage_status).toUpperCase()
  doc.roundedRect(425, y - 2, 124, 25, 12)
    .fill(stage.stage_status === 'completed' ? COLORS.paleGreen : '#fff1da')
  doc.fillColor(stage.stage_status === 'completed' ? COLORS.brandDark : COLORS.amber)
    .font('Arial-Bold').fontSize(11)
    .text(stageStatus, 433, y + 7, { width: 108, align: 'center' })
  y += 27
  y = drawStageTable(doc, stage, y)
  y += 6
  y = drawFourColumnTable(doc, [
    ['Inicio', formatDate(stage.started_at), 'Finalización', formatDate(stage.completed_at)],
    ['Especialidad', stage.specialty || 'Sin registrar', 'Registro analista', stage.license_number || 'Sin registrar'],
  ], y)
  y += 10

  const observations = stage.observations || 'No se registraron observaciones para esta etapa.'
  const observationsHeight = Math.max(38, doc.heightOfString(observations, { width: PAGE.width - 28 }) + 24)
  if (y + observationsHeight + 34 > PAGE.bottom) {
    doc.addPage()
    y = drawContinuationHeader(doc, stage)
  }
  y = drawSectionBar(doc, 'Observaciones de la etapa', y)
  doc.rect(PAGE.left, y, PAGE.width, observationsHeight).fill(COLORS.pale)
  doc.fillColor(COLORS.text).font('Arial').fontSize(11)
    .text(observations, PAGE.left + 14, y + 9, { width: PAGE.width - 28, lineGap: 1 })
  y += observationsHeight + 10

  if (sampleIntakes.length) {
    if (y + 95 > PAGE.bottom) { doc.addPage(); y = drawContinuationHeader(doc, stage) }
    y = drawSectionBar(doc, 'Cadena de ingreso y procesamiento de muestras', y)
    for (const sample of sampleIntakes) {
      const state = sample.processing_status === 'completed' ? 'Procesamiento finalizado'
        : sample.processing_status === 'processing' ? 'En procesamiento' : 'Almacenada / pendiente de iniciar'
      const timing = `Ingreso: ${formatDate(sample.received_at)}  |  Inicio: ${formatDate(sample.processing_started_at)}  |  Fin: ${formatDate(sample.processing_ended_at)}`
      const custody = `Custodia: ${sample.storage_detail || sample.storage_location || 'Sin registrar'}  |  Límite: ${formatDate(sample.analysis_due_at)}  |  Firmas: ${sample.client_representative_name || 'Cliente'} / ${sample.microbiologist_name || 'Laboratorio'}`
      const rowHeight = Math.max(60, doc.heightOfString(`${sample.sample_description}\n${timing}\n${custody}`, { width: 340 }) + 18)
      if (y + rowHeight > PAGE.bottom) { doc.addPage(); y = drawContinuationHeader(doc, stage); y = drawSectionBar(doc, 'Cadena de muestras (continuación)', y) }
      doc.rect(PAGE.left, y, PAGE.width, rowHeight).fill(sample.sample_conforming && sample.material_conforming ? COLORS.paleGreen : '#fff0ef')
      doc.fillColor(COLORS.brandDark).font('Arial-Bold').fontSize(11).text(sample.sample_code, PAGE.left + 11, y + 10, { width: 132 })
      doc.fillColor(sample.sample_conforming && sample.material_conforming ? COLORS.brandDark : '#a4322c').font('Arial-Bold').fontSize(11).text(state, PAGE.left + 11, y + 27, { width: 132 })
      doc.fillColor(COLORS.text).font('Arial').fontSize(11).text(sample.sample_description, PAGE.left + 153, y + 9, { width: 338 })
      doc.fillColor(COLORS.muted).font('Arial').fontSize(11).text(timing, PAGE.left + 153, y + 28, { width: 338, lineGap: 2 })
      doc.fillColor(COLORS.muted).font('Arial').fontSize(11).text(custody, PAGE.left + 153, y + 44, { width: 338, lineGap: 2 })
      y += rowHeight
    }
    y += 10
  }

  if (equipmentRuns.length) {
    if (y + 95 > PAGE.bottom) { doc.addPage(); y = drawContinuationHeader(doc, stage) }
    y = drawSectionBar(doc, 'Equipos y tiempos vinculados', y)
    for (const run of equipmentRuns) {
      const parameters = [run.temperature_c != null ? `${run.temperature_c} °C` : null,run.pressure_bar != null ? `${run.pressure_bar} bar` : null,run.rpm != null ? `${run.rpm} RPM` : null].filter(Boolean).join('  |  ') || 'Sin parámetros adicionales'
      const timing = `${formatDate(run.started_at)}  -  ${formatDate(run.ended_at)}  |  ${parameters}`
      const rowHeight = Math.max(50, doc.heightOfString(`${run.material_description}\n${timing}`, { width: 325 }) + 18)
      if (y + rowHeight > PAGE.bottom) { doc.addPage(); y = drawContinuationHeader(doc, stage); y = drawSectionBar(doc, 'Equipos vinculados (continuación)', y) }
      doc.rect(PAGE.left, y, PAGE.width, rowHeight).fill(Number(run.nonconformities) ? '#fff0ef' : COLORS.pale)
      doc.fillColor(COLORS.brandDark).font('Arial-Bold').fontSize(11).text(`${run.equipment_code} · ${run.equipment_name}`, PAGE.left + 11, y + 9, { width: 156 })
      doc.fillColor(COLORS.muted).font('Arial').fontSize(11).text(`Operador: ${run.operator_name}`, PAGE.left + 11, y + 28, { width: 156 })
      if (Number(run.nonconformities)) doc.fillColor('#a4322c').font('Arial-Bold').fontSize(11).text(`${run.nonconformities} no conformidad registrada`, PAGE.left + 11, y + 40, { width: 156 })
      doc.fillColor(COLORS.text).font('Arial').fontSize(11).text(run.material_description, PAGE.left + 178, y + 9, { width: 313 })
      doc.fillColor(COLORS.muted).font('Arial').fontSize(11).text(timing, PAGE.left + 178, y + 28, { width: 313, lineGap: 2 })
      y += rowHeight
    }
    y += 10
  }

  if (crews.length) {
    if (y + 95 > PAGE.bottom) {
      doc.addPage()
      y = drawContinuationHeader(doc, stage)
    }
    y = drawSectionBar(doc, 'Operación de campo asignada', y)
    for (const [index, crew] of crews.entries()) {
      const crewText = `${crew.name} - ${crew.assignment_type === 'application' ? 'Aplicación' : crew.assignment_type === 'sampling' ? 'Muestreo' : 'Apoyo operativo'}`
      const detail = `${crew.status_text || crew.operational_state}  |  ${crew.members}${crew.scheduled_at ? `  |  Programado: ${formatDate(crew.scheduled_at)}` : ''}`
      const rowHeight = Math.max(42, doc.heightOfString(detail, { width: 310 }) + 18)
      if (y + rowHeight > PAGE.bottom) {
        doc.addPage()
        y = drawContinuationHeader(doc, stage)
        y = drawSectionBar(doc, 'Operación de campo asignada (continuación)', y)
      }
      if (index % 2 === 0) doc.rect(PAGE.left, y, PAGE.width, rowHeight).fill(COLORS.pale)
      doc.fillColor(COLORS.brandDark).font('Arial-Bold').fontSize(11)
        .text(crewText, PAGE.left + 11, y + 10, { width: 170 })
      doc.fillColor(COLORS.text).font('Arial').fontSize(11)
        .text(detail, PAGE.left + 190, y + 9, { width: 302, lineGap: 2 })
      doc.moveTo(PAGE.left, y + rowHeight).lineTo(PAGE.right, y + rowHeight).strokeColor(COLORS.line).stroke()
      y += rowHeight
    }
    y += 10
  }

  if (photos.length) {
    if (y + 215 > PAGE.bottom) {
      doc.addPage()
      y = drawContinuationHeader(doc, stage)
    }
    y = drawSectionBar(doc, 'Evidencia fotográfica', y)
    y += 14
    for (let index = 0; index < photos.slice(0, 6).length; index += 2) {
      if (y + 178 > PAGE.bottom) {
        doc.addPage()
        y = drawContinuationHeader(doc, stage)
        y = drawSectionBar(doc, 'Evidencia fotográfica (continuación)', y) + 14
      }
      const row = photos.slice(index, index + 2)
      for (const [column, photo] of row.entries()) {
        const x = PAGE.left + column * 257
        doc.roundedRect(x, y, 246, 150, 7).fill('#eef2ef')
        try {
          const imageBuffer = Buffer.from(photo.data_url.split(',')[1], 'base64')
          doc.image(imageBuffer, x, y, { fit: [246, 150], align: 'center', valign: 'center' })
        } catch {
          doc.fillColor(COLORS.muted).font('Arial').fontSize(11)
            .text('Imagen no disponible', x, y + 70, { width: 246, align: 'center' })
        }
        doc.fillColor(COLORS.muted).font('Arial').fontSize(11)
          .text(`${photo.file_name}  |  ${formatDate(photo.created_at)}`, x, y + 156, { width: 246, align: 'center' })
      }
      y += 180
    }
  } else {
    if (y + 83 > PAGE.bottom) {
      doc.addPage()
      y = drawContinuationHeader(doc, stage)
    }
    y = drawSectionBar(doc, 'Evidencia fotográfica', y)
    doc.rect(PAGE.left, y, PAGE.width, 45).fill(COLORS.pale)
    doc.fillColor(COLORS.muted).font('Arial').fontSize(11)
      .text('No se adjuntaron fotografías a esta etapa.', PAGE.left + 12, y + 17, { width: PAGE.width - 24 })
    y += 63
  }

  drawOfficialSignatures(doc,{ y:y+16, signerName:stage.analyst || stage.performed_by, signerRole:'Responsable de la etapa', left:PAGE.left, width:PAGE.width, line:COLORS.line, ink:COLORS.text, muted:COLORS.muted })

  const range = doc.bufferedPageRange()
  for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
    doc.switchToPage(pageIndex)
    addFooter(doc, pageIndex + 1, range.count)
  }

  doc.end()
  await completed

  const pdf = Buffer.concat(chunks)
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${stage.code}-etapa-${Number(stage.position) + 1}.pdf"`)
  res.setHeader('Content-Length', String(pdf.length))
  return res.end(pdf)
}
