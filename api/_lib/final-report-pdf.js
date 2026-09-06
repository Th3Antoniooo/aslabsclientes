import fs from 'node:fs'
import PDFDocument from 'pdfkit'
import { natashaSignature, setupPdfStyle, signatureForName } from './pdf-style.js'

const C = {
  green: '#08a94f', deep: '#155b35', ink: '#151a17', muted: '#5f6963',
  line: '#cfd7d2', soft: '#f7faf8', white: '#ffffff', amber: '#a76816', red: '#a9342d',
}
const P = { left: 28, right: 814, width: 786, bottom: 526, footerY: 540 }

let logo
try { logo = fs.readFileSync(new URL('../../src/assets/aslabs-logo.png', import.meta.url)) } catch { logo = null }

function date(value, withTime = false) {
  if (!value) return 'Pendiente'
  return new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'medium', ...(withTime ? { timeStyle: 'short' } : {}), timeZone: 'America/Lima',
  }).format(new Date(value))
}

function clean(value, fallback = '-') { return String(value || '').trim() || fallback }
function numeric(value) {
  const normalized = String(value ?? '').trim().replace(',', '.')
  return normalized && Number.isFinite(Number(normalized)) ? Number(normalized) : null
}

function reportCode(service) {
  return clean(service?.code, `SOL-${new Date().getFullYear()}-0000`).replace(/^SOL-/i, 'INF-')
}

function companyHeader(doc, service, approvalStatus) {
  doc.roundedRect(P.left, 24, P.width, 4, 2).fill(C.green)
  if (logo) doc.image(logo, P.left, 34, { fit: [128, 45], align: 'left', valign: 'center' })
  else doc.fillColor(C.green).font('Arial-Bold').fontSize(9).text('AS Labs', P.left, 48)
  doc.fillColor(C.ink).font('Arial-Bold').fontSize(9).text('INFORME DE RESULTADOS', 558, 34, { width: 256, align: 'right' })
  doc.fillColor(C.muted).font('Arial').fontSize(8).text(`Código: ${reportCode(service)}`, 558, 49, { width: 256, align: 'right' })
  const status = approvalStatus === 'approved' ? 'APROBADO' : approvalStatus === 'rejected' ? 'RECHAZADO' : 'PENDIENTE DE APROBACIÓN'
  doc.fillColor(approvalStatus === 'approved' ? C.deep : approvalStatus === 'rejected' ? C.red : C.amber)
    .font('Arial-Bold').fontSize(8).text(status, 558, 63, { width: 256, align: 'right' })
  doc.moveTo(P.left, 84).lineTo(P.right, 84).strokeColor(C.line).lineWidth(.7).stroke()
  doc.fillColor(C.muted).font('Arial').fontSize(7.2)
    .text('Jr. Huancavelica 315, II Piso, Urb. Palermo · Trujillo, La Libertad', P.left, 90, { width: 390 })
    .text('ventas@aslaboratorios.com · +51 961 996 645', 424, 90, { width: 390, align: 'right' })
  return 108
}

function continuationHeader(doc, service) {
  doc.roundedRect(P.left, 22, P.width, 4, 2).fill(C.green)
  if (logo) doc.image(logo, P.left, 31, { fit: [85, 28] })
  doc.fillColor(C.ink).font('Arial-Bold').fontSize(8).text(`INFORME DE RESULTADOS · ${reportCode(service)}`, 420, 39, { width: 394, align: 'right' })
  doc.moveTo(P.left, 66).lineTo(P.right, 66).strokeColor(C.line).stroke()
  return 76
}

function section(doc, title, y) {
  doc.roundedRect(P.left, y, P.width, 19, 6).fill(C.green)
  doc.fillColor(C.white).font('Arial-Bold').fontSize(8).text(title.toUpperCase(), P.left + 10, y + 5.5)
  return y + 25
}

