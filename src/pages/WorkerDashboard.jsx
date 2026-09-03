import { useEffect, useMemo, useState } from 'react'
import {
  IcoArrow, IcoCalendar, IcoChart, IcoCheck, IcoFile, IcoFlask,
  IcoLeaf, IcoOrders, IcoShield, IcoUser, IcoUsers,
} from '../components/Icons.jsx'
import ServiceWorkflowModal from '../components/ServiceWorkflowModal.jsx'
import { api } from '../data/api.js'
import { orderWarning } from '../utils/orderWarnings.js'

const STATUS_LABEL = { pending: 'Por aprobar', accepted: 'Lista para iniciar', in_progress: 'En proceso', completed: 'Completada' }
const STAGE_LABEL = { introduction: 'Introducción', multiplication: 'Multiplicación', rooting: 'Enraizamiento', completed: 'Completado' }

function firstName(value = '') { return value.trim().split(/\s+/)[0] || 'Analista' }
function number(value) { return Number(value || 0).toLocaleString('es-PE') }
function shortTime(value) { return value ? new Date(value).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : '—' }
function shortDate(value) {
  if (!value) return 'Sin fecha'
  const raw = String(value)
  const date = /^\d{4}-\d{2}-\d{2}/.test(raw) ? new Date(`${raw.slice(0, 10)}T12:00:00`) : new Date(value)
  return date.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })
}
function todayInput() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {})
  return `${parts.year}-${parts.month}-${parts.day}`
}
function compactSearch(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}
function sourceBagSearchText(item) {
  const raw = String(item.current_stage_started_on || item.started_on || '').slice(0, 10)
  const [year, month, day] = raw.split('-')
  const subculture = item.current_stage === 'multiplication' ? Number(item.current_subculture) + 1 : ''
  return compactSearch([item.code, `c${subculture}`, `subcultivo ${subculture}`, raw, day && month ? `${day}-${month}` : '', day && month ? `${day}/${month}` : ''].join(' '))
}
function searchSourceBags(items, query) {
  const tokens = compactSearch(query).split(/\s+/).filter(Boolean)
  return tokens.length ? items.filter((item) => {
    const text = sourceBagSearchText(item)
    return tokens.every((token) => text.includes(token))
  }) : []
}
function filterSourceBags(items, { sourceCode = '', sourceSubculture = '', sourceDate = '' }) {
  const wantedSubculture = Number(String(sourceSubculture).replace(/\D/g, '')) || null
  return items.filter((item) => {
    const currentSubculture = item.current_stage === 'multiplication' ? Number(item.current_subculture) + 1 : null
    const stageDate = String(item.current_stage_started_on || item.started_on || '').slice(0, 10)
    return (!sourceCode.trim() || compactSearch(item.code).includes(compactSearch(sourceCode)))
      && (!wantedSubculture || currentSubculture === wantedSubculture)
      && (!sourceDate || stageDate === sourceDate)
  })
}
function deadlineInfo(value) {
  if (!value) return null
  const hours = Math.ceil((new Date(value).getTime() - Date.now()) / 3_600_000)
  if (hours <= 0) return { tone: 'overdue', label: `Vencida · ${Math.max(1, Math.ceil(Math.abs(hours) / 24))} d` }
  if (hours <= 48) return { tone: 'due-soon', label: hours <= 24 ? `${hours} h restantes` : `${Math.ceil(hours / 24)} días restantes` }
  return null
}

function cultivationDeadline(item) {
  const value = item.current_stage_started_on || item.started_on
  if (!value) return { tone: 'due-soon', rank: 1, remaining: null, label: 'Fecha pendiente', detail: 'Administración debe revisar la fecha de esta etapa.' }
  const stageDate = new Date(`${String(value).slice(0, 10)}T12:00:00`)
  const today = new Date(); today.setHours(12, 0, 0, 0)
  const elapsed = Math.floor((today.getTime() - stageDate.getTime()) / 86_400_000)
  const remaining = 20 - elapsed
  if (remaining < 0) return { tone: 'overdue', rank: 0, remaining, label: `Vencido hace ${Math.abs(remaining)} ${Math.abs(remaining) === 1 ? 'día' : 'días'}`, detail: 'Debe pasar al siguiente subcultivo.' }
  if (remaining <= 3) return { tone: 'due-soon', rank: 1, remaining, label: remaining === 0 ? 'Multiplicar hoy' : `Por vencer · ${remaining} ${remaining === 1 ? 'día' : 'días'}`, detail: 'Prioriza este cultivo en la jornada.' }
  return { tone: 'upcoming', rank: 2, remaining, label: `${remaining} días para multiplicar`, detail: 'Dentro del tiempo recomendado.' }
}

