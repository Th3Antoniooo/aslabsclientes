import fs from 'node:fs'
import PDFDocument from 'pdfkit'
import { natashaSignature, setupPdfStyle, signatureForName } from './pdf-style.js'

const C = {
  green: '#559642', deep: '#153d26', dark: '#17221b', muted: '#66756c',
  line: '#d5ded7', pale: '#f5f8f5', soft: '#edf6ec', amber: '#b76b20',
  red: '#b53b33', white: '#ffffff',
}
const P = { left: 42, right: 553, width: 511 }
let logo
try { logo = fs.readFileSync(new URL('../../src/assets/aslabs-logo.png', import.meta.url)) } catch { logo = null }

function signatureBuffer(dataUrl) {
  if (!dataUrl) return null
  try { return Buffer.from(String(dataUrl).split(',')[1], 'base64') } catch { return null }
}
function date(value) {
  if (!value) return 'No consignado'
  return new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Lima' }).format(new Date(value))
}
function status(value) {
  return ({
    stored: 'Almacenada', processing: 'En procesamiento', completed: 'Completado', accepted: 'Aceptado',
    in_progress: 'En proceso', refrigerator: 'Refrigeradora', room_temperature_table: 'Mesa a temperatura ambiente', other: 'Otra ubicación',
  })[value] || value || 'No consignado'
}
function compact(value, max = 430) {
  const text = String(value || 'No consignado').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
function section(doc, title, y) {
  doc.roundedRect(P.left, y, P.width, 18, 6).fill(C.green)
  doc.fillColor(C.white).font('Arial-Bold').fontSize(8).text(title.toUpperCase(), P.left + 10, y + 5, { width: P.width - 20 })
  return y + 18
}
function table(doc, rows, y) {
  const widths = [89, 166, 89, 167]
  const startY = y
  rows.forEach((row, index) => {
    const cells = row.map((cell) => compact(cell, 190))
    const h = Math.max(20, ...cells.map((cell, column) => doc.heightOfString(cell, { width: widths[column] - 10 }) + 8))
    if (index % 2 === 0) doc.rect(P.left, y, P.width, h).fill(C.pale)
    let x = P.left
    for (let column = 0; column < 4; column += 2) {
      doc.fillColor(C.muted).font('Arial-Bold').fontSize(8).text(String(row[column]).toUpperCase(), x + 5, y + 5, { width: widths[column] - 10 })
      x += widths[column]
      doc.fillColor(C.dark).font('Arial').fontSize(8).text(cells[column + 1], x + 5, y + 5, { width: widths[column + 1] - 10 })
      x += widths[column + 1]
    }
    doc.moveTo(P.left, y + h).lineTo(P.right, y + h).strokeColor(C.line).lineWidth(.55).stroke()
    y += h
  })
  doc.roundedRect(P.left, startY, P.width, y - startY, 6).strokeColor(C.line).lineWidth(.7).stroke()
  return y
}
function textBox(doc, title, value, y, tone = 'green') {
  const text = compact(value)
  const h = Math.max(34, doc.heightOfString(text, { width: P.width - 24 }) + 21)
  const background = tone === 'red' ? '#fff0ef' : tone === 'amber' ? '#fff7e9' : C.soft
  const ink = tone === 'red' ? C.red : tone === 'amber' ? C.amber : C.deep
  doc.roundedRect(P.left, y, P.width, h, 7).fill(background)
  doc.fillColor(ink).font('Arial-Bold').fontSize(8).text(title.toUpperCase(), P.left + 12, y + 6)
  doc.fillColor(C.dark).font('Arial').fontSize(8).text(text, P.left + 12, y + 17, { width: P.width - 24, lineGap: .5 })
  return y + h
}
function signatureCards(doc, record, y) {
  const gap = 7
  const width = (P.width - gap * 2) / 3
  const height = 72
  const internalName = record.microbiologist_name || record.collected_by_name || 'Laboratorio AS Labs'
  const items = [
    {
      name: record.client_representative_name || 'Cliente / representante',
      role: record.intake_type === 'aslabs_collection' ? 'Conformidad de toma o recojo' : 'Conformidad de entrega',
      image: signatureBuffer(record.client_signature_data_url),
    },
    { name: internalName, role: 'Recepción y conformidad AS Labs', image: signatureBuffer(record.microbiologist_signature_data_url) || signatureForName(internalName), digital: Boolean(record.received_by_analyst_id) },
    { name: 'Natasha Escobar Arana', role: 'Gerente General', image: natashaSignature() },
  ]
  items.forEach((item, index) => {
    const x = P.left + index * (width + gap)
    doc.roundedRect(x, y, width, height, 8).fill(C.white).strokeColor(C.line).lineWidth(.7).stroke()
    if (item.image) doc.image(item.image, x + 10, y + 3, { fit: [width - 20, 34], align: 'center', valign: 'center' })
    else if (item.digital) {
      doc.roundedRect(x + 22, y + 9, width - 44, 24, 6).fill('#edf7ef').strokeColor('#a8c8b1').lineWidth(.6).stroke()
      doc.fillColor(C.deep).font('Arial-Bold').fontSize(8).text('IDENTIDAD DIGITAL REGISTRADA', x + 26, y + 17, { width: width - 52, align: 'center' })
    } else doc.fillColor(C.muted).font('Arial-Italic').fontSize(8).text('Firma no consignada', x + 8, y + 15, { width: width - 16, align: 'center' })
    doc.fillColor(C.dark).font('Arial-Bold').fontSize(8).text(item.name, x + 7, y + 40, { width: width - 14, height: 11, align: 'center', ellipsis: true })
    doc.fillColor(C.muted).font('Arial').fontSize(8).text(item.role, x + 7, y + 55, { width: width - 14, height: 11, align: 'center', ellipsis: true })
  })
  return y + height
}
function footer(doc) {
  const previousBottom = doc.page.margins.bottom
  doc.page.margins.bottom = 0
  doc.moveTo(P.left, 803).lineTo(P.right, 803).strokeColor(C.line).lineWidth(.6).stroke()
  doc.fillColor(C.muted).font('Arial').fontSize(8).text('AS LABORATORIOS · Copia del cliente · Documento electrónico verificable', P.left, 812, { width: 400, lineBreak: false })
  doc.fillColor(C.muted).font('Arial').fontSize(8).text('Página 1 de 1', 457, 812, { width: 96, align: 'right', lineBreak: false })
  doc.page.margins.bottom = previousBottom
}

export function createSampleIntakePdf(record) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margins: { top: 25, right: 42, bottom: 35, left: 42 }, bufferPages: true,
      info: { Title: `Ingreso y conformidad ${record.sample_code}`, Author: 'AS Laboratorios', Subject: `Recepción de muestra ${record.service_code}` },
    })
    setupPdfStyle(doc)
    const chunks = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.rect(P.left, 24, P.width, 5).fill(C.green)
    doc.fillColor(C.dark).font('Arial-Bold').fontSize(8).text('FORMATO DE INGRESO Y CONFORMIDAD DE MUESTRA', P.left, 42, { width: 350 })
    doc.fillColor(C.muted).font('Arial').fontSize(8)
      .text('AS LABORATORIOS CONTROL BIOLÓGICO S.A.C. · RUC 20440181792', P.left, 58)
      .text('Jr. Huancavelica 315, Palermo, Trujillo · +51 961 996 645', P.left, 70)
    if (logo) doc.image(logo, 420, 35, { fit: [130, 49], align: 'right' })
    doc.roundedRect(401, 86, 152, 35, 7).fill(C.deep)
    doc.fillColor(C.white).font('Arial-Bold').fontSize(8).text('COPIA CLIENTE', 412, 93, { width: 130, align: 'center' }).text(record.sample_code, 407, 106, { width: 140, align: 'center' })
    doc.fillColor(C.dark).font('Arial-Bold').fontSize(8).text(record.client_name || 'Cliente / representante', P.left, 89, { width: 335 })
    doc.fillColor(C.muted).font('Arial').fontSize(8)
      .text(record.client_company || 'Organización no consignada', P.left, 103, { width: 335 })
      .text(record.client_email || '', P.left, 115, { width: 335 })
    doc.moveTo(P.left, 130).lineTo(P.right, 130).strokeColor(C.line).lineWidth(.7).stroke()

    let y = 138
    y = section(doc, 'Identificación del servicio', y)
    y = table(doc, [
      ['Orden', record.service_code, 'Cotización', record.quote_reference || 'No consignada'],
      ['Servicio', record.service_name, 'Categoría', record.service_category_name || 'Laboratorio'],
      ['Sede / zona', record.sampling_site_name || record.zone_name, 'Muestras', String(record.sample_count || 1)],
    ], y) + 6
    y = textBox(doc, 'Análisis solicitados', record.analysis_names || 'Análisis por definir', y) + 6

    y = section(doc, 'Ingreso y custodia', y)
    y = table(doc, [
      ['Modalidad', record.intake_type === 'aslabs_collection' ? 'Toma o recojo por AS Labs' : 'Entrega del cliente', 'Fecha y hora', date(record.received_at)],
      ['Descripción', record.sample_description, 'Fecha límite', date(record.analysis_due_at)],
      ['Quien entrega', record.client_representative_name, 'Recibe AS Labs', record.collected_by_name],
      ['Custodia inicial', record.storage_detail || status(record.storage_location), 'Estado', status(record.processing_status)],
      ['Inicio de análisis', date(record.processing_started_at), 'Fin de análisis', date(record.processing_ended_at)],
    ], y) + 6

    const conforming = record.sample_conforming && record.material_conforming
    const declaration = record.intake_type === 'aslabs_collection'
      ? 'El cliente confirma con su firma la toma o recojo realizado por AS Labs y la condición observada de la muestra.'
      : 'El cliente confirma con su firma la entrega, identificación y condición de la muestra al momento de la recepción.'
    y = textBox(doc, conforming ? 'Muestra y material conformes' : 'Ingreso con no conformidad', record.nonconformity_notes || declaration, y, conforming ? 'green' : 'red') + 6
    if (record.intake_type === 'aslabs_collection') {
      y = textBox(doc, `Satisfacción del cliente · ${record.satisfaction_rating || 5} de 5`, record.satisfaction_notes || 'Servicio recibido conforme, sin comentarios adicionales.', y, 'amber') + 6
    }

    y = section(doc, 'Firmas y autorización', y)
    y = signatureCards(doc, record, y + 5)
    doc.fillColor(C.muted).font('Arial').fontSize(8).text(
      'La firma del cliente acredita la recepción o toma indicada. Esta copia contiene la misma información conservada en la trazabilidad electrónica de la orden.',
      P.left, y + 7, { width: P.width, align: 'center' },
    )
    footer(doc)
    doc.end()
  })
}