function infoGrid(doc, entries, y) {
  const gap = 8
  const width = (P.width - gap) / 2
  const rows = Math.ceil(entries.length / 2)
  const rowHeight = 30
  const height = rows * rowHeight
  doc.roundedRect(P.left, y, P.width, height, 7).fill(C.soft).strokeColor(C.line).lineWidth(.65).stroke()
  entries.forEach(([label, value], index) => {
    const row = Math.floor(index / 2), col = index % 2
    const x = P.left + col * (width + gap), top = y + row * rowHeight
    if (col) doc.moveTo(x - gap / 2, top + 4).lineTo(x - gap / 2, top + rowHeight - 4).strokeColor(C.line).lineWidth(.35).stroke()
    doc.fillColor(C.muted).font('Arial-Bold').fontSize(7).text(label, x + 8, top + 5, { width: width - 16, height: 9, ellipsis: true })
    doc.fillColor(C.ink).font('Arial').fontSize(7.6).text(clean(value), x + 8, top + 16, { width: width - 16, height: 11, ellipsis: true })
  })
  return y + height + 7
}

function sampleCards(doc, samples, service, y) {
  const items = samples.length ? samples : [{ sample_code: `${service.code}-1`, sample_description: 'Muestra 1' }]
  const gap = 8, width = (P.width - gap) / 2, height = 58
  items.forEach((sample, index) => {
    if (index > 0 && index % 2 === 0) y += height + 6
    const x = P.left + (index % 2) * (width + gap)
    doc.roundedRect(x, y, width, height, 7).fill(index % 2 ? '#f3f8f5' : C.soft).strokeColor(C.line).lineWidth(.65).stroke()
    doc.fillColor(C.deep).font('Arial-Bold').fontSize(8).text(clean(sample.sample_code), x + 8, y + 7, { width: width - 16 })
    doc.fillColor(C.ink).font('Arial').fontSize(7.4).text(clean(sample.sample_description, `Muestra ${index + 1}`), x + 8, y + 20, { width: width - 16, height: 10, ellipsis: true })
    doc.fillColor(C.muted).font('Arial').fontSize(7).text(`Recepción: ${date(sample.received_at, true)}  ·  Inicio: ${date(sample.processing_started_at, true)}`, x + 8, y + 34, { width: width - 16, height: 9, ellipsis: true })
    doc.text(`Fin: ${date(sample.processing_ended_at, true)}  ·  Lugar: ${clean(sample.sampling_site_name || service.zone_name)}`, x + 8, y + 45, { width: width - 16, height: 9, ellipsis: true })
  })
  return y + height + 7 + Math.floor((items.length - 1) / 2) * (height + 6)
}

const TABLE_WIDTHS = [78, 125, 60, 52, 36, 36, 72, 92, 235]
const TABLE_LABELS = ['Cód. muestra', 'Parámetro', 'Resultado', 'Unidad', 'Mín.', 'Máx.', 'Referencia', 'Agente identificado', 'Método']

function resultsHeader(doc, y) {
  let x = P.left
  doc.roundedRect(P.left, y, P.width, 28, 5).fill('#e7f1ea').strokeColor(C.line).lineWidth(.65).stroke()
  TABLE_LABELS.forEach((label, index) => {
    if (index) doc.moveTo(x, y).lineTo(x, y + 28).strokeColor(C.line).lineWidth(.35).stroke()
    doc.fillColor(C.ink).font('Arial-Bold').fontSize(7.2).text(label, x + 4, y + 6, {
      width: TABLE_WIDTHS[index] - 8, height: 18, align: index >= 2 && index <= 5 ? 'center' : 'left',
    })
    x += TABLE_WIDTHS[index]
  })
  return y + 28
}

function resultValues(row) {
  return [
    clean(row.sample_code), clean(row.parameter), clean(row.result_value), clean(row.unit),
    clean(row.minimum_value), clean(row.maximum_value), clean(row.reference_value), clean(row.identified_agent),
    [clean(row.method, ''), row.observations ? `Obs.: ${row.observations}` : ''].filter(Boolean).join('\n') || '-',
  ]
}

function resultRowHeight(doc, row) {
  const values = resultValues(row)
  doc.font('Arial').fontSize(7.2)
  return Math.max(28, ...values.map((value, index) => doc.heightOfString(value, { width: TABLE_WIDTHS[index] - 8, lineGap: .5 }) + 10))
}