function processProgress(process) {
  const steps = process?.steps || []
  if (!steps.length) return 0
  return Math.round((steps.filter((step) => step.status === 'completed').length / steps.length) * 100)
}

function OrderCard({ service, processes, prominent, onOpen }) {
  const linked = processes.filter((process) => process.service_id === service.id)
  const currentProcess = linked.find((process) => process.status !== 'completed') || linked[0]
  const currentStep = currentProcess?.steps?.find((step) => step.status === 'current')
  const progress = currentProcess ? processProgress(currentProcess) : service.status === 'in_progress' ? 20 : 5
  const deadline = deadlineInfo(service.sample_due_at)
  const warning = orderWarning(service, { internal: true })
  return (
    <button className={`worker-command-order ${prominent ? 'prominent' : ''} ${deadline?.tone || ''}`} onClick={() => onOpen(service)}>
      <div className="worker-command-order-top"><span>{service.code}</span><em className={service.status}>{STATUS_LABEL[service.status] || service.status}</em></div>
      {deadline && !warning && <div className={`worker-order-deadline ${deadline.tone}`}><IcoCalendar /><strong>{deadline.label}</strong><span>{new Date(service.sample_due_at).toLocaleString('es-PE')}</span></div>}
      {warning && <div className={`worker-order-smart-warning ${warning.tone}`}><IcoShield /><strong>{warning.title}</strong><span>{warning.detail}</span></div>}
      <h3>{service.display_name || service.service_type_name || service.name || service.service_items?.map((item) => item.name).join(' + ') || 'Orden de análisis'}</h3>
      <div className="worker-command-stage"><span>Acción actual</span><strong>{currentStep?.title || service.current_stage_title || 'Revisar expediente y comenzar'}</strong></div>
      <div className="worker-command-progress"><div><i style={{ width: `${progress}%` }} /></div><span>{progress}%</span></div>
      <footer><small>{linked.length ? `${linked.length} flujo${linked.length === 1 ? '' : 's'} técnico${linked.length === 1 ? '' : 's'}` : 'Sin flujo técnico iniciado'}</small><b>Abrir expediente <IcoArrow /></b></footer>
    </button>
  )
}

