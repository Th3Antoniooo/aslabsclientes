import fs from 'node:fs'
import PDFDocument from 'pdfkit'
import { drawOfficialSignatures, setupPdfStyle } from './pdf-style.js'

const COLORS = { green: '#559642', dark: '#17651f', ink: '#171c19', muted: '#68736d', line: '#d7ded9', pale: '#f4f7f4', paleGreen: '#edf5eb', white: '#ffffff' }
const PAGE = { left: 46, right: 549, width: 503 }

let logo
try { logo = fs.readFileSync(new URL('../../src/assets/aslabs-logo.png', import.meta.url)) } catch { logo = null }

function dateTime(value) {
  if (!value) return 'Sin registrar'
  return new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Lima' }).format(new Date(value))
}

function value(input, fallback = 'Sin registrar') {
  return input === 0 || input ? String(input) : fallback
}

function named(input, labels) { return labels[input] || value(input) }

function drawHeader(doc, record) {
  doc.rect(PAGE.left, 30, PAGE.width, 6).fill(COLORS.green)
  doc.fillColor(COLORS.ink).font('Arial-Bold').fontSize(11)
    .text(`Formato de conformidad - ${record.step_title}`, PAGE.left, 49, { width: 350 })
  doc.fillColor(COLORS.ink).font('Arial').fontSize(11)
    .text('AS LABORATORIOS CONTROL BIOLÓGICO S.A.C. · RUC 20440181792', PAGE.left, 72)
    .text('Jr. Huancavelica 315, Palermo, Trujillo · ventas@aslaboratorios.com', PAGE.left, 88)
    .text('+51 961 996 645', PAGE.left, 104)
  if (logo) doc.image(logo, 405, 42, { fit: [143, 66], align: 'right' })
  doc.roundedRect(405, 108, 144, 37, 7).fill(COLORS.paleGreen)
  doc.fillColor(COLORS.dark).font('Arial-Bold').fontSize(11).text(record.document_code, 416, 117, { width: 122, align: 'center' })
  doc.fillColor(COLORS.ink).font('Arial-Bold').fontSize(11).text(record.process_code, 416, 130, { width: 122, align: 'center' })
  doc.moveTo(PAGE.left, 153).lineTo(PAGE.right, 153).strokeColor(COLORS.line).lineWidth(1).stroke()
  return 164
}

function section(doc, title, y) {
  doc.roundedRect(PAGE.left, y, PAGE.width, 23, 7).fill(COLORS.green)
  doc.fillColor(COLORS.white).font('Arial-Bold').fontSize(11).text(title.toUpperCase(), PAGE.left + 11, y + 6)
  return y + 23
}

function drawRows(doc, rows, y) {
  const widths = [102, 149, 102, 150]
  rows.forEach((row, index) => {
    const left = value(row[1])
    const right = value(row[3])
    const cells = [String(row[0]), left, String(row[2]), right]
    const height = Math.max(27, ...cells.map((cell,index) => doc.heightOfString(cell, { width: widths[index] - 12 }) + 10))
    if (index % 2 === 0) doc.rect(PAGE.left, y, PAGE.width, height).fill(COLORS.pale)
    let x = PAGE.left
    doc.fillColor(COLORS.muted).font('Arial-Bold').fontSize(11).text(String(row[0]).toUpperCase(), x + 6, y + 6, { width: widths[0] - 12 })
    x += widths[0]
    doc.fillColor(COLORS.ink).font('Arial').fontSize(11).text(left, x + 6, y + 6, { width: widths[1] - 12 })
    x += widths[1]
    doc.fillColor(COLORS.muted).font('Arial-Bold').fontSize(11).text(String(row[2]).toUpperCase(), x + 6, y + 6, { width: widths[2] - 12 })
    x += widths[2]
    doc.fillColor(COLORS.ink).font('Arial').fontSize(11).text(right, x + 6, y + 6, { width: widths[3] - 12 })
    doc.moveTo(PAGE.left, y + height).lineTo(PAGE.right, y + height).strokeColor(COLORS.line).lineWidth(.7).stroke()
    y += height
  })
  return y
}

function textBox(doc, title, content, y) {
  const text = value(content, 'Sin observaciones registradas.')
  const height = Math.max(46, doc.heightOfString(text, { width: PAGE.width - 28 }) + 29)
  doc.roundedRect(PAGE.left, y, PAGE.width, height, 8).fill(COLORS.pale)
  doc.fillColor(COLORS.dark).font('Arial-Bold').fontSize(11).text(title.toUpperCase(), PAGE.left + 14, y + 7)
  doc.fillColor(COLORS.ink).font('Arial').fontSize(11).text(text, PAGE.left + 14, y + 21, { width: PAGE.width - 28, lineGap: 1 })
  return y + height
}

