import { query } from './db.js'

const GENERIC_STAGES = [
  ['solicitud', 'Solicitud validada'],
  ['programacion', 'Programación del servicio'],
  ['muestreo', 'Muestreo y cadena de custodia'],
  ['recepcion', 'Recepción en laboratorio'],
  ['preparacion', 'Preparación de muestras'],
  ['analisis', 'Análisis de laboratorio'],
  ['informe', 'Revisión y entrega de informe'],
]

const DNA_STAGES = [
  ['solicitud', 'Solicitud validada'],
  ['recoleccion', 'Recolección de muestras'],
  ['recepcion', 'Recepción en laboratorio'],
  ['lisis', 'Lisis celular'],
  ['purificacion', 'Purificación de DNA'],
  ['calidad', 'Control de calidad'],
  ['preparacion', 'Preparación de envío'],
  ['envio', 'Envío al cliente'],
]

const BACTERIAL_FORMULATION_STAGES = [
  ['solicitud', 'Solicitud y objetivo validados'],
  ['seleccion', 'Selección y verificación de cepas'],
  ['propagacion', 'Propagación y preinóculo'],
  ['produccion', 'Producción y fermentación'],
  ['control_calidad', 'Control de calidad microbiológico'],
  ['formulacion', 'Formulación y acondicionamiento'],
  ['programacion_aplicacion', 'Programación de aplicación'],
  ['salida_cuadrilla', 'Preparación y salida de cuadrilla'],
  ['aplicacion', 'Aplicación en campo'],
  ['monitoreo', 'Monitoreo postaplicación'],
  ['informe', 'Informe y cierre técnico'],
]

const BACTERIAL_FORMULATION_LAB_STAGES = [
  ['solicitud', 'Solicitud y alcance de formulación validados'],
  ['seleccion', 'Selección y verificación de la cepa'],
  ['propagacion', 'Propagación y preparación del inóculo'],
  ['produccion', 'Producción de biomasa bacteriana'],
  ['control_calidad', 'Control de calidad microbiológico'],
  ['formulacion', 'Formulación y acondicionamiento'],
  ['liberacion', 'Liberación del formulado'],
  ['informe', 'Informe y cierre técnico'],
]

const SOIL_STAGES = [
  ['solicitud', 'Solicitud y alcance validados'],
  ['programacion', 'Programación del servicio'],
  ['muestreo', 'Muestreo y cadena de custodia'],
  ['recepcion', 'Recepción en laboratorio'],
  ['preparacion', 'Preparación de muestras'],
  ['analisis', 'Análisis de suelo'],
  ['control_calidad', 'Control de calidad de resultados'],
  ['informe', 'Revisión y entrega de informe'],
]

const WATER_STAGES = [
  ['solicitud', 'Solicitud y alcance validados'],
  ['programacion', 'Programación del servicio'],
  ['muestreo', 'Muestreo y preservación'],
  ['recepcion', 'Recepción en laboratorio'],
  ['analisis', 'Análisis de agua'],
  ['control_calidad', 'Control de calidad de resultados'],
  ['informe', 'Revisión y entrega de informe'],
]

const MICROBIOLOGY_STAGES = [
  ['solicitud', 'Alcance microbiológico validado'],
  ['recepcion', 'Recepción y acondicionamiento de muestra'],
  ['medios', 'Preparación y esterilización de medios'],
  ['inoculacion', 'Inoculación o enriquecimiento'],
  ['incubacion', 'Incubación controlada'],
  ['lectura', 'Lectura y confirmación'],
  ['informe', 'Revisión y entrega de informe'],
]

const RESEARCH_STAGES = [
  ['alcance', 'Objetivo y alcance experimental'],
  ['protocolo', 'Diseño o adaptación del protocolo'],
  ['preparacion', 'Preparación de materiales y controles'],
  ['ejecucion', 'Ejecución experimental'],
  ['seguimiento', 'Seguimiento y registro de resultados'],
  ['validacion', 'Revisión e interpretación técnica'],
  ['informe', 'Informe y cierre del proyecto'],
]