function AnalysisWorkspace({ data, equipmentData, loading, onOpen, onReload }) {
  const assignedOrders = data.services.filter((service) => ['pending', 'accepted', 'in_progress'].includes(service.status))
  const completedOrders = data.services.filter((service) => service.status === 'completed')
  const activeProcesses = data.processes.filter((process) => process.status !== 'completed')
  const pendingSteps = activeProcesses.flatMap((process) => (process.steps || []).filter((step) => step.status === 'current').map((step) => ({ ...step, process })))
  const completedToday = data.processes.flatMap((process) => process.steps || []).filter((step) => step.status === 'completed' && new Date(step.completed_at).toDateString() === new Date().toDateString())
  const runningEquipment = equipmentData.equipmentRuns.filter((item) => item.status === 'running')
  const overdue = runningEquipment.filter((item) => item.overdue)
  const dueOrders = assignedOrders.filter((service) => deadlineInfo(service.sample_due_at))
  const priority = dueOrders[0] || assignedOrders.find((service) => service.status === 'in_progress') || assignedOrders[0]

  const modules = [
    { icon: <IcoOrders />, title: 'Mis expedientes', value: assignedOrders.length, text: 'Órdenes asignadas y alcance solicitado', tone: 'green', action: () => document.getElementById('worker-command-orders')?.scrollIntoView({ behavior: 'smooth' }) },
    { icon: <IcoFlask />, title: 'Por vencer', value: dueOrders.length, text: dueOrders.length ? 'Órdenes resaltadas por fecha límite' : 'No hay muestras próximas a vencer', tone: dueOrders.length ? 'red' : 'green', action: () => priority && onOpen(priority) },
    { icon: <IcoCalendar />, title: 'Equipos en vivo', value: runningEquipment.length, text: overdue.length ? `${overdue.length} alerta${overdue.length === 1 ? '' : 's'} de tiempo` : 'Cronómetros y operaciones vinculadas', tone: overdue.length ? 'red' : 'green', action: () => priority && onOpen(priority) },
    { icon: <IcoFile />, title: 'Trazabilidad', value: completedToday.length, text: 'Registros conformes realizados hoy', tone: 'blue', action: () => priority && onOpen(priority) },
    { icon: <IcoShield />, title: 'Control de calidad', value: equipmentData.equipmentRuns.reduce((sum, item) => sum + (item.nonconformities?.filter((nc) => nc.status !== 'closed').length || 0), 0), text: 'No conformidades abiertas', tone: 'red', action: () => priority && onOpen(priority) },
    { icon: <IcoCheck />, title: 'Historial personal', value: completedOrders.length, text: 'Órdenes completadas asignadas a ti', tone: 'green', action: () => document.getElementById('worker-completed')?.scrollIntoView({ behavior: 'smooth' }) },
  ]

  return <>
    <section className="worker-now-grid anim-in d2">
      <div className="worker-now-main">
        <header><div><span className="eyebrow">Tu siguiente movimiento</span><h2>{priority ? 'Continúa donde lo dejaste' : 'Tu espacio está al día'}</h2></div><span className={`worker-focus-status ${priority ? 'active' : ''}`}><i />{priority ? 'Trabajo pendiente' : 'Sin pendientes'}</span></header>
        {priority ? <OrderCard service={priority} processes={data.processes} prominent onOpen={onOpen} /> : <div className="worker-command-clear"><IcoCheck /><strong>No tienes órdenes activas</strong><span>Las nuevas asignaciones aparecerán aquí automáticamente.</span></div>}
      </div>
      <aside className={`worker-alert-stack ${overdue.length ? 'has-alert' : ''}`}>
        <header><span><IcoCalendar /></span><div><small>Supervisión automática</small><h2>{overdue.length ? 'Requiere atención' : 'Equipos bajo control'}</h2></div></header>
        {overdue.length ? overdue.slice(0, 3).map((run) => <button key={run.id} onClick={() => run.services?.[0] && onOpen(data.services.find((service) => service.id === run.services[0].id))}><i /><div><strong>{run.equipment_code} · Tiempo excedido</strong><span>{run.material_description || 'Operación en curso'} · inició {shortTime(run.started_at)}</span></div><IcoArrow /></button>) : runningEquipment.length ? runningEquipment.slice(0, 3).map((run) => <div className="worker-live-run" key={run.id}><i /><div><strong>{run.equipment_code} · {run.equipment_name}</strong><span>En curso desde {shortTime(run.started_at)}</span></div><b>EN VIVO</b></div>) : <div className="worker-no-alert"><IcoShield /><strong>Sin cronómetros activos</strong><span>No hay equipos excedidos ni alertas pendientes.</span></div>}
      </aside>
    </section>

    <section className="worker-module-section anim-in d3">
      <header><div><span className="eyebrow">Todos tus módulos</span><h2>Un centro, todo tu trabajo</h2><p>Cada módulo respeta tus asignaciones y mantiene oculta la identidad del cliente.</p></div><span>{modules.length} módulos activos</span></header>
      <div className="worker-module-grid">{modules.map((module) => <button className={`worker-module-card ${module.tone}`} onClick={module.action} key={module.title}><span>{module.icon}</span><div><small>{module.title}</small><strong>{module.value}</strong><p>{module.text}</p></div><IcoArrow /></button>)}</div>
    </section>

    <section className="worker-command-section anim-in d4" id="worker-command-orders">
      <header><div><span className="eyebrow">Expedientes asignados</span><h2>Órdenes que puedes intervenir</h2><p>Abre una orden para avanzar etapas, añadir evidencias y registrar equipos desde el mismo expediente.</p></div><div className="worker-command-total"><strong>{assignedOrders.length}</strong><span>activas</span></div></header>
      {loading ? <div className="worker-orders-empty">Sincronizando tus asignaciones…</div> : assignedOrders.length ? <div className="worker-command-order-grid">{assignedOrders.map((service, index) => <OrderCard service={service} processes={data.processes} prominent={index === 0} onOpen={onOpen} key={service.id} />)}</div> : <div className="worker-orders-empty"><IcoCheck /><strong>Todo está al día</strong><span>Cuando administración te asigne una orden, aparecerá aquí sin mostrar datos del cliente.</span></div>}
    </section>

    <section className="worker-lower-grid anim-in d5">
      <div className="worker-stage-radar"><header><div><span className="eyebrow">Radar de etapas</span><h2>Qué está esperando por ti</h2></div><span>{pendingSteps.length}</span></header>{pendingSteps.length ? pendingSteps.slice(0, 6).map(({ process, ...step }, index) => { const service = data.services.find((item) => item.id === process.service_id); return <button key={step.id} onClick={() => service && onOpen(service)}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{step.title}</strong><small>{process.service_code} · {process.title}</small></div><em>Ahora</em><IcoArrow /></button> }) : <div className="worker-mini-empty"><IcoCheck /> No hay etapas técnicas abiertas.</div>}</div>
      <div className="worker-completed-stream" id="worker-completed"><header><div><span className="eyebrow">Pulso del día</span><h2>Actividad registrada</h2></div><button onClick={onReload}>Actualizar</button></header>{completedToday.length ? completedToday.slice(0, 6).map((step) => <article key={step.id}><span><IcoCheck /></span><div><strong>{step.title}</strong><small>Conforme · {shortTime(step.completed_at)}</small></div></article>) : <div className="worker-mini-empty"><IcoCalendar /> Tus registros completados de hoy aparecerán aquí.</div>}</div>
    </section>
  </>
}

