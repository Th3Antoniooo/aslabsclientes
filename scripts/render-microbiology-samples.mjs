import fs from 'node:fs/promises'
import { createMicrobiologyStepPdf } from '../api/_lib/microbiology-pdf.js'

const output = new URL('../output/pdf/', import.meta.url)
await fs.mkdir(output, { recursive: true })

const common = {
  service_code: 'SOL-2026-MIC001', process_code: 'MIC-20260802-DEMO', process_title: 'Microbiología de agua - Muestra 01',
  analysis_names: ['Recuento de coliformes totales', 'Recuento de coliformes termotolerantes', 'Recuento de bacterias heterótrofas'],
  step_status: 'completed', completed_by_name: 'Responsable de microbiología', completed_at: '2026-08-02T16:30:00-05:00',
}

const samples = [
  ['01-microbiologia-autoclavado.pdf', {
    ...common, step_key: 'autoclave', step_title: 'Autoclavado y liberación', document_code: 'FO-MIC-01',
    observations: 'El ciclo alcanzó los parámetros programados y la carga fue liberada para el servido.',
    step_data: { equipmentCode: 'AUT-001', cycleNumber: 'C-024', startedAt: '2026-08-02T14:10:00-05:00', endedAt: '2026-08-02T14:55:00-05:00', temperatureC: '121', pressureBar: '1.05', holdingMinutes: '15', loadType: 'culture_media', chemicalIndicator: 'conforming', releaseResult: 'released', loadDescription: 'Medios de cultivo y material de vidrio identificados para el código del servicio.' },
  }],
  ['02-microbiologia-servido-inoculacion.pdf', {
    ...common, step_key: 'plating', step_title: 'Servido e inoculación', document_code: 'FO-MIC-02',
    observations: 'Control de esterilidad conforme durante el procedimiento.',
    step_data: { performedAt: '2026-08-02T15:20:00-05:00', cultureMedium: 'Agar Chromocult y Plate Count Agar', mediumBatch: 'MC-2026-081', method: 'Siembra en placa', volumeMl: '15', unitCount: '18', cabinetCode: 'CFL-001', sterilityControl: 'conforming', inoculationDetail: 'Se inocularon las diluciones definidas por duplicado y se mantuvo la identificación del expediente.' },
  }],
  ['03-microbiologia-incubacion.pdf', {
    ...common, step_key: 'incubation', step_title: 'Incubación', document_code: 'FO-MIC-03',
    observations: 'Las placas fueron ubicadas en la bandeja indicada sin incidencias.',
    step_data: { incubatorCode: 'INC-001', temperatureC: '35', startedAt: '2026-08-02T16:00:00-05:00', endedAt: '2026-08-03T16:00:00-05:00', atmosphere: 'Aerobiosis', positionReference: 'Bandeja 2 - Posición 04', conditionResult: 'conforming', durationHours: '24', incubationPurpose: 'Incubación para desarrollo y posterior recuento de colonias características.' },
  }],
  ['04-microbiologia-lectura.pdf', {
    ...common, step_key: 'reading', step_title: 'Lectura e interpretación', document_code: 'FO-MIC-04',
    observations: 'Los controles cumplieron los criterios de aceptación del método.',
    step_data: { readingAt: '2026-08-03T16:20:00-05:00', method: 'Conteo de colonias', dilution: '10^-2 y 10^-3', units: 'UFC/mL', positiveControl: 'conforming', negativeControl: 'conforming', analystName: 'Analista de microbiología', reviewResult: 'conforming', resultSummary: 'Se efectuó el recuento en placas dentro del rango contable y se calcularon los resultados según la dilución aplicada.' },
  }],
  ['05-microbiologia-emision-informe.pdf', {
    ...common, step_key: 'report', step_title: 'Emisión del informe', document_code: 'FO-MIC-05',
    observations: 'Informe revisado, aprobado y publicado para el cliente.',
    step_data: { fileName: 'Informe-microbiologico-SOL-2026-MIC001.pdf', version: '1', issuedAt: '2026-08-04T10:00:00-05:00', fileSizeLabel: '842 KB', serviceCode: 'SOL-2026-MIC001', notes: 'Documento emitido con los resultados validados de los análisis incluidos en el expediente.' },
  }],
]

for (const [name, record] of samples) await fs.writeFile(new URL(name, output), await createMicrobiologyStepPdf({ record }))
console.log('Cinco formatos microbiológicos generados en output/pdf/.')