function resultRow(doc, row, y, index) {
  const height = resultRowHeight(doc, row)
  const values = resultValues(row)
  let x = P.left
  doc.rect(P.left, y, P.width, height).fill(index % 2 ? '#f8fbf9' : C.white).strokeColor(C.line).lineWidth(.5).stroke()
  values.forEach((value, column) => {
    if (column) doc.moveTo(x, y).lineTo(x, y + height).strokeColor(C.line).lineWidth(.35).stroke()
    doc.fillColor(C.ink).font(column === 2 ? 'Arial-Bold' : 'Arial').fontSize(7.2).text(value, x + 4, y + 5, {
      width: TABLE_WIDTHS[column] - 8, lineGap: .5, align: column >= 2 && column <= 5 ? 'center' : 'left',
    })
    x += TABLE_WIDTHS[column]
  })
  return y + height
}

function narrativeCards(doc, entries, y) {
  const gap = 8, width = (P.width - gap) / 2
  const rows = []
  for (let i = 0; i < entries.length; i += 2) {
    const pair = entries.slice(i, i + 2)
    doc.font('Arial').fontSize(7.5)
    const height = Math.max(48, ...pair.map(([, value]) => doc.heightOfString(clean(value), { width: width - 18, lineGap: 1 }) + 27))
    rows.push({ pair, height })
  }
  rows.forEach(({ pair, height }) => {
    pair.forEach(([label, value], index) => {
      const x = P.left + index * (width + gap)
      doc.roundedRect(x, y, width, height, 7).fill(C.soft).strokeColor(C.line).lineWidth(.65).stroke()
      doc.fillColor(C.deep).font('Arial-Bold').fontSize(7.2).text(label.toUpperCase(), x + 9, y + 8, { width: width - 18 })
      doc.fillColor(C.ink).font('Arial').fontSize(7.5).text(clean(value), x + 9, y + 22, { width: width - 18, lineGap: 1 })
    })
    y += height + 7
  })
  return y
}

function rangeCard(doc, row, x, y, width) {
  const value = numeric(row.result_value), min = numeric(row.minimum_value), max = numeric(row.maximum_value)
  if (value === null || min === null || max === null || max <= min) return
  const position = Math.max(0, Math.min(1, (value - min) / (max - min)))
  const inRange = value >= min && value <= max
  doc.roundedRect(x, y, width, 42, 7).fill(C.soft).strokeColor(C.line).stroke()
  doc.fillColor(C.ink).font('Arial-Bold').fontSize(7.2).text(`${clean(row.sample_code)} · ${clean(row.parameter)}`, x + 8, y + 6, { width: width - 16, height: 9, ellipsis: true })
  const trackX = x + 8, trackY = y + 22, trackWidth = width - 100
  doc.roundedRect(trackX, trackY, trackWidth, 5, 2.5).fill('#dce8df')
  doc.circle(trackX + trackWidth * position, trackY + 2.5, 4.5).fill(inRange ? C.green : C.red)
  doc.fillColor(C.muted).font('Arial').fontSize(6.7).text(`${min}`, trackX, y + 30, { width: 45 }).text(`${max}`, trackX + trackWidth - 45, y + 30, { width: 45, align: 'right' })
  doc.fillColor(inRange ? C.deep : C.red).font('Arial-Bold').fontSize(6.8).text(inRange ? 'EN RANGO' : value < min ? 'BAJO' : 'SOBRE', x + width - 84, y + 20, { width: 76, align: 'right' })
  doc.fillColor(C.ink).font('Arial-Bold').fontSize(7).text(`${value} ${clean(row.unit, '')}`, x + width - 84, y + 30, { width: 76, align: 'right' })
}