function LegacyBiotechnologyWorkspace({ data, loading, go }) {
  const activeCodes = data.batches.filter((batch) => batch.status === 'active')
  const pendingAssignments = data.personalAssignments.filter((item) => ['assigned','in_progress'].includes(item.status))
  const metrics = data.personalMetrics?.week || {}
  const nextBatch = activeCodes[0]
  const completion = Number(metrics.assigned) ? Math.round(Number(metrics.completed || 0) / Number(metrics.assigned) * 100) : 0
  const modules = [
    { icon: <IcoLeaf />, title: 'Códigos activos', value: activeCodes.length, text: 'Introducción, multiplicación y enraizamiento', tone: 'green' },
    { icon: <IcoCalendar />, title: 'Trabajo pendiente', value: pendingAssignments.length, text: 'Códigos asignados a tu PIN', tone: 'amber' },
    { icon: <IcoChart />, title: 'Producción real', value: number(metrics.outputPlants), text: 'Plantas registradas esta semana', tone: 'blue' },
    { icon: <IcoUsers />, title: 'Bolsas finales', value: number(metrics.outputBags), text: 'Calculadas con el estándar global', tone: 'green' },
    { icon: <IcoShield />, title: 'Tiempo trabajado', value: `${number(metrics.minutes)} min`, text: 'Cronómetro automático de actividades', tone: 'green' },
    { icon: <IcoCheck />, title: 'Cumplimiento', value: `${completion}%`, text: 'Trabajos terminados frente a asignados', tone: completion >= 90 ? 'green' : 'amber' },
  ]
  return <>
    <section className="worker-now-grid biotech anim-in d2">
      <div className="worker-now-main"><header><div><span className="eyebrow">Flujo vegetal prioritario</span><h2>{nextBatch ? 'Código listo para continuar' : 'Producción al día'}</h2></div><span className={`worker-focus-status ${nextBatch ? 'active' : ''}`}><i />{nextBatch ? STAGE_LABEL[nextBatch.current_stage] : 'Sin pendientes'}</span></header>{nextBatch ? <button className="worker-biotech-focus" onClick={() => go('biotecnologia')}><span className={`biotech-stage-dot ${nextBatch.current_stage}`}><IcoLeaf /></span><div><small>Siguiente trabajo</small><h3>{nextBatch.code}</h3><p>{nextBatch.current_stage === 'multiplication' ? `Subcultivo ${Number(nextBatch.current_subculture) + 1} de ${nextBatch.target_subcultures}` : STAGE_LABEL[nextBatch.current_stage]} · {number(nextBatch.current_viable_plants)} plantas actuales</p><div><i style={{ width: `${nextBatch.current_stage === 'introduction' ? 12 : nextBatch.current_stage === 'multiplication' ? 55 : 88}%` }} /></div></div><b>Abrir producción <IcoArrow /></b></button> : <div className="worker-command-clear"><IcoCheck /><strong>Sin códigos activos</strong><span>Los nuevos códigos aparecerán al ser creados por administración.</span></div>}</div>
      <aside className="worker-biotech-week"><header><span><IcoCalendar /></span><div><small>Esta semana</small><h2>Tu avance</h2></div></header><strong>{number(metrics.completed)} <small>/ {number(metrics.assigned)} trabajos</small></strong><div><i style={{ width: `${Math.min(100, completion)}%` }} /></div><p>{pendingAssignments.length ? `${pendingAssignments.length} código${pendingAssignments.length === 1 ? '' : 's'} por completar` : 'No tienes trabajos pendientes'}</p><button className="btn btn-primary" onClick={() => go('biotecnologia')}>Abrir mi producción <IcoArrow /></button></aside>
    </section>
    <section className="worker-module-section anim-in d3"><header><div><span className="eyebrow">Todos tus módulos</span><h2>Producción vegetal en una sola vista</h2><p>Códigos, bolsas, plantas, rendimiento y calidad conectados.</p></div><span>{modules.length} módulos activos</span></header><div className="worker-module-grid">{modules.map((module) => <button className={`worker-module-card ${module.tone}`} onClick={() => go('biotecnologia')} key={module.title}><span>{module.icon}</span><div><small>{module.title}</small><strong>{module.value}</strong><p>{module.text}</p></div><IcoArrow /></button>)}</div></section>
    <section className="worker-command-section anim-in d4"><header><div><span className="eyebrow">Códigos disponibles</span><h2>Continúa desde la etapa definida</h2><p>La firma, conteo real y contaminación quedarán vinculados a tu PIN.</p></div><div className="worker-command-total"><strong>{activeCodes.length}</strong><span>activos</span></div></header>{loading ? <div className="worker-orders-empty">Sincronizando producción…</div> : activeCodes.length ? <div className="worker-biotech-code-grid">{activeCodes.slice(0, 8).map((batch) => <button onClick={() => go('biotecnologia')} key={batch.id}><span className={`biotech-stage-dot ${batch.current_stage}`}><IcoLeaf /></span><div><small>{STAGE_LABEL[batch.current_stage]}</small><strong>{batch.code}</strong><p>Código interno de producción</p></div><aside><strong>{number(batch.current_viable_plants)}</strong><span>plantas</span></aside><IcoArrow /></button>)}</div> : <div className="worker-orders-empty"><IcoLeaf /><strong>Sin códigos activos</strong><span>Administración puede iniciar un código desde cualquier etapa.</span></div>}</section>
  </>
}

