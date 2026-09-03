import fs from 'node:fs/promises'
import { createAutoclavePdfBuffer } from '../api/_lib/autoclave-pdf.js'

const output = new URL('../output/pdf/', import.meta.url)
await fs.mkdir(output, { recursive: true })

const common = {
  service_name: 'Recuento de coliformes totales - Muestra MP-042',
  service_code: 'SRV-2026-0084',
  client_name: 'Cliente de demostración',
  client_company: 'Empresa agrícola',
  equipment_name: 'Autoclave 01',
  equipment_code: 'AUT-001',
  equipment_location: 'Laboratorio de microbiología',
}

const cycle = {
  ...common,
  record_code: 'AUT-20260802-DEMO',
  load_type: 'culture_media',
  load_description: '12 frascos de medio Plate Count Agar, 8 frascos de caldo Lauril Sulfato y material de vidrio identificado para el servicio.',
  cycle_number: 'C-024',
  program_name: 'Líquidos 121 °C',
  started_at: '2026-08-02T14:10:00-05:00',
  ended_at: '2026-08-02T14:55:00-05:00',
  temperature_c: '121.00',
  pressure_bar: '1.050',
  holding_minutes: 15,
  operator_name: 'Trabajador de laboratorio',
  chemical_indicator: 'conforming',
  biological_indicator: 'not_applicable',
  result: 'conforming',
  observations: 'El ciclo alcanzó los parámetros programados. La impresión del equipo se verificó al finalizar y la carga quedó en reposo hasta alcanzar una temperatura segura de manipulación.',
}

const release = {
  ...common,
  record_code: 'LIB-20260802-DEMO',
  cycle_record_code: cycle.record_code,
  released_at: '2026-08-02T15:25:00-05:00',
  released_by_name: 'Responsable de microbiología',
  material_condition: 'Medios homogéneos, sin precipitados no esperados, recipientes secos, íntegros y correctamente identificados.',
  packaging_integrity: 'conforming',
  chemical_indicator_result: 'conforming',
  biological_indicator_result: 'not_applicable',
  release_result: 'released',
  observations: 'Material liberado para el servido de medios correspondiente al servicio vinculado.',
}

const nonconformity = {
  ...common,
  record_code: 'NC-20260802-DEMO',
  cycle_record_code: cycle.record_code,
  release_record_code: release.record_code,
  detected_at: '2026-08-02T15:05:00-05:00',
  responsible_name: 'Responsable de microbiología',
  cycle_result: 'nonconforming',
  status: 'in_review',
  description: 'El indicador químico de una de las unidades no presentó el viraje esperado, por lo que la carga se mantuvo segregada y no fue liberada para uso.',
  immediate_action: 'Identificar y segregar toda la carga, bloquear su uso y comunicar la desviación al responsable del área de microbiología.',
  root_cause: 'Pendiente de confirmación. Se revisarán la distribución de la carga, el programa seleccionado y el registro de mantenimiento preventivo del equipo.',
  corrective_action: 'Reprocesar la carga una vez confirmada la condición operativa del autoclave. Repetir los controles y documentar una nueva liberación solo si todos los criterios resultan conformes.',
}

for (const [type, record, name] of [
  ['cycle', cycle, '01-formato-esterilizacion-autoclave.pdf'],
  ['release', release, '02-liberacion-material-autoclave.pdf'],
  ['nonconformity', nonconformity, '03-no-conformidad-autoclave.pdf'],
]) {
  const pdf = await createAutoclavePdfBuffer({ type, record })
  await fs.writeFile(new URL(name, output), pdf)
}

console.log('Tres formatos de autoclave generados en output/pdf/.')

