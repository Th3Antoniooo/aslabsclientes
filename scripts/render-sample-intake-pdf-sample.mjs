import fs from 'node:fs/promises'
import { createSampleIntakePdf } from '../api/_lib/sample-intake-pdf.js'

const signature = await fs.readFile(new URL('../api/assets/signatures/nancy.png', import.meta.url))
const target = new URL('../output/pdf/muestra-trazabilidad-aslabs.pdf', import.meta.url)
const pdf = await createSampleIntakePdf({
  sample_code: 'MUE-20260819-01A2',
  service_code: 'SOL-2026-78D118',
  quote_reference: 'COT-1024-2026',
  service_name: 'Análisis microbiológico y fisicoquímico de muestra',
  service_category_name: 'Análisis de muestras generales',
  client_name: 'Cliente de demostración S.A.C.',
  client_company: 'Operaciones Agrícolas del Norte',
  client_email: 'contacto@cliente.com',
  zone_name: 'Sede principal',
  sampling_site_name: 'Laboratorio AS Labs - Trujillo',
  sample_count: 2,
  analysis_names: 'Recuento de coliformes totales · Escherichia coli · pH · conductividad eléctrica · nitratos · amonio',
  intake_type: 'client_delivery',
  received_at: '2026-08-19T14:25:00.000Z',
  analysis_due_at: '2026-08-22T22:00:00.000Z',
  sample_description: 'Agua de proceso, frascos estériles identificados como M-01 y M-02.',
  client_representative_name: 'Representante del cliente',
  collected_by_name: 'Rosa Nancy Mejía Ruedell Malabrigo',
  microbiologist_name: 'Rosa Nancy Mejía Ruedell Malabrigo',
  client_signature_data_url: `data:image/png;base64,${signature.toString('base64')}`,
  microbiologist_signature_data_url: null,
  sample_conforming: true,
  material_conforming: true,
  storage_location: 'refrigerator',
  storage_detail: 'Refrigeradora 01 · bandeja superior',
  processing_status: 'stored',
  processing_started_at: null,
  processing_ended_at: null,
})
await fs.mkdir(new URL('../output/pdf/', import.meta.url), { recursive: true })
await fs.writeFile(target, pdf)
console.log(target.pathname)