function CodeAndEquipmentWorkspace({ data, go, workerName }) {
  const activeCodes = (data.batches || []).filter((item) => item.status === 'active' && !item.archived_at).length
  return <>
    <section className="restricted-worker-hero anim-in d1">
      <span className="worker-command-avatar">{firstName(workerName)[0]}</span>
      <div><span className="eyebrow">Acceso operativo restringido</span><h1>Hola, {firstName(workerName)}</h1><p>Tu PIN permite crear códigos vegetales y registrar el uso de equipos. No muestra órdenes, clientes ni registros de producción.</p></div>
    </section>
    <section className="restricted-worker-actions anim-in d2">
      <button onClick={() => go('biotecnologia')}><span><IcoLeaf /></span><div><small>Biotecnología</small><h2>Crear un código</h2><p>Selecciona cultivo, variedad, etapa y fecha de inicio.</p><strong>{activeCodes} códigos activos <IcoArrow /></strong></div></button>
      <button onClick={() => go('operaciones')}><span><IcoFlask /></span><div><small>Equipos</small><h2>Iniciar un equipo</h2><p>Elige equipo, selecciona Orden o Biotecnología y pulsa Iniciar.</p><strong>Registro rápido <IcoArrow /></strong></div></button>
    </section>
  </>
}

function BiotechnologyWorkspace({ data, loading, user, notify, onData }) {
  const activeCodes = (data.batches || []).filter((item) => item.status === 'active' && !item.archived_at && item.current_stage !== 'completed')
  const people = data.availableWorkers || []
  const makeEntry = () => ({ id: `${Date.now()}-${Math.random()}`, batchId: '', sourceQuery: '', analystIds: [user.activeWorker?.id].filter(Boolean), performedOn: todayInput(), inputBags: '', outputBags: '', rootingBags: '0', targetSubculture: '' })
  const [entries, setEntries] = useState(() => [makeEntry()])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const personal = (data.workers || []).find((item) => item.id === user.activeWorker?.id) || {}
  const personalRate = Number(personal.multiplication_input) ? Number(personal.multiplication_output) / Number(personal.multiplication_input) : 0
  const history = (data.recentEvents || []).filter((item) => item.worker_name === user.activeWorker?.fullName).slice(0, 8)
  const stageName = (item) => item.current_stage === 'multiplication' ? `Subcultivo ${Number(item.current_subculture) + 1}` : STAGE_LABEL[item.current_stage] || item.current_stage
  const codeName = (item) => {
    const date = item.started_on ? new Date(`${String(item.started_on).slice(0, 10)}T12:00:00`).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: '2-digit' }) : 'Sin fecha'
    return `${item.code} · ${stageName(item)} · ${date}`
  }
  const cultivationAlerts = activeCodes
    .map((item) => ({ item, deadline: cultivationDeadline(item) }))
    .sort((a, b) => a.deadline.rank - b.deadline.rank || (a.deadline.remaining ?? 0) - (b.deadline.remaining ?? 0))
  const alertCounts = cultivationAlerts.reduce((counts, entry) => ({ ...counts, [entry.deadline.tone]: (counts[entry.deadline.tone] || 0) + 1 }), {})
  const visibleCultivationAlerts = ['overdue', 'due-soon', 'upcoming'].flatMap((tone) => cultivationAlerts.filter((entry) => entry.deadline.tone === tone).slice(0, 5))

  const updateEntry = (id, values) => setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, ...values } : entry))
  const toggleAnalyst = (entry, analystId) => {
    const selected = entry.analystIds.includes(analystId)
    const next = selected ? entry.analystIds.filter((id) => id !== analystId) : entry.analystIds.length < 2 ? [...entry.analystIds, analystId] : [analystId]
    updateEntry(entry.id, { analystIds: next })
  }
  const submit = async (event) => {
    event.preventDefault()
    if (entries.some((entry) => !entry.batchId)) return setFormError('Escribe y toca una bolsa de la lista para cada registro.')
    if (entries.some((entry) => !entry.analystIds.length)) return setFormError('Selecciona quién realizó cada registro.')
    setSaving(true); setFormError('')
    try {
      const result = await api.createBiotechnology({ action: 'record_simple_bulk', records: entries.map((entry) => ({ batchId: entry.batchId, analystId: entry.analystIds[0], collaboratorAnalystId: entry.analystIds[1] || '', performedOn: entry.performedOn, inputBags: entry.inputBags, outputBags: entry.outputBags, rootingBags: entry.rootingBags || '0', targetSubculture: entry.targetSubculture || '' })) })
      onData(result); notify(entries.length === 1 ? 'Registro guardado.' : `${entries.length} registros guardados.`); setEntries([makeEntry()])
    } catch (requestError) { setFormError(requestError.message) }
    finally { setSaving(false) }
  }

  return <div className="biotech-center-direct">
    <section className="card biotech-one-step-card">
      <header><span className="eyebrow">Centro de trabajo</span><h2>Registra las bolsas</h2><p>El nuevo código llevará la fecha que indiques. Las bolsas iniciales son libres.</p></header>
      {formError && <div className="form-error">{formError}</div>}
      {loading ? <div className="biotech-loading">Cargando códigos…</div> : activeCodes.length ? <form onSubmit={submit}>
        <div className="biotech-entry-list">{entries.map((entry, index) => {
          const selectedCode = activeCodes.find((item) => item.id === entry.batchId)
          const sourceMatches = searchSourceBags(activeCodes, entry.sourceQuery).slice(0, 10)
          return <section className="biotech-entry" key={entry.id}>
            <header><strong>{entries.length > 1 ? `Registro ${index + 1}` : 'Nuevo registro'}</strong>{entries.length > 1 && <button type="button" onClick={() => setEntries((current) => current.filter((item) => item.id !== entry.id))}>Quitar</button>}</header>
            <div className="biotech-analyst-picks"><span>Paso 2 · Selecciona quién lo hizo</span><div>{people.map((person) => <button type="button" key={person.id} className={entry.analystIds.includes(person.id) ? 'active' : ''} onClick={() => toggleAnalyst(entry, person.id)}><i>{person.full_name.split(/\s+/).slice(0,2).map((part) => part[0]).join('').toUpperCase()}</i>{firstName(person.full_name)}{entry.analystIds.includes(person.id) && <IcoCheck />}</button>)}</div></div>
            <div className="biotech-entry-fields">
              <label className="field field-wide biotech-bag-search"><span>1. Busca y toca la bolsa que vas a trabajar</span><input value={entry.sourceQuery} onChange={(event) => updateEntry(entry.id, { sourceQuery: event.target.value, batchId: '' })} placeholder="Escribe 5G, C6 o 10-08" autoComplete="off" required />
                {entry.sourceQuery.trim() && !entry.batchId && <div className="biotech-bag-suggestions">{sourceMatches.length ? sourceMatches.map((item) => <button type="button" className={entry.batchId === item.id ? 'selected' : ''} onClick={() => updateEntry(entry.id, { batchId: item.id, sourceQuery: `${item.code} · ${stageName(item)} · ${shortDate(item.current_stage_started_on || item.started_on)}` })} key={item.id}><span className={`biotech-stage-dot ${item.current_stage}`}><IcoLeaf /></span><div><strong>{item.code}</strong><small>{stageName(item)} · {shortDate(item.current_stage_started_on || item.started_on)}</small></div>{entry.batchId === item.id && <IcoCheck />}</button>) : <div className="biotech-bag-no-result">No encontramos esa bolsa. Prueba con el código, C6 o la fecha.</div>}</div>}
              </label>
              <label className="field"><span>Fecha de este registro</span><input type="date" value={entry.performedOn} onChange={(event) => updateEntry(entry.id, { performedOn: event.target.value })} required /></label>
              <label className="field"><span>Bolsas iniciales · lo que recibiste</span><input inputMode="numeric" type="number" min="0" value={entry.inputBags} onChange={(event) => updateEntry(entry.id, { inputBags: event.target.value })} placeholder="0" required /></label>
              <label className="field"><span>Bolsas finales · lo que obtuviste</span><input inputMode="numeric" type="number" min="0" value={entry.outputBags} onChange={(event) => updateEntry(entry.id, { outputBags: event.target.value })} placeholder="0" required /></label>
              {selectedCode?.current_stage === 'multiplication' && Number(selectedCode.current_subculture) + 1 < Number(selectedCode.target_subcultures) && <label className="field"><span>Pasa a subcultivo</span><select value={entry.targetSubculture} onChange={(event) => updateEntry(entry.id, { targetSubculture: event.target.value })}><option value="">Siguiente · Subcultivo {Number(selectedCode.current_subculture) + 2}</option>{Array.from({ length: Math.max(0, Number(selectedCode.target_subcultures) - Number(selectedCode.current_subculture) - 1) }, (_, offset) => Number(selectedCode.current_subculture) + 2 + offset).map((subculture) => <option value={subculture} key={subculture}>Subcultivo {subculture}</option>)}</select></label>}
              <label className="field field-wide biotech-rooting-field"><span>Bolsas para enraizamiento · opcional</span><input inputMode="numeric" type="number" min="0" value={entry.rootingBags} onChange={(event) => updateEntry(entry.id, { rootingBags: event.target.value })} /></label>
            </div>
            {selectedCode && <div className="biotech-entry-summary"><strong>{codeName(selectedCode)}</strong><span>Paso 3 · Escribe bolsas iniciales y finales</span></div>}
          </section>
        })}</div>
        <div className="biotech-one-step-actions"><button type="button" className="btn biotech-add-entry" onClick={() => setEntries((current) => [...current, makeEntry()])}>+ Añadir otro registro</button><button className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : entries.length > 1 ? `Crear ${entries.length} códigos` : 'Guardar y crear código'} <IcoArrow /></button></div>
      </form> : <div className="biotech-simple-empty"><IcoCheck /><strong>No hay códigos activos</strong><span>Administración puede habilitar el siguiente código.</span></div>}
    </section>
    {!!cultivationAlerts.length && <section className="biotech-cultivation-alerts" aria-label="Cultivos por atender">
      <header>
        <div><span className="eyebrow">Control de los 20 días</span><h2>Cultivos por atender</h2><p>Primero aparecen los cultivos vencidos, luego los próximos a vencer y los que aún están dentro del plazo.</p></div>
        <div className="biotech-alert-legend"><span className="overdue"><i />{alertCounts.overdue || 0} vencidos</span><span className="due-soon"><i />{alertCounts['due-soon'] || 0} por vencer</span><span className="upcoming"><i />{alertCounts.upcoming || 0} a tiempo</span></div>
      </header>
      <div className="biotech-cultivation-alert-list">{visibleCultivationAlerts.map(({ item, deadline }) => <article className={deadline.tone} key={item.id}>
        <span className="biotech-alert-icon"><IcoCalendar /></span>
        <div className="biotech-alert-code"><small>Código</small><strong>{item.code}</strong><span>{stageName(item)}</span></div>
        <div className="biotech-alert-date"><small>Inicio de etapa</small><strong>{shortDate(item.current_stage_started_on || item.started_on)}</strong><span>{codeName(item)}</span></div>
        <div className="biotech-alert-status"><strong>{deadline.label}</strong><span>{deadline.detail}</span></div>
      </article>)}</div>
      {cultivationAlerts.length > visibleCultivationAlerts.length && <p className="biotech-alert-footnote">Se muestran los 5 primeros de cada nivel de urgencia · {cultivationAlerts.length} cultivos activos en total.</p>}
    </section>}
    <section className="biotech-inline-statistics"><header><span className="eyebrow">Estadísticas</span><h2>Tu producción</h2><p>Se actualiza automáticamente con cada registro.</p></header><div className="biotech-personal-kpis"><article><span>Registros realizados</span><strong>{number(personal.event_count)}</strong></article><article><span>Plantas producidas</span><strong>{number(personal.viable_output)}</strong></article><article><span>Multiplicación real</span><strong>×{personalRate.toLocaleString('es-PE', { maximumFractionDigits: 2 })}</strong></article></div><div className="biotech-personal-history"><h3>Actividad reciente</h3>{history.map((item) => <article key={item.id}><span className={`biotech-stage-dot ${item.stage}`}><IcoLeaf /></span><div><strong>{item.code}</strong><small>{item.stage === 'multiplication' ? `Subcultivo ${item.subculture_number}` : STAGE_LABEL[item.stage]} · {shortDate(item.performed_at)}</small></div><b>{number(item.viable_output_plants)} plantas</b></article>)}{!history.length && <div className="biotech-simple-empty small">La actividad aparecerá después del primer registro.</div>}</div></section>
  </div>
}

