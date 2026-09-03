import fs from 'node:fs/promises'
import { createEquipmentRunPdfBuffer } from '../api/_lib/equipment-run-pdf.js'

const target = new URL('../tmp/pdfs/equipment-run-sample.pdf', import.meta.url)
await fs.mkdir(new URL('../tmp/pdfs/', import.meta.url), { recursive: true })
const pdf = await createEquipmentRunPdfBuffer({
  record_code: 'AUT-20260808-DEMO',
  equipment_name: 'Autoclave 01',
  equipment_code: 'AUT-001',
  equipment_type: 'autoclave',
  equipment_location: 'Laboratorio de análisis',
  operator_name: 'Analista de prueba',
  started_at: '2026-08-08T15:00:00.000Z',
  ended_at: '2026-08-08T15:15:00.000Z',
  status: 'completed',
  duration_minutes: 15,
  temperature_c: 121,
  pressure_bar: 1.05,
  rpm: null,
  storage_position: null,
  services: [
    { code: 'SOL-2026-A1B2C3', name: 'Análisis microbiológico de muestra' },
    { code: 'SOL-2026-D4E5F6', name: 'Detección de Listeria' },
  ],
  material_description: 'Medios de cultivo, material de vidrio identificado y carga mixta vinculada a dos órdenes.',
  observations: 'Ciclo finalizado con los parámetros predeterminados. Indicadores verificados por el operador.',
})
await fs.writeFile(target, pdf)
console.log(target.pathname)