function stepRows(key, data) {
  if (key === 'autoclave') return [
    ['Equipo', data.equipmentCode, 'Número de ciclo', data.cycleNumber],
    ['Inicio', dateTime(data.startedAt), 'Fin', dateTime(data.endedAt)],
    ['Temperatura', `${value(data.temperatureC)} °C`, 'Presión', `${value(data.pressureBar)} bar`],
    ['Tiempo de sostén', `${value(data.holdingMinutes)} minutos`, 'Tipo de carga', named(data.loadType, { culture_media: 'Medios de cultivo', material: 'Material', mixed: 'Carga mixta' })],
    ['Indicador químico', named(data.chemicalIndicator, { conforming: 'Conforme', nonconforming: 'No conforme', pending: 'Pendiente', not_applicable: 'No aplica' }), 'Liberación', named(data.releaseResult, { released: 'Liberado', rejected: 'Rechazado', pending: 'Pendiente' })],
  ]
  if (key === 'plating') return [
    ['Fecha y hora', dateTime(data.performedAt), 'Medio de cultivo', data.cultureMedium],
    ['Lote del medio', data.mediumBatch, 'Método', data.method],
    ['Volumen servido', `${value(data.volumeMl)} mL`, 'Unidades preparadas', data.unitCount],
    ['Cabina', data.cabinetCode, 'Control de esterilidad', named(data.sterilityControl, { conforming: 'Conforme', nonconforming: 'No conforme', pending: 'Pendiente' })],
  ]
  if (key === 'incubation') return [
    ['Equipo', data.incubatorCode, 'Temperatura', `${value(data.temperatureC)} °C`],
    ['Inicio', dateTime(data.startedAt), 'Fin programado', dateTime(data.endedAt)],
    ['Condición', data.atmosphere, 'Posición / bandeja', data.positionReference],
    ['Verificación', named(data.conditionResult, { conforming: 'Conforme', nonconforming: 'No conforme', pending: 'Pendiente' }), 'Duración', data.durationHours ? `${data.durationHours} horas` : 'Sin registrar'],
  ]
  if (key === 'reading') return [
    ['Fecha de lectura', dateTime(data.readingAt), 'Método', data.method],
    ['Dilución', data.dilution, 'Unidades', data.units],
    ['Control positivo', named(data.positiveControl, { conforming: 'Conforme', nonconforming: 'No conforme', not_applicable: 'No aplica' }), 'Control negativo', named(data.negativeControl, { conforming: 'Conforme', nonconforming: 'No conforme', not_applicable: 'No aplica' })],
    ['Analista', data.analystName, 'Revisión', named(data.reviewResult, { conforming: 'Conforme', nonconforming: 'No conforme', pending: 'Pendiente' })],
  ]
  return [
    ['Archivo publicado', data.fileName, 'Versión', data.version],
    ['Fecha de emisión', dateTime(data.issuedAt || data.uploadedAt), 'Tamaño', data.fileSizeLabel],
    ['Estado', 'Publicado para el cliente', 'Código del servicio', data.serviceCode],
  ]
}

function detailTitle(key) {
  return { autoclave: 'Descripción de la carga', plating: 'Detalle del servido e inoculación', incubation: 'Condiciones de incubación', reading: 'Resultado de la lectura', report: 'Nota de emisión' }[key]
}

function detailValue(key, data) {
  return { autoclave: data.loadDescription, plating: data.inoculationDetail, incubation: data.incubationPurpose, reading: data.resultSummary, report: data.notes }[key]
}

function footer(doc) {
  const range = doc.bufferedPageRange()
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(index)
    const previousBottom = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    doc.moveTo(PAGE.left, 790).lineTo(PAGE.right, 790).strokeColor(COLORS.line).lineWidth(.7).stroke()
    doc.fillColor(COLORS.muted).font('Arial').fontSize(11)
      .text('AS LABORATORIOS | Trazabilidad microbiológica', PAGE.left, 801, { width: 390, lineBreak: false })
      .text(`Página ${index + 1} de ${range.count}`, 450, 801, { width: 99, align: 'right', lineBreak: false })
    doc.page.margins.bottom = previousBottom
  }
}

export async function createMicrobiologyStepPdf({ record }) {
  const data = record.step_data || {}
  const doc = new PDFDocument({ size: 'A4', margins: { top: 30, right: 46, bottom: 50, left: 46 }, bufferPages: true, info: { Title: `${record.service_code} - ${record.step_title}`, Author: 'AS Laboratorios', Subject: 'Trazabilidad microbiológica' } })
  setupPdfStyle(doc)
  const chunks = []
  doc.on('data', (chunk) => chunks.push(chunk))
  const complete = new Promise((resolve, reject) => { doc.on('end', resolve); doc.on('error', reject) })
  let y = drawHeader(doc, record)
  y = section(doc, 'Expediente del servicio', y)
  y = drawRows(doc, [
    ['Código de servicio', record.service_code, 'Código de proceso', record.process_code],
    ['Flujo', record.process_title, 'Etapa', record.step_title],
    ['Análisis incluidos', (record.analysis_names || []).join(', '), 'Estado', record.step_status === 'completed' ? 'Conforme / completada' : 'En proceso'],
    ['Responsable', record.completed_by_name || data.operatorName || data.analystName, 'Fecha de cierre', dateTime(record.completed_at)],
  ], y) + 8
  y = section(doc, 'Registro de la etapa', y)
  y = drawRows(doc, stepRows(record.step_key, data), y) + 8
  y = textBox(doc, detailTitle(record.step_key), detailValue(record.step_key, data), y) + 6
  y = textBox(doc, 'Observaciones y conformidad', record.observations, y)
  const completedStep=record.step_status==='completed'
  doc.roundedRect(PAGE.left,y+6,PAGE.width,34,8).fill(completedStep?COLORS.paleGreen:'#fff5e7')
  doc.fillColor(completedStep?COLORS.dark:'#9a5c16').font('Arial-Bold').fontSize(11).text(completedStep?'ETAPA COMPLETADA Y TRAZABLE':'REGISTRO EN PROCESO',PAGE.left+14,y+17,{width:PAGE.width-28,align:'center'})
  y+=46
  drawOfficialSignatures(doc,{ y:y+2, signerName:record.completed_by_name || data.operatorName || data.analystName, signerRole:'Responsable de la etapa', left:PAGE.left, width:PAGE.width, line:COLORS.line, ink:COLORS.ink, muted:COLORS.muted })
  footer(doc)
  doc.end()
  await complete
  return Buffer.concat(chunks)
}