export default function WorkerDashboard({ go, user, notify }) {
  const isBiotechnology = Boolean(user.activeWorker?.biotechnologyAccess)
  const restrictedCreator = Boolean(user.activeWorker?.codeCreatorOnly)
  const [data, setData] = useState(isBiotechnology ? { settings: { default_plants_per_bag: 4 }, batches: [], assignments: [], personalAssignments: [], personalMetrics: {}, metrics: {}, workers: [], availableWorkers: [], recentEvents: [] } : { equipment: [], services: [], processes: [] })
  const [equipmentData, setEquipmentData] = useState({ equipment: [], equipmentRuns: [] })
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [now, setNow] = useState(new Date())

  const load = async () => {
    setLoading(true)
    try {
      if (isBiotechnology) setData(await api.biotechnology())
      else {
        const [operations, equipment] = await Promise.all([api.labOperations(), api.equipmentOperations().catch(() => ({ equipment: [], equipmentRuns: [] }))])
        setData(operations); setEquipmentData(equipment)
      }
      setError('')
    } catch (requestError) { setError(requestError.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [user.activeWorker?.id, isBiotechnology])
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(timer) }, [])
  const workerName = user.activeWorker?.fullName || user.nombre
  const summary = useMemo(() => isBiotechnology
    ? `${data.batches?.filter((item) => item.status === 'active').length || 0} códigos activos`
    : `${data.services?.filter((item) => ['accepted', 'in_progress'].includes(item.status)).length || 0} órdenes activas`, [data, isBiotechnology])

  return <div className={`worker-command-center ${isBiotechnology ? 'biotechnology' : 'analysis'}`}>
    {!isBiotechnology && <section className="worker-command-hero anim-in d1">
      <div className="worker-command-identity"><span className="worker-command-avatar">{user.activeWorker?.initials || firstName(workerName)[0]}</span><div><span className="eyebrow">Sesión personal · PIN verificado</span><h1>Hola, {firstName(workerName)}</h1><p>{isBiotechnology ? 'Tu producción vegetal, tus asignaciones y el flujo completo de cada código.' : 'Tu turno de laboratorio organizado por prioridad, etapa y trazabilidad.'}</p></div></div>
      <div className="worker-command-live"><span><i /> En línea</span><strong>{now.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</strong><small>{now.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' })}</small></div>
      <div className="worker-command-brief"><span>Resumen de tu espacio</span><strong>{summary}</strong><small>{isBiotechnology ? 'Biotecnología vegetal' : 'Análisis de laboratorio'} · datos sincronizados</small></div>
    </section>}
    {error && <div className="form-error">{error}</div>}
    {restrictedCreator
      ? <CodeAndEquipmentWorkspace data={data} go={go} workerName={workerName} />
      : isBiotechnology
      ? <BiotechnologyWorkspace data={data} loading={loading} user={user} notify={notify} onData={setData} />
      : <AnalysisWorkspace data={data} equipmentData={equipmentData} loading={loading} onOpen={(service) => service && setSelectedOrder(service)} onReload={load} />}
    <section className="worker-privacy-rail anim-in d5"><IcoShield /><div><strong>Entorno personal y protegido</strong><span>Solo ves códigos asignados o códigos vegetales autorizados. La identidad del cliente nunca se muestra en este portal.</span></div><span><IcoUser /> {workerName}</span></section>
    {selectedOrder && <ServiceWorkflowModal service={selectedOrder} user={user} onClose={() => setSelectedOrder(null)} onChanged={load} notify={notify} />}
  </div>
}