function signatures(doc, { y, responsibleName, approver, approvalStatus }) {
  const gap = 8, width = (P.width - gap) / 2, height = 68
  const items = [
    { name: clean(responsibleName, 'Responsable técnico'), role: 'Responsable técnico · firma automática', image: signatureForName(responsibleName) },
    { name: 'Natasha Escobar Arana', role: 'Gerente General', image: natashaSignature() },
  ]
  items.forEach((item, index) => {
    const x = P.left + index * (width + gap)
    doc.roundedRect(x, y, width, height, 7).fill(C.white).strokeColor(C.line).lineWidth(.65).stroke()
    if (item.image) doc.image(item.image, x + 20, y + 3, { fit: [width - 40, 34], align: 'center' })
    else doc.fillColor(C.deep).font('Arial-Bold').fontSize(7).text('FIRMA AUTOMÁTICA', x + 8, y + 18, { width: width - 16, align: 'center' })
    doc.moveTo(x + 18, y + 39).lineTo(x + width - 18, y + 39).strokeColor('#9ca7a0').stroke()
    doc.fillColor(C.ink).font('Arial-Bold').fontSize(7.3).text(item.name, x + 8, y + 45, { width: width - 16, align: 'center', height: 9, ellipsis: true })
    doc.fillColor(C.muted).font('Arial').fontSize(6.8).text(item.role, x + 8, y + 56, { width: width - 16, align: 'center' })
  })
  if (approvalStatus === 'approved') doc.fillColor(C.muted).font('Arial').fontSize(6.8).text(`Aprobación digital: ${clean(approver?.full_name)} · ${date(approver?.approved_at, true)}`, P.left, y + height + 5, { width: P.width, align: 'center' })
  return y + height + 14
}

function footer(doc, service) {
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i)
    doc.moveTo(P.left, P.footerY).lineTo(P.right, P.footerY).strokeColor(C.line).lineWidth(.5).stroke()
    doc.fillColor(C.muted).font('Arial').fontSize(6.8).text('AS LABORATORIOS · ventas@aslaboratorios.com · +51 961 996 645', P.left, P.footerY + 6, { width: 520, lineBreak: false })
    doc.text(`${reportCode(service)} · Página ${i + 1} de ${range.count}`, 654, P.footerY + 6, { width: 160, align: 'right', lineBreak: false })
  }
}

