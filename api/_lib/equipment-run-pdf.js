import fs from 'node:fs'
import PDFDocument from 'pdfkit'
import { drawOfficialSignatures, setupPdfStyle } from './pdf-style.js'

const C = { green: '#559642', deep: '#153d26', ink: '#171c19', muted: '#68736d', line: '#d7ded9', pale: '#f4f7f4', white: '#ffffff', amber: '#d98a27' }
const page = { left: 46, right: 549, width: 503 }

let logo
try { logo = fs.readFileSync(new URL('../../src/assets/aslabs-logo.png', import.meta.url)) } catch { logo = null }

const dateTime = (value) => value ? new Intl.DateTimeFormat('es-PE', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Lima',
}).format(new Date(value)) : 'Sin registrar'

const equipmentNames = {
  autoclave: 'Autoclave', spectrophotometer: 'Espectrofotómetro', incubator: 'Incubadora',
  shaker_incubator: 'Shaker incubador', centrifuge: 'Centrífuga', oven: 'Horno', flow_cabinet: 'Cabina de flujo laminar',
}

function elapsed(startedAt,endedAt) {
  if(!startedAt) return 'Sin registrar'
  const seconds=Math.max(0,Math.round(((endedAt?new Date(endedAt):new Date()).getTime()-new Date(startedAt).getTime())/1000))
  const hours=Math.floor(seconds/3600),minutes=Math.floor((seconds%3600)/60)
  return `${hours?`${hours} h `:''}${minutes} min`
}

function header(doc, record) {
  doc.rect(page.left, 24, page.width, 5).fill(C.green)
  doc.fillColor(C.ink).font('Arial-Bold').fontSize(11).text('TRAZABILIDAD DE USO DE EQUIPO', page.left, 40, { width: 330 })
  doc.fillColor(C.ink).font('Arial').fontSize(11)
    .text('AS LABORATORIOS CONTROL BIOLÓGICO S.A.C. · RUC 20440181792', page.left, 56)
    .text('Jr. Huancavelica 315, Palermo, Trujillo · +51 961 996 645', page.left, 69)
  if (logo) doc.image(logo, 418, 33, { fit: [130, 51], align: 'right' })
  doc.roundedRect(402, 86, 147, 34, 7).fill('#edf5eb')
  doc.fillColor(C.deep).font('Arial-Bold').fontSize(11).text('FO-LAB-EQP-01', 414, 94, { width: 123, align: 'center' })
  doc.fillColor(C.ink).font('Arial-Bold').fontSize(11).text(record.record_code, 414, 106, { width: 123, align: 'center' })
  doc.moveTo(page.left, 129).lineTo(page.right, 129).strokeColor(C.line).stroke()
  return 138
}

function section(doc, title, y) {
  doc.roundedRect(page.left, y, page.width, 19, 6).fill(C.green)
  doc.fillColor(C.white).font('Arial-Bold').fontSize(11).text(title.toUpperCase(), page.left + 10, y + 5)
  return y + 19
}

function rows(doc, data, y) {
  const widths = [102, 149, 102, 150]
  data.forEach((row, index) => {
    const cells = row.map((cell) => String(cell ?? 'Sin registrar'))
    const height = Math.max(22, ...cells.map((cell,index) => doc.heightOfString(cell, { width: widths[index] - 12 }) + 8))
    if (index % 2 === 0) doc.rect(page.left, y, page.width, height).fill(C.pale)
    let x = page.left
    for (let i = 0; i < 4; i += 1) {
      doc.fillColor(i % 2 ? C.ink : C.muted).font(i % 2 ? 'Arial' : 'Arial-Bold').fontSize(11)
        .text(String(row[i] ?? 'Sin registrar'), x + 6, y + 6, { width: widths[i] - 12 })
      x += widths[i]
    }
    doc.moveTo(page.left, y + height).lineTo(page.right, y + height).strokeColor(C.line).lineWidth(.7).stroke()
    y += height
  })
  return y
}

function box(doc, title, value, y) {
  const text = value || 'Sin observaciones registradas.'
  const height = Math.max(36, doc.heightOfString(text, { width: page.width - 28 }) + 24)
  doc.roundedRect(page.left, y, page.width, height, 8).fill(C.pale)
  doc.fillColor(C.deep).font('Arial-Bold').fontSize(11).text(title.toUpperCase(), page.left + 14, y + 7)
  doc.fillColor(C.ink).font('Arial').fontSize(11).text(text, page.left + 14, y + 21, { width: page.width - 28, lineGap: 1 })
  return y + height
}

