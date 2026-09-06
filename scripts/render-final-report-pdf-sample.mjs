import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFinalReportPdf } from '../api/_lib/final-report-pdf.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'output', 'pdf', 'informe-resultados-a4-horizontal.pdf')

const service = {
  code: 'SOL-2026-0017',
  client_company: 'Empresa Agroindustrial de Validación S.A.C.',
  client_name: 'Representante del cliente',
  client_dni: '20440181792',
  client_email: 'calidad@cliente.com',
  service_type_name: 'Análisis microbiológico y fisicoquímico de muestras generales',
  service_category_name: 'Microbiología y análisis fisicoquímico',
  service_items: [
    { name: 'Recuento de coliformes termotolerantes' },
    { name: 'Determinación de nitrógeno, fósforo y potasio' },
  ],
  sample_count: 2,
  zone_name: 'Sede de muestreo del cliente',
}

const samples = [
  {
    sample_code: 'SOL-2026-0017-1',
    sample_description: 'Muestra compuesta de suelo agrícola',
    sampling_site_name: 'Parcela experimental norte',
    received_at: '2026-08-17T09:14:00-05:00',
    processing_started_at: '2026-08-17T10:02:00-05:00',
    processing_ended_at: '2026-08-18T16:48:00-05:00',
  },
  {
    sample_code: 'SOL-2026-0017-2',
    sample_description: 'Muestra de agua para evaluación fisicoquímica',
    sampling_site_name: 'Reservorio principal',
    received_at: '2026-08-17T09:14:00-05:00',
    processing_started_at: '2026-08-17T10:08:00-05:00',
    processing_ended_at: '2026-08-18T17:12:00-05:00',
  },
]

const results = [
  {
    result_group_label: 'Resultado microbiológico principal',
    sample_code: 'SOL-2026-0017-1',
    parameter: 'Recuento de coliformes termotolerantes mediante técnica de tubos múltiples',
    result_value: '1 600 000',
    unit: 'NMP/100 mL de muestra',
    minimum_value: '0',
    maximum_value: '1 000',
    reference_value: 'Límite de referencia aplicable según especificación entregada por el cliente',
    identified_agent: 'Escherichia coli presuntiva y microorganismos indicadores de contaminación fecal',
    method: 'Procedimiento interno ASL-MIC-014 basado en técnica de fermentación en tubos múltiples y lectura confirmatoria',
  },
  {
    result_group_label: 'Perfil fisicoquímico',
    sample_code: 'SOL-2026-0017-2',
    parameter: 'Determinación de nitrógeno total, fósforo disponible y potasio intercambiable',
    result_value: 'N: 128,4 · P: 56,8 · K: 340,2',
    unit: 'mg/kg de materia seca',
    minimum_value: '100',
    maximum_value: '350',
    reference_value: 'Rango técnico de evaluación establecido para la matriz analizada',
    identified_agent: 'No aplica para determinaciones fisicoquímicas',
    method: 'Espectrofotometría UV-Visible, extracción química y lectura instrumental bajo condiciones controladas',
  },
  {
    result_group_label: 'Confirmación molecular',
    sample_code: 'SOL-2026-0017-1',
    parameter: 'Detección molecular cualitativa por reacción en cadena de la polimerasa',
    result_value: 'No detectado en la muestra analizada',
    unit: 'Resultado cualitativo',
    reference_value: 'Ausencia en la porción analizada',
    identified_agent: 'Listeria monocytogenes',
    method: 'PCR convencional con controles positivo, negativo y control interno de amplificación',
  },
]

const samplePhoto = await fs.readFile(path.join(root, 'src', 'assets', 'aslabs-logo.png'))
const evidencePhotos = Array.from({ length: 10 }, (_, index) => ({
  file_name: `evidencia-${index + 1}.png`,
  title: `Fotografía ${index + 1}. Evidencia del procedimiento analítico`,
  note: index % 2
    ? 'Registro complementario de las condiciones observadas durante el procesamiento de la muestra.'
    : 'Vista general del material evaluado y de su disposición durante la etapa documentada.',
  data_url: `data:image/png;base64,${samplePhoto.toString('base64')}`,
}))

const buffer = await createFinalReportPdf({
  service,
  results,
  samples,
  evidencePhotos,
  responsibleName: 'Rosa Nancy Mejía Ruedell Malabrigo',
  approver: { full_name: 'Antonio Guevara Escobar', approved_at: '2026-08-19T11:30:00-05:00' },
  approvalStatus: 'approved',
  report: {
    interpretation: 'Los valores fisicoquímicos se encontraron mayormente dentro de los intervalos de referencia consignados. El resultado microbiológico requiere atención por superar el valor máximo indicado para la muestra analizada.',
    notes: 'Los resultados son aplicables únicamente a las muestras identificadas en este informe. Las referencias fueron proporcionadas para fines de comparación técnica.',
    observations: 'Las dos muestras fueron recibidas con integridad, identificación y volumen suficientes. No se registraron desviaciones durante el procesamiento analítico.',
  },
})

await fs.mkdir(path.dirname(output), { recursive: true })
await fs.writeFile(output, buffer)
console.log(output)