export async function createFinalReportPdf({ service, results = [], samples = [], evidencePhotos = [], responsibleName, approver = null, approvalStatus = 'pending', report = {} }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 22, right: 28, bottom: 30, left: 28 }, bufferPages: true, info: { Title: `${reportCode(service)} - Informe de resultados`, Author: 'AS Laboratorios', Subject: service.service_type_name } })
    setupPdfStyle(doc)
    const chunks = []
    doc.on('data', (chunk) => chunks.push(chunk)); doc.on('error', reject); doc.on('end', () => resolve(Buffer.concat(chunks)))
    const addPage = () => { doc.addPage(); return continuationHeader(doc, service) }

    let y = companyHeader(doc, service, approvalStatus)
    y = section(doc, 'Información general', y)
    y = infoGrid(doc, [
      ['Cliente', service.client_company || service.client_name], ['Contacto', `${clean(service.client_name)} · ${clean(service.client_email)}`],
      ['Orden de servicio', service.code], ['DNI / identificación', service.client_dni || '-'],
      ['Servicio', service.service_type_name], ['Análisis incluidos', (service.service_items || []).map((item) => item.name).join(' · ')],
      ['Área', service.service_category_name || 'Laboratorio'], ['Fecha de emisión', approvalStatus === 'approved' ? date(approver?.approved_at || new Date(), true) : 'Pendiente de aprobación'],
    ], y)
    y = section(doc, 'Muestras analizadas', y)
    y = sampleCards(doc, samples, service, y)
    if (y > P.bottom - 55) y = addPage()
    y = section(doc, 'Resultados', y)
    y = resultsHeader(doc, y)
    const rows = results.length ? results : [{ sample_code: `${service.code}-1`, parameter: 'Resultados pendientes', result_value: '-' }]
    rows.forEach((row, index) => {
      const height = resultRowHeight(doc, row)
      if (y + height > P.bottom) { y = addPage(); y = section(doc, 'Resultados · continuación', y); y = resultsHeader(doc, y) }
      y = resultRow(doc, row, y, index)
    })
    y += 8

    const graphedRows = results.filter((row) => numeric(row.result_value) !== null && numeric(row.minimum_value) !== null && numeric(row.maximum_value) !== null && numeric(row.maximum_value) > numeric(row.minimum_value))
    if (graphedRows.length) {
      if (y > P.bottom - 72) y = addPage()
      y = section(doc, 'Gráficas de parámetros', y)
      const gap = 8, width = (P.width - gap) / 2
      graphedRows.forEach((row, index) => {
        if (index > 0 && index % 2 === 0) y += 49
        if (index > 0 && index % 2 === 0 && y + 42 > P.bottom) { y = addPage(); y = section(doc, 'Gráficas de parámetros · continuación', y) }
        rangeCard(doc, row, P.left + (index % 2) * (width + gap), y, width)
      })
      y += 49
    }

    const rowObservations = results.map((row) => row.observations).filter(Boolean).join(' · ')
    if (y > P.bottom - 125) y = addPage()
    y = section(doc, 'Interpretación, notas y observaciones', y)
    y = narrativeCards(doc, [
      ['Interpretación', report.interpretation || 'Sin interpretación adicional registrada.'], ['Notas', report.notes || 'Sin notas adicionales.'],
      ['Observaciones', report.observations || rowObservations || 'Sin observaciones adicionales.'], ['Declaración', 'Los resultados corresponden exclusivamente a las muestras identificadas y analizadas bajo las condiciones consignadas en este documento.'],
    ], y)

    if (evidencePhotos.length) {
      const photos = evidencePhotos.slice(0, 10)
      const gap = 10
      const width = (P.width - gap) / 2
      const height = 198
      for (let pageStart = 0; pageStart < photos.length; pageStart += 4) {
        y = addPage()
        y = section(doc, pageStart ? 'Evidencia fotográfica · continuación' : 'Evidencia fotográfica', y)
        photos.slice(pageStart, pageStart + 4).forEach((photo, pageIndex) => {
          const index = pageStart + pageIndex
          const row = Math.floor(pageIndex / 2)
          const column = pageIndex % 2
          const x = P.left + column * (width + gap)
          const top = y + row * (height + 8)
          doc.roundedRect(x, top, width, height, 7).fill(C.white).strokeColor(C.line).lineWidth(.65).stroke()
          doc.roundedRect(x + 6, top + 6, width - 12, 142, 5).fill(C.soft)
          try {
            const imageBuffer = Buffer.from(String(photo.data_url || '').split(',')[1] || '', 'base64')
            if (imageBuffer.length) doc.image(imageBuffer, x + 6, top + 6, { cover: [width - 12, 142], align: 'center', valign: 'center' })
          } catch {}
          doc.circle(x + 19, top + 19, 9).fill(C.deep)
          doc.fillColor(C.white).font('Arial-Bold').fontSize(7).text(String(index + 1), x + 10, top + 15.5, { width: 18, align: 'center' })
          doc.fillColor(C.ink).font('Arial-Bold').fontSize(7.5).text(
            clean(photo.title || photo.file_name, `Fotografía ${index + 1}`),
            x + 8, top + 155, { width: width - 16, height: 11, ellipsis: true },
          )
          doc.fillColor(C.muted).font('Arial').fontSize(6.7).text(
            clean(photo.note, 'Sin nota adicional.'),
            x + 8, top + 170, { width: width - 16, height: 20, lineGap: .5, ellipsis: true },
          )
        })
        y += Math.ceil(Math.min(4, photos.length - pageStart) / 2) * (height + 8)
      }
      // Keep evidence pages exclusively for photographs, even when the last
      // page contains fewer than four images.
      y = addPage()
    }

    if (y > P.bottom - 90) y = addPage()
    y = section(doc, 'Firmas responsables', y)
    y = signatures(doc, { y, responsibleName, approver, approvalStatus })
    doc.fillColor(C.muted).font('Arial').fontSize(6.7).text('Este informe no debe reproducirse parcialmente sin autorización de AS Laboratorios. La interpretación se limita al alcance, método y muestras identificados.', P.left, y, { width: P.width, align: 'center' })
    footer(doc, service)
    doc.end()
  })
}

export { reportCode }
