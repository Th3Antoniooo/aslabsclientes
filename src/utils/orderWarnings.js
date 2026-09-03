const EQUIPMENT_LABELS = {
  autoclave: 'Autoclave', spectrophotometer: 'Espectrofotómetro', incubator: 'Incubadora',
  shaker_incubator: 'Shaker incubador', centrifuge: 'Centrífuga', oven: 'Horno', flow_cabinet: 'Cabina de flujo',
}

function relativeDate(value, prefix) {
  const milliseconds = new Date(value).getTime() - Date.now()
  const hours = Math.ceil(Math.abs(milliseconds) / 3_600_000)
  if (milliseconds < 0) return hours < 24 ? `${prefix} venció hace ${Math.max(1, hours)} h` : `${prefix} venció hace ${Math.ceil(hours / 24)} días`
  if (hours < 24) return `${prefix} en ${Math.max(1, hours)} h`
  return `${prefix} en ${Math.ceil(hours / 24)} días`
}

function scheduledSampleDetail(value, mode = 'client_delivery') {
  const scheduled = new Date(value)
  const day = scheduled.toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' })
  const time = scheduled.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false })
  const action = mode === 'aslabs_sampling' ? 'realizar el muestreo' : mode === 'aslabs_collection' ? 'recoger la muestra' : 'recibir la muestra'
  return `Se necesita ${action} y registrar la firma del cliente el ${day} a las ${time}.`
}

export function orderWarning(service, { internal = false } = {}) {
  if (!service || service.status === 'completed' || service.archived_at) return null
  if (service.running_equipment_code) {
    const equipment = service.running_equipment_name || EQUIPMENT_LABELS[service.running_equipment_type] || 'Equipo'
    if (!internal) return { tone: 'live', title: `${equipment} en uso`, detail: 'El laboratorio está utilizando este equipo durante el procesamiento del servicio.', panel: 'trace' }
    const overdue = service.running_equipment_due_at && new Date(service.running_equipment_due_at).getTime() < Date.now()
    return { tone: overdue ? 'critical' : 'live', title: overdue ? `${equipment} excedió el tiempo` : `${equipment} sigue encendido`, detail: `${service.running_equipment_code} · inició ${new Date(service.running_equipment_started_at).toLocaleString('es-PE')}`, panel: 'equipment' }
  }
  if (service.sample_intake_mode === 'none') return null
  if (!Number(service.received_samples || 0)) {
    if (service.sample_intake_scheduled_at) {
      const overdue = new Date(service.sample_intake_scheduled_at).getTime() < Date.now()
      const title = service.sample_intake_mode === 'aslabs_sampling' ? 'Muestreo pendiente' : service.sample_intake_mode === 'aslabs_collection' ? 'Recojo pendiente' : 'Falta recibir la muestra'
      return { tone: overdue ? 'critical' : 'scheduled', title, detail: scheduledSampleDetail(service.sample_intake_scheduled_at, service.sample_intake_mode), panel: 'sample' }
    }
    if (service.next_sampling_at && service.sampling_status !== 'completed') {
      const overdue = new Date(service.next_sampling_at).getTime() < Date.now()
      return { tone: overdue ? 'critical' : 'scheduled', title: relativeDate(service.next_sampling_at, 'Muestreo'), detail: `Programado por la cuadrilla · ${new Date(service.next_sampling_at).toLocaleString('es-PE')}`, panel: 'sample' }
    }
    return { tone: 'attention', title: service.sampling_status === 'completed' ? 'Falta la firma y el ingreso de muestra' : 'Falta recibir la muestra', detail: 'Se necesita registrar la muestra y la firma del cliente.', panel: 'sample' }
  }
  if (service.sample_due_at) {
    const due = new Date(service.sample_due_at).getTime() < Date.now()
    const hours = Math.ceil((new Date(service.sample_due_at).getTime() - Date.now()) / 3_600_000)
    if (due || hours <= 72) return { tone: due ? 'critical' : 'scheduled', title: relativeDate(service.sample_due_at, 'Análisis'), detail: `${service.pending_samples || 1} muestra${Number(service.pending_samples) === 1 ? '' : 's'} pendiente${Number(service.pending_samples) === 1 ? '' : 's'}.`, panel: 'trace' }
  }
  return null
}