export async function createEquipmentRunPdfBuffer(record) {
  const services = Array.isArray(record.services) ? record.services : []
  const doc = new PDFDocument({
    size: 'A4', margins: { top: 30, right: 46, bottom: 8, left: 46 }, bufferPages: true,
    info: { Title: `Trazabilidad ${record.record_code}`, Author: 'AS Laboratorios', Subject: 'Uso de equipo de laboratorio' },
  })
  setupPdfStyle(doc)
  const chunks = []
  doc.on('data', (chunk) => chunks.push(chunk))
  const done = new Promise((resolve, reject) => { doc.on('end', resolve); doc.on('error', reject) })
  let y = header(doc, record)
  y = section(doc, 'Equipo y responsable', y)
  y = rows(doc, [
    ['Equipo', `${record.equipment_name} (${record.equipment_code})`, 'Tipo', equipmentNames[record.equipment_type] || record.equipment_type],
    ['Ubicación', record.equipment_location || 'Sin registrar', 'Operador', record.operator_name],
    ['Inicio', dateTime(record.started_at), 'Fin', dateTime(record.ended_at)],
    ['Estado', record.status === 'completed' ? 'Finalizado' : 'En curso', 'Duración real', elapsed(record.started_at,record.ended_at)],
    ['Fin previsto', dateTime(record.expected_end_at), 'Tiempo programado', record.duration_minutes ? `${record.duration_minutes} minutos` : 'No aplica'],
  ], y) + 8
  y = section(doc, 'Parámetros y órdenes vinculadas', y)
  y = rows(doc, [
    ['Temperatura', record.temperature_c == null ? 'No aplica' : `${record.temperature_c} °C`, 'Presión', record.pressure_bar == null ? 'No aplica' : `${record.pressure_bar} bar`],
    ['RPM', record.rpm == null ? 'No aplica' : `${record.rpm} RPM`, 'Ubicación interna', record.storage_position || 'No aplica'],
    [record.work_area === 'biotechnology' ? 'Área' : 'Órdenes', record.work_area === 'biotechnology' ? 'Biotecnología vegetal' : services.map((item) => item.code).join(', ') || 'Sin vincular', 'Etapa vinculada', record.work_area === 'biotechnology' ? 'Esterilización y trabajo vegetal' : services.map((item) => item.stageTitle || 'Registro general').join(', ') || 'Registro general'],
  ], y) + 8
  y = box(doc, 'Material, muestra o carga', record.material_description, y) + 6
  y = box(doc, 'Observaciones', record.observations, y) + 6
  const nonconformity = Array.isArray(record.nonconformities) ? record.nonconformities[0] : null
  const complianceText=nonconformity?'USO CON NO CONFORMIDAD REGISTRADA':record.status==='completed'?'USO FINALIZADO CONFORME':'OPERACIÓN EN CURSO'
  doc.roundedRect(page.left,y,page.width,34,8).fill(nonconformity?'#fff0ef':record.status==='completed'?'#edf5eb':'#fff5e7')
  doc.fillColor(nonconformity?'#a4322c':record.status==='completed'?C.deep:'#9a5c16').font('Arial-Bold').fontSize(11).text(complianceText,page.left+14,y+11,{width:page.width-28,align:'center'}); y+=40
  if (nonconformity) {
    if (y > 615) { doc.addPage(); y = 45 }
    y = section(doc, `No conformidad ${nonconformity.recordCode}`, y)
    y = rows(doc, [
      ['Detectada', dateTime(nonconformity.detectedAt), 'Responsable', nonconformity.responsibleName],
      ['Estado', nonconformity.status === 'closed' ? 'Cerrada' : nonconformity.status === 'in_review' ? 'En revisión' : 'Abierta', 'Equipo', record.equipment_code],
    ], y) + 10
    y = box(doc, 'Descripción de la no conformidad', nonconformity.description, y) + 8
    y = box(doc, 'Acción inmediata', nonconformity.immediateAction, y) + 8
    if (nonconformity.rootCause || nonconformity.correctiveAction) {
      y = box(doc, 'Causa raíz y acción correctiva', [nonconformity.rootCause, nonconformity.correctiveAction].filter(Boolean).join('\n\n'), y)
    }
  }
  drawOfficialSignatures(doc,{ y:y+2, signerName:record.operator_name, signerRole:'Operador responsable', left:page.left, width:page.width, line:C.line, ink:C.ink, muted:C.muted })
  const range = doc.bufferedPageRange()
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(i)
    doc.moveTo(page.left, 807).lineTo(page.right, 807).strokeColor(C.line).stroke()
    doc.fillColor(C.muted).font('Arial').fontSize(11)
      .text('AS LABORATORIOS | Documento controlado', page.left, 816, { width: 400, lineBreak: false })
      .text(`Página ${i + 1} de ${range.count}`, 450, 816, { width: 99, align: 'right', lineBreak: false })
  }
  doc.end()
  await done
  return Buffer.concat(chunks)
}
