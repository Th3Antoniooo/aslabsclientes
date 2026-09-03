import fs from 'node:fs'
import PDFDocument from 'pdfkit'
import { drawOfficialSignatures, setupPdfStyle } from './pdf-style.js'

const COLORS = {
  green: '#559642',
  greenDark: '#17651f',
  greenDeep: '#153d26',
  ink: '#171c19',
  muted: '#68736d',
  line: '#d7ded9',
  pale: '#f4f7f4',
  paleGreen: '#edf5eb',
  paleRed: '#fff2ef',
  red: '#a84232',
  white: '#ffffff',
}

const PAGE = { left: 46, right: 549, width: 503 }

let logoBuffer
try {
  logoBuffer = fs.readFileSync(new URL('../../src/assets/aslabs-logo.png', import.meta.url))
} catch {
  logoBuffer = null
}

function dateTime(value) {
  if (!value) return 'Sin registrar'
  return new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Lima',
  }).format(new Date(value))
}

function label(value, labels = {}) {
  return labels[value] || value || 'Sin registrar'
}

function elapsed(startedAt, endedAt) {
  if (!startedAt || !endedAt) return 'Pendiente'
  const minutes = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000))
  return `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)} h ` : ''}${minutes % 60} min`
}

function header(doc, title, documentCode, recordCode) {
  doc.rect(PAGE.left, 30, PAGE.width, 6).fill(COLORS.green)
  doc.fillColor(COLORS.ink).font('Arial-Bold').fontSize(11).text(title, PAGE.left, 49, { width: 340 })
  doc.fillColor(COLORS.ink).font('Arial').fontSize(11)
    .text('AS LABORATORIOS CONTROL BIOLÓGICO S.A.C. · RUC 20440181792', PAGE.left, 72)
    .text('Jr. Huancavelica 315, Palermo, Trujillo · ventas@aslaboratorios.com', PAGE.left, 88)
    .text('+51 961 996 645', PAGE.left, 104)
  if (logoBuffer) doc.image(logoBuffer, 405, 42, { fit: [143, 66], align: 'right' })
  doc.roundedRect(405, 108, 144, 37, 7).fill(COLORS.paleGreen)
  doc.fillColor(COLORS.greenDark).font('Arial-Bold').fontSize(11)
    .text(documentCode, 416, 117, { width: 122, align: 'center' })
  doc.fillColor(COLORS.ink).font('Arial-Bold').fontSize(11)
    .text(recordCode || 'BORRADOR', 416, 130, { width: 122, align: 'center' })
  doc.moveTo(PAGE.left, 153).lineTo(PAGE.right, 153).strokeColor(COLORS.line).lineWidth(1).stroke()
  return 164
}

function section(doc, title, y, danger = false) {
  doc.roundedRect(PAGE.left, y, PAGE.width, 23, 7).fill(danger ? COLORS.red : COLORS.green)
  doc.fillColor(COLORS.white).font('Arial-Bold').fontSize(11)
    .text(title.toUpperCase(), PAGE.left + 11, y + 6, { width: PAGE.width - 22 })
  return y + 23
}

function rows(doc, data, y) {
  const widths = [102, 149, 102, 150]
  for (const [index, row] of data.entries()) {
    const leftValue = String(row[1] ?? 'Sin registrar')
    const rightValue = String(row[3] ?? 'Sin registrar')
    const cells = [String(row[0]), leftValue, String(row[2]), rightValue]
    const height = Math.max(27, ...cells.map((cell,index) => doc.heightOfString(cell, { width: widths[index] - 12 }) + 10))
    if (index % 2 === 0) doc.rect(PAGE.left, y, PAGE.width, height).fill(COLORS.pale)
    let x = PAGE.left
    doc.fillColor(COLORS.muted).font('Arial-Bold').fontSize(11)
      .text(String(row[0]).toUpperCase(), x + 6, y + 6, { width: widths[0] - 12 })
    x += widths[0]
    doc.fillColor(COLORS.ink).font('Arial').fontSize(11)
      .text(leftValue, x + 6, y + 6, { width: widths[1] - 12 })
    x += widths[1]
    doc.fillColor(COLORS.muted).font('Arial-Bold').fontSize(11)
      .text(String(row[2]).toUpperCase(), x + 6, y + 6, { width: widths[2] - 12 })
    x += widths[2]
    doc.fillColor(COLORS.ink).font('Arial').fontSize(11)
      .text(rightValue, x + 6, y + 6, { width: widths[3] - 12 })
    doc.moveTo(PAGE.left, y + height).lineTo(PAGE.right, y + height).strokeColor(COLORS.line).lineWidth(.7).stroke()
    y += height
  }
  return y
}

function textBox(doc, title, value, y, danger = false, compact = false) {
  const content = value || 'Sin observaciones registradas.'
  const height = Math.max(compact ? 43 : 46, doc.heightOfString(content, { width: PAGE.width - 28 }) + 29)
  doc.roundedRect(PAGE.left, y, PAGE.width, height, 8).fill(danger ? COLORS.paleRed : COLORS.pale)
  doc.fillColor(danger ? COLORS.red : COLORS.greenDark).font('Arial-Bold').fontSize(11)
    .text(title.toUpperCase(), PAGE.left + 14, y + 7, { width: PAGE.width - 28 })
  doc.fillColor(COLORS.ink).font('Arial').fontSize(11)
    .text(content, PAGE.left + 14, y + 21, { width: PAGE.width - 28, lineGap: 1 })
  return y + height
}

function signatures(doc, firstLabel, firstName, secondLabel, y) {
  return drawOfficialSignatures(doc,{ y, signerName:firstName, signerRole:firstLabel, left:PAGE.left, width:PAGE.width, line:COLORS.line, ink:COLORS.ink, muted:COLORS.muted })
}

function footer(doc) {
  const range = doc.bufferedPageRange()
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(i)
    const previousBottom = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    doc.moveTo(PAGE.left, 790).lineTo(PAGE.right, 790).strokeColor(COLORS.line).lineWidth(.7).stroke()
    doc.fillColor(COLORS.muted).font('Arial').fontSize(11)
      .text('AS LABORATORIOS | Documento controlado', PAGE.left, 801, { width: 390, lineBreak: false })
      .text(`Página ${i + 1} de ${range.count}`, 450, 801, { width: 99, align: 'right', lineBreak: false })
    doc.page.margins.bottom = previousBottom
  }
}

function commonRows(record) {
  return [
    ['Servicio', record.service_name, 'Código servicio', record.service_code],
    ['Cliente', record.client_name, 'Empresa', record.client_company || 'Sin registrar'],
    ['Equipo', `${record.equipment_name} (${record.equipment_code})`, 'Ubicación', record.equipment_location],
  ]
}

function drawCycle(doc, record) {
  let y = header(doc, 'Formato de esterilización', 'FO-LAB-AUT-01', record.record_code)
  y = section(doc, 'Identificación y vínculo', y)
  y = rows(doc, commonRows(record), y) + 8
  y = section(doc, 'Parámetros del autoclavado', y)
  y = rows(doc, [
    ['Tipo de carga', label(record.load_type, { culture_media: 'Medios de cultivo', material: 'Material', mixed: 'Carga mixta' }), 'Número de ciclo', record.cycle_number],
    ['Programa', record.program_name, 'Operador', record.operator_name],
    ['Inicio', dateTime(record.started_at), 'Fin', dateTime(record.ended_at)],
    ['Duración real', elapsed(record.started_at, record.ended_at), 'Parámetros objetivo', `${record.temperature_c} °C · ${record.pressure_bar} bar · ${record.holding_minutes} min`],
    ['Temperatura', `${record.temperature_c} °C`, 'Presión', `${record.pressure_bar} bar`],
    ['Tiempo de sostén', `${record.holding_minutes} minutos`, 'Resultado', label(record.result, { conforming: 'Conforme', nonconforming: 'No conforme', pending: 'Pendiente' })],
    ['Indicador químico', label(record.chemical_indicator, { conforming: 'Conforme', nonconforming: 'No conforme', not_applicable: 'No aplica', pending: 'Pendiente' }), 'Indicador biológico', label(record.biological_indicator, { conforming: 'Conforme', nonconforming: 'No conforme', not_applicable: 'No aplica', pending: 'Pendiente' })],
  ], y) + 8
  y = textBox(doc, 'Descripción de la carga', record.load_description, y) + 6
  y = textBox(doc, 'Observaciones', record.observations, y)
  signatures(doc, 'Operador responsable', record.operator_name, 'Revisión / aprobación', y + 5)
}

function drawRelease(doc, record) {
  let y = header(doc, 'Liberación de material esterilizado', 'FO-LAB-AUT-02', record.record_code)
  y = section(doc, 'Identificación y ciclo de origen', y)
  y = rows(doc, [
    ...commonRows(record),
    ['Registro de autoclavado', record.cycle_record_code, 'Fecha de liberación', dateTime(record.released_at)],
    ['Responsable', record.released_by_name, 'Resultado', label(record.release_result, { released: 'Liberado', rejected: 'Rechazado', pending: 'Pendiente' })],
  ], y) + 15
  y = section(doc, 'Verificación para liberación', y)
  y = rows(doc, [
    ['Condición del material', record.material_condition, 'Integridad del empaque', label(record.packaging_integrity, { conforming: 'Conforme', nonconforming: 'No conforme', not_applicable: 'No aplica' })],
    ['Indicador químico', label(record.chemical_indicator_result, { conforming: 'Conforme', nonconforming: 'No conforme', not_applicable: 'No aplica', pending: 'Pendiente' }), 'Indicador biológico', label(record.biological_indicator_result, { conforming: 'Conforme', nonconforming: 'No conforme', not_applicable: 'No aplica', pending: 'Pendiente' })],
  ], y) + 15
  y = textBox(doc, 'Observaciones de la liberación', record.observations, y)
  signatures(doc, 'Responsable de liberación', record.released_by_name, 'Revisión / aprobación', y + 20)
}

function drawNonconformity(doc, record) {
  let y = header(doc, 'Reporte de no conformidad', 'FO-LAB-AUT-03', record.record_code)
  y = section(doc, 'Identificación del evento', y, true)
  y = rows(doc, [
    ['Servicio', record.service_name, 'Código servicio', record.service_code],
    ['Cliente', `${record.client_name}${record.client_company ? ` · ${record.client_company}` : ''}`, 'Equipo', `${record.equipment_name} (${record.equipment_code})`],
    ['Registro de autoclavado', record.cycle_record_code, 'Liberación vinculada', record.release_record_code || 'No aplica'],
    ['Fecha de detección', dateTime(record.detected_at), 'Estado', label(record.status, { open: 'Abierta', in_review: 'En revisión', closed: 'Cerrada' })],
    ['Responsable', record.responsible_name, 'Resultado del ciclo', label(record.cycle_result, { conforming: 'Conforme', nonconforming: 'No conforme', pending: 'Pendiente' })],
  ], y) + 15
  y = textBox(doc, 'Descripción de la no conformidad', record.description, y, true, true) + 8
  y = textBox(doc, 'Acción inmediata', record.immediate_action, y, false, true) + 8
  y = textBox(doc, 'Causa raíz', record.root_cause || 'Pendiente de determinar.', y, false, true) + 8
  y = textBox(doc, 'Acción correctiva', record.corrective_action || 'Pendiente de definir.', y, false, true)
  signatures(doc, 'Responsable del seguimiento', record.responsible_name, 'Cierre / aprobación', y + 8)
}

export async function createAutoclavePdfBuffer({ type, record }) {
  const titles = {
    cycle: `Esterilización ${record.record_code}`,
    release: `Liberación ${record.record_code}`,
    nonconformity: `No conformidad ${record.record_code}`,
  }
  if (!titles[type]) throw new Error('Tipo de formato no válido')
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 30, right: 46, bottom: 50, left: 46 },
    bufferPages: true,
    info: { Title: titles[type], Author: 'AS Laboratorios', Subject: 'Trazabilidad de autoclave' },
  })
  setupPdfStyle(doc)
  const chunks = []
  doc.on('data', (chunk) => chunks.push(chunk))
  const complete = new Promise((resolve, reject) => {
    doc.on('end', resolve)
    doc.on('error', reject)
  })
  if (type === 'cycle') drawCycle(doc, record)
  if (type === 'release') drawRelease(doc, record)
  if (type === 'nonconformity') drawNonconformity(doc, record)
  footer(doc)
  doc.end()
  await complete
  return Buffer.concat(chunks)
}