const MOLECULAR_16S_STAGES = [
  ['solicitud', 'Solicitud y alcance molecular validados'],
  ['recepcion', 'Recepción y verificación del microorganismo'],
  ['extraccion', 'Extracción y purificación de DNA'],
  ['amplificacion_16s', 'Amplificación de la región 16S rRNA'],
  ['control_calidad', 'Control de calidad del amplicón'],
  ['secuenciamiento', 'Secuenciamiento de 16S rRNA'],
  ['bioinformatica', 'Análisis e identificación molecular'],
  ['informe', 'Informe y entrega de resultados'],
]

const MOLECULAR_ITS_STAGES = [
  ['solicitud', 'Solicitud y alcance molecular validados'],
  ['recepcion', 'Recepción y verificación del microorganismo'],
  ['extraccion', 'Extracción y purificación de DNA'],
  ['amplificacion_its', 'Amplificación de la región ITS'],
  ['control_calidad', 'Control de calidad del amplicón'],
  ['secuenciamiento', 'Secuenciamiento de la región ITS'],
  ['bioinformatica', 'Análisis e identificación molecular'],
  ['informe', 'Informe y entrega de resultados'],
]

const MOLECULAR_GENOME_STAGES = [
  ['solicitud', 'Solicitud y alcance molecular validados'],
  ['recepcion', 'Recepción y verificación del microorganismo'],
  ['extraccion', 'Extracción y purificación de DNA'],
  ['control_calidad', 'Control de calidad y cuantificación de DNA'],
  ['preparacion_envio', 'Preparación documental, embalaje y trazabilidad'],
  ['envio_china', 'Envío a China para secuenciamiento del genoma'],
]

export function stagesFor(serviceTypeId) {
  if (serviceTypeId === 'research-molecular-identification-genome') return MOLECULAR_GENOME_STAGES
  if (serviceTypeId === 'research-molecular-identification-16s') return MOLECULAR_16S_STAGES
  if (serviceTypeId === 'research-molecular-identification-its') return MOLECULAR_ITS_STAGES
  if (serviceTypeId === 'dna') return DNA_STAGES
  if (serviceTypeId === 'bacterial-formulation-application') return BACTERIAL_FORMULATION_STAGES
  if (serviceTypeId?.startsWith('bacterial-formulation-')) return BACTERIAL_FORMULATION_LAB_STAGES
  if (serviceTypeId?.startsWith('soil-')) return SOIL_STAGES
  if (serviceTypeId?.startsWith('water-')) return WATER_STAGES
  if (serviceTypeId?.startsWith('micro-')) return MICROBIOLOGY_STAGES
  if (serviceTypeId?.startsWith('research-')) return RESEARCH_STAGES
  return GENERIC_STAGES
}

export async function initializeWorkflow(serviceId, serviceTypeId, actorUserId) {
  const existing = await query('SELECT id FROM service_workflow_stages WHERE service_id = $1 LIMIT 1', [serviceId])
  if (existing[0]) return

  const stages = stagesFor(serviceTypeId)
  for (const [position, [stageKey, title]] of stages.entries()) {
    await query(
      `INSERT INTO service_workflow_stages
       (service_id, stage_key, position, title, status, started_at, updated_by_user_id)
       VALUES ($1,$2,$3,$4,$5,CASE WHEN $3 = 0 THEN NOW() ELSE NULL END,$6)
       ON CONFLICT (service_id, stage_key) DO NOTHING`,
      [serviceId, stageKey, position, title, position === 0 ? 'current' : 'pending', actorUserId],
    )
  }
  await query(
    `INSERT INTO service_stage_events
     (service_id, action, from_position, to_position, actor_user_id, note)
     VALUES ($1, 'workflow_created', NULL, 0, $2, 'Flujo de trabajo creado')`,
    [serviceId, actorUserId],
  )
}
