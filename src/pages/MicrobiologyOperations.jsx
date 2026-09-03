import { useEffect, useMemo, useState } from 'react'
import { IcoArrow, IcoCheck, IcoFile, IcoFlask, IcoPlus, IcoShield } from '../components/Icons.jsx'
import { api } from '../data/api.js'
import { suggestedMicrobiologyAnalyses } from '../data/microbiology.js'

function localInput(value = new Date()) {
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function dateLabel(value) {
  return value ? new Date(value).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' }) : 'Sin registrar'
}

async function readPdf(file) {
  if (!file || file.type !== 'application/pdf' || !file.name.toLowerCase().endsWith('.pdf')) throw new Error('Selecciona un archivo PDF.')
  if (file.size > 3_000_000) throw new Error('El informe no puede superar los 3 MB.')
  const header = new Uint8Array(await file.slice(0, 5).arrayBuffer())
  if (String.fromCharCode(...header) !== '%PDF-') throw new Error('El archivo no es un PDF válido.')
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  return { fileName: file.name, mimeType: file.type, dataUrl, fileSize: file.size }
}

function baseForm(step, data, userId, equipment, analysts) {
  const now = new Date()
  const earlier = new Date(now.getTime() - 45 * 60000)
  if (step.step_key === 'autoclave') return {
    equipmentId: data.equipmentId || equipment.find((item) => item.equipment_type === 'autoclave' && item.status === 'active')?.id || '',
    cycleNumber: data.cycleNumber || '', programName: data.programName || '',
    startedAt: localInput(data.startedAt || earlier), endedAt: localInput(data.endedAt || now),
    temperatureC: data.temperatureC || '121', pressureBar: data.pressureBar || '1.05', holdingMinutes: data.holdingMinutes || '15',
    loadType: data.loadType || 'culture_media', loadDescription: data.loadDescription || '', operatorUserId: data.operatorUserId || userId,
    chemicalIndicator: data.chemicalIndicator || 'pending', biologicalIndicator: data.biologicalIndicator || 'not_applicable',
    releaseResult: data.releaseResult || 'pending', observations: step.observations || data.observations || '',
  }
  if (step.step_key === 'plating') return {
    performedAt: localInput(data.performedAt || now), cultureMedium: data.cultureMedium || '', mediumBatch: data.mediumBatch || '',
    method: data.method || 'Siembra en placa', volumeMl: data.volumeMl || '', unitCount: data.unitCount || '',
    cabinetCode: data.cabinetCode || '', sterilityControl: data.sterilityControl || 'pending',
    operatorUserId: data.operatorUserId || userId, inoculationDetail: data.inoculationDetail || '', observations: step.observations || '',
  }
  if (step.step_key === 'incubation') return {
    incubatorCode: data.incubatorCode || '', temperatureC: data.temperatureC || '', startedAt: localInput(data.startedAt || now),
    endedAt: localInput(data.endedAt || new Date(now.getTime() + 24 * 60 * 60000)), durationHours: data.durationHours || '24',
    atmosphere: data.atmosphere || 'Aerobiosis', positionReference: data.positionReference || '',
    incubationPurpose: data.incubationPurpose || '', conditionResult: data.conditionResult || 'pending',
    operatorUserId: data.operatorUserId || userId, observations: step.observations || '',
  }
  if (step.step_key === 'reading') return {
    readingAt: localInput(data.readingAt || now), method: data.method || 'Conteo de colonias', dilution: data.dilution || '', units: data.units || 'UFC/mL',
    positiveControl: data.positiveControl || 'not_applicable', negativeControl: data.negativeControl || 'conforming',
    analystId: data.analystId || analysts[0]?.id || '', reviewResult: data.reviewResult || 'pending',
    resultSummary: data.resultSummary || '', observations: step.observations || '',
  }
  return { issuedAt: localInput(data.issuedAt || now), notes: data.notes || step.observations || '', report: null }
}

function Field({ label, wide, children }) { return <label className={`field ${wide ? 'field-wide' : ''}`}><span>{label}</span>{children}</label> }

function ActiveWorkerField({ worker, label = 'Responsable' }) {
  return <div className="field"><span>{label}</span><div className="micro-active-worker"><span>{worker.initials}</span><div><strong>{worker.fullName}</strong><small>Identificado mediante PIN</small></div><IcoCheck /></div></div>
}

function ResultSelect({ value, onChange, allowNA = true }) {
  return <select value={value} onChange={onChange}>{allowNA && <option value="not_applicable">No aplica</option>}<option value="pending">Pendiente</option><option value="conforming">Conforme</option><option value="nonconforming">No conforme</option></select>
}

const STEP_COPY = {
  autoclave: 'Parámetros del ciclo, indicadores y liberación de la carga.',
  plating: 'Medio, lote, servido, inoculación y control de esterilidad.',
  incubation: 'Equipo, temperatura, periodo y condición de incubación.',
  reading: 'Conteo, controles, unidades, resultado y revisión del analista.',
  report: 'Carga y publicación del informe validado para el cliente.',
}

export default function MicrobiologyOperations({ user, notify, go }) {
  const isAdmin = user.role === 'admin'
  const [data, setData] = useState({ services: [], processes: [], equipment: [], operators: [], analysts: [], analysisOptions: [], stepTemplate: [] })
  const [selectedServiceId, setSelectedServiceId] = useState('')
  const [selectedProcessId, setSelectedProcessId] = useState('')
  const [creating, setCreating] = useState(false)
  const [selectedAnalyses, setSelectedAnalyses] = useState([])
  const [processTitle, setProcessTitle] = useState('')
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const result = await api.labOperations()
      setData(result)
      setError('')
      if (selectedServiceId && !result.services.some((item) => item.id === selectedServiceId)) setSelectedServiceId('')
    } catch (requestError) { setError(requestError.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const selectedService = data.services.find((item) => item.id === selectedServiceId)
  const allowedAnalyses = selectedService?.allowed_analyses || []
  const serviceProcesses = useMemo(() => data.processes.filter((item) => item.service_id === selectedServiceId), [data.processes, selectedServiceId])
  const selectedProcess = serviceProcesses.find((item) => item.id === selectedProcessId) || serviceProcesses[0]

  useEffect(() => {
    if (serviceProcesses.length && !serviceProcesses.some((item) => item.id === selectedProcessId)) setSelectedProcessId(serviceProcesses[0].id)
    if (!serviceProcesses.length) setSelectedProcessId('')
  }, [selectedServiceId, data.processes])

  const chooseService = (serviceId) => {
    setSelectedServiceId(serviceId)
    const processes = data.processes.filter((item) => item.service_id === serviceId)
    setSelectedProcessId(processes[0]?.id || '')
    setError('')
  }

  const openCreate = () => {
    if (!selectedService) return
    const suggested = suggestedMicrobiologyAnalyses(selectedService.service_items)
    const allowedCodes = allowedAnalyses.map((item) => item.code)
    setSelectedAnalyses(suggested.filter((code) => allowedCodes.includes(code)).length
      ? suggested.filter((code) => allowedCodes.includes(code))
      : allowedCodes)
    setProcessTitle('')
    setCreating(true)
    setError('')
  }

  const createProcess = async (event) => {
    event.preventDefault()
    setSaving(true); setError('')
    try {
      const result = await api.createLabOperation({ action: 'create_microbiology_process', serviceId: selectedServiceId, analysisCodes: selectedAnalyses, title: processTitle })
      setCreating(false)
      await load()
      setSelectedProcessId(result.process.id)
      notify('Flujo microbiológico creado para el código del servicio.')
    } catch (requestError) { setError(requestError.message) } finally { setSaving(false) }
  }

  const openStep = (step) => {
    setEditing(step)
    setForm(baseForm(step, step.step_data || {}, user.id, data.equipment,
      isAdmin ? (selectedService?.assigned_analysts || []) : data.analysts))
    setError('')
  }

  const saveStep = async (event) => {
    event.preventDefault()
    setSaving(true); setError('')
    try {
      if (editing.step_key === 'report') {
        if (!form.report) throw new Error('Adjunta el informe final en PDF.')
        await api.createLabOperation({ action: 'upload_microbiology_report', processId: selectedProcess.id, report: form.report, issuedAt: new Date(form.issuedAt).toISOString(), notes: form.notes })
        notify('Informe enviado a aprobación. Todavía no es visible para el cliente.')
      } else {
        const { observations, ...stepData } = form
        await api.createLabOperation({ action: 'save_microbiology_step', processId: selectedProcess.id, stepId: editing.id, data: stepData, observations })
        notify('Etapa completada y PDF de conformidad habilitado.')
      }
      setEditing(null); setForm(null); await load()
    } catch (requestError) { setError(requestError.message) } finally { setSaving(false) }
  }

  const reopen = async (step) => {
    setSaving(true); setError('')
    try {
      await api.updateLabOperation({ action: 'reopen_microbiology_step', processId: selectedProcess.id, stepId: step.id })
      await load(); notify('La etapa se reabrió sin eliminar el historial ni los PDFs anteriores.')
    } catch (requestError) { setError(requestError.message) } finally { setSaving(false) }
  }

  const chooseReport = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setSaving(true); setError('')
    try {
      const report = await readPdf(file)
      setForm((current) => ({ ...current, report }))
    } catch (requestError) { setError(requestError.message) } finally { setSaving(false); event.target.value = '' }
  }

  const setValue = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const progress = selectedProcess ? Math.round(((selectedProcess.steps.filter((step) => step.status === 'completed').length) / selectedProcess.steps.length) * 100) : 0

  return (
    <div className="micro-ops-page">
      <section className="micro-ops-hero anim-in d1">
        <div><span className="eyebrow">Operación vinculada · por expediente</span><h1>Flujos microbiológicos</h1><p>{isAdmin ? 'Cada código muestra el cliente, el alcance solicitado, el equipo asignado y los formatos pendientes.' : 'El trabajo comienza por el código y muestra exactamente los análisis autorizados. La identidad del cliente permanece protegida.'}</p></div>
        <div className="micro-privacy-card"><IcoShield /><div><strong>{user.activeWorker ? user.activeWorker.fullName : 'Control administrativo'}</strong><span>{user.activeWorker ? 'Trabajador identificado · PIN verificado' : 'Cliente, alcance y responsables vinculados'}</span></div></div>
      </section>

      <section className="micro-service-picker anim-in d2">
        <div className="micro-picker-copy"><span className="eyebrow">Paso 1</span><h2>Selecciona el código del servicio</h2><p>{isAdmin ? 'El titular solo se muestra a administradores.' : 'No se muestran nombres, empresas, correos ni otros datos del cliente.'}</p></div>
        <label className="micro-code-select"><span>Código del servicio</span><select value={selectedServiceId} onChange={(event) => chooseService(event.target.value)}><option value="">Seleccionar código…</option>{data.services.map((service) => <option value={service.id} key={service.id}>{service.code}{isAdmin && service.client_name ? ` · ${service.client_name}` : ''}</option>)}</select></label>
      </section>

      {error && !editing && !creating && <div className="form-error">{error}</div>}
      {loading ? <div className="card lab-empty">Cargando expedientes…</div> : !selectedService ? (
        <section className="micro-code-board anim-in d3">
          <header><div><span className="eyebrow">Expedientes disponibles</span><h2>Códigos de servicio</h2></div><span>{data.services.length} disponibles</span></header>
          <div>{data.services.map((service) => <button key={service.id} onClick={() => chooseService(service.id)}><span>{service.status === 'in_progress' ? 'En proceso' : service.status === 'accepted' ? 'Aceptado' : 'Completado'}</span><strong>{service.code}</strong>{isAdmin && <em>{service.client_name || 'Cliente no disponible'}{service.client_company ? ` · ${service.client_company}` : ''}</em>}<small>{service.service_items.slice(0,2).map((item) => item.name).join(' · ')}{service.service_items.length > 2 ? ` +${service.service_items.length - 2}` : ''}</small><b>{service.laboratory_process_count} {service.laboratory_process_count === 1 ? 'flujo vinculado' : 'flujos vinculados'}</b><IcoArrow /></button>)}</div>
        </section>
      ) : (
        <>
          <section className="micro-expedient anim-in d2">
            <div className="micro-expedient-code"><span>Expediente seleccionado</span><strong>{selectedService.code}</strong><small>{isAdmin ? `${selectedService.client_name}${selectedService.client_company ? ` · ${selectedService.client_company}` : ''}` : 'Identidad del cliente protegida'}</small></div>
            <div className="micro-requested"><span>Alcance solicitado por el cliente</span><div>{selectedService.service_items.map((item) => <span key={item.id}>{item.name}</span>)}</div><p>{selectedService.sample_count} {selectedService.sample_count === 1 ? 'muestra' : 'muestras'} · {selectedService.zone_name} · Etapa general: {selectedService.current_stage_title || 'Por iniciar'}</p></div>
            {allowedAnalyses.length ? <button className="btn btn-primary" onClick={openCreate}><IcoPlus /> Nuevo flujo microbiológico</button> : <button className="btn btn-ghost" onClick={() => go?.('ordenes')}><IcoArrow /> Editar alcance de la orden</button>}
          </section>

          {!allowedAnalyses.length && <section className="micro-scope-warning"><IcoShield /><div><strong>Este código no contiene un análisis microbiológico específico</strong><p>Agrega a la orden coliformes, heterótrofas, Listeria u otro ensayo concreto. Operaciones no permitirá registrar actividades ajenas al pedido del cliente.</p></div>{isAdmin && <button className="btn btn-primary btn-sm" onClick={() => go?.('ordenes')}>Editar orden</button>}</section>}

          {serviceProcesses.length === 0 ? (
            <section className="card micro-no-process anim-in d3"><span><IcoFlask /></span><h2>Este código aún no tiene flujo microbiológico</h2><p>{allowedAnalyses.length ? 'Selecciona los análisis de la muestra para crear las cinco etapas y sus formatos.' : 'Primero agrega al alcance de la orden el análisis microbiológico que debe realizarse.'}</p>{allowedAnalyses.length ? <button className="btn btn-primary" onClick={openCreate}><IcoPlus /> Configurar flujo</button> : isAdmin && <button className="btn btn-primary" onClick={() => go?.('ordenes')}>Editar alcance de la orden</button>}</section>
          ) : (
            <>
              <div className="micro-process-switch anim-in d3">
                <div>{serviceProcesses.map((process) => <button className={selectedProcess?.id === process.id ? 'active' : ''} key={process.id} onClick={() => setSelectedProcessId(process.id)}><span>{process.process_code}</span><strong>{process.title}</strong></button>)}</div>
                {allowedAnalyses.length ? <button className="btn btn-ghost" onClick={openCreate}><IcoPlus /> Otro flujo</button> : isAdmin && <button className="btn btn-ghost" onClick={() => go?.('ordenes')}>Editar alcance</button>}
              </div>

              {selectedProcess && <section className="micro-process-workspace anim-in d3">
                <header className="micro-process-head">
                  <div><span className="eyebrow">{selectedProcess.process_code}</span><h2>{selectedProcess.title}</h2><div className="micro-analysis-chips">{selectedProcess.analysis_names.map((name) => <span key={name}>{name}</span>)}</div></div>
                  <div className="micro-progress"><strong>{progress}%</strong><span>completado</span><div><i style={{ width: `${progress}%` }} /></div></div>
                </header>
                <div className="micro-flow-ribbon">{selectedProcess.steps.map((step, index) => <div className={step.status} key={step.id}><span>{step.status === 'completed' ? <IcoCheck /> : index + 1}</span><strong>{step.title}</strong></div>)}</div>
                <div className="micro-step-list">
                  {selectedProcess.steps.map((step, index) => (
                    <article className={`micro-step-card ${step.status}`} key={step.id}>
                      <div className="micro-step-index"><span>{step.status === 'completed' ? <IcoCheck /> : index + 1}</span><i /></div>
                      <div className="micro-step-main"><header><div><span>{step.document_code}</span><h3>{step.title}</h3></div><span className={`lab-status ${step.status === 'completed' ? 'good' : 'pending'}`}><i />{step.status === 'completed' ? 'Conforme' : step.status === 'current' ? 'Etapa actual' : 'Pendiente'}</span></header><p>{STEP_COPY[step.step_key]}</p>{step.completed_at && <small>Registrada {dateLabel(step.completed_at)} · {step.completed_by_name}</small>}</div>
                      <div className="micro-step-actions">
                        {step.status === 'completed' && <a className="lab-pdf-link" target="_blank" rel="noreferrer" href={`/api/service-workflow?serviceId=${encodeURIComponent(selectedService.id)}&processId=${encodeURIComponent(selectedProcess.id)}&labStepId=${encodeURIComponent(step.id)}&format=lab-step`}><IcoFile /> PDF de conformidad</a>}
                        {(step.status === 'current' || step.status === 'completed') && <button className="btn btn-primary btn-sm" onClick={() => openStep(step)}>{step.status === 'completed' ? 'Editar registro' : step.step_key === 'report' ? 'Subir informe' : 'Completar etapa'}</button>}
                        {step.status === 'completed' && step.position < selectedProcess.current_step_position && <button className="text-link" disabled={saving} onClick={() => reopen(step)}>Retroceder aquí</button>}
                      </div>
                    </article>
                  ))}
                </div>
              </section>}
            </>
          )}
        </>
      )}

      {creating && <div className="modal-overlay" onClick={() => setCreating(false)}><form className="modal micro-create-modal" onSubmit={createProcess} onClick={(event) => event.stopPropagation()}><div className="modal-heading"><span className="modal-icon"><IcoFlask /></span><div><span className="eyebrow">{selectedService.code}</span><h2>Configurar flujo microbiológico</h2><p>Solo aparecen los análisis incluidos en la orden. Puedes agrupar varios si comparten la secuencia operativa.</p></div></div><Field label="Nombre interno del flujo" wide><input value={processTitle} onChange={(event) => setProcessTitle(event.target.value)} placeholder="Ej. Microbiología de agua · Muestra 01" /></Field><div className="micro-analysis-options">{allowedAnalyses.map((analysis) => <label className={selectedAnalyses.includes(analysis.code) ? 'selected' : ''} key={analysis.code}><input type="checkbox" checked={selectedAnalyses.includes(analysis.code)} onChange={() => setSelectedAnalyses((current) => current.includes(analysis.code) ? current.filter((code) => code !== analysis.code) : [...current, analysis.code])} /><span><IcoFlask /></span><div><strong>{analysis.name}</strong><small>Incluido en el alcance del cliente</small></div><i><IcoCheck /></i></label>)}</div>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}>Cancelar</button><button className="btn btn-primary" disabled={saving || !selectedAnalyses.length}>{saving ? 'Creando…' : 'Crear flujo de 5 etapas'}</button></div></form></div>}

      {editing && form && <div className="modal-overlay" onClick={() => setEditing(null)}><form className="modal micro-step-modal" onSubmit={saveStep} onClick={(event) => event.stopPropagation()}><div className="modal-heading"><span className="modal-icon"><IcoFlask /></span><div><span className="eyebrow">{editing.document_code} · {selectedService.code}</span><h2>{editing.title}</h2><p>{STEP_COPY[editing.step_key]} Al guardar se emitirá el formato de conformidad.</p></div></div>
        {editing.step_key === 'autoclave' && <div className="form-grid"><Field label="Autoclave"><select value={form.equipmentId} onChange={(e) => setValue('equipmentId', e.target.value)} required><option value="">Seleccionar…</option>{data.equipment.filter((item) => item.equipment_type === 'autoclave' && item.status === 'active').map((item) => <option value={item.id} key={item.id}>{item.code} · {item.name}</option>)}</select></Field><Field label="Operador"><select value={form.operatorUserId} onChange={(e) => setValue('operatorUserId', e.target.value)}>{data.operators.map((item) => <option value={item.id} key={item.id}>{item.full_name}</option>)}</select></Field><Field label="Número de ciclo"><input value={form.cycleNumber} onChange={(e) => setValue('cycleNumber', e.target.value)} /></Field><Field label="Programa"><input value={form.programName} onChange={(e) => setValue('programName', e.target.value)} /></Field><Field label="Inicio"><input type="datetime-local" value={form.startedAt} onChange={(e) => setValue('startedAt', e.target.value)} required /></Field><Field label="Fin"><input type="datetime-local" value={form.endedAt} onChange={(e) => setValue('endedAt', e.target.value)} required /></Field><Field label="Temperatura (°C)"><input type="number" step="0.01" value={form.temperatureC} onChange={(e) => setValue('temperatureC', e.target.value)} required /></Field><Field label="Presión (bar)"><input type="number" step="0.001" value={form.pressureBar} onChange={(e) => setValue('pressureBar', e.target.value)} required /></Field><Field label="Tiempo de sostén (min)"><input type="number" value={form.holdingMinutes} onChange={(e) => setValue('holdingMinutes', e.target.value)} required /></Field><Field label="Tipo de carga"><select value={form.loadType} onChange={(e) => setValue('loadType', e.target.value)}><option value="culture_media">Medios de cultivo</option><option value="material">Material</option><option value="mixed">Carga mixta</option></select></Field><Field label="Indicador químico"><ResultSelect value={form.chemicalIndicator} onChange={(e) => setValue('chemicalIndicator', e.target.value)} /></Field><Field label="Indicador biológico"><ResultSelect value={form.biologicalIndicator} onChange={(e) => setValue('biologicalIndicator', e.target.value)} /></Field><Field label="Liberación de la carga"><select value={form.releaseResult} onChange={(e) => setValue('releaseResult', e.target.value)}><option value="pending">Pendiente</option><option value="released">Liberada</option><option value="rejected">Rechazada</option></select></Field><Field label="Descripción de la carga" wide><textarea rows="3" value={form.loadDescription} onChange={(e) => setValue('loadDescription', e.target.value)} required /></Field><Field label="Observaciones" wide><textarea rows="3" value={form.observations} onChange={(e) => setValue('observations', e.target.value)} /></Field></div>}
        {editing.step_key === 'plating' && <div className="form-grid"><Field label="Fecha y hora"><input type="datetime-local" value={form.performedAt} onChange={(e) => setValue('performedAt', e.target.value)} required /></Field><Field label="Responsable"><select value={form.operatorUserId} onChange={(e) => setValue('operatorUserId', e.target.value)}>{data.operators.map((item) => <option value={item.id} key={item.id}>{item.full_name}</option>)}</select></Field><Field label="Medio de cultivo"><input value={form.cultureMedium} onChange={(e) => setValue('cultureMedium', e.target.value)} required /></Field><Field label="Lote del medio"><input value={form.mediumBatch} onChange={(e) => setValue('mediumBatch', e.target.value)} /></Field><Field label="Método"><input value={form.method} onChange={(e) => setValue('method', e.target.value)} required /></Field><Field label="Código de cabina"><input value={form.cabinetCode} onChange={(e) => setValue('cabinetCode', e.target.value)} placeholder="Opcional por ahora" /></Field><Field label="Volumen por unidad (mL)"><input type="number" step="0.01" value={form.volumeMl} onChange={(e) => setValue('volumeMl', e.target.value)} required /></Field><Field label="Unidades preparadas"><input type="number" value={form.unitCount} onChange={(e) => setValue('unitCount', e.target.value)} required /></Field><Field label="Control de esterilidad"><ResultSelect value={form.sterilityControl} onChange={(e) => setValue('sterilityControl', e.target.value)} allowNA={false} /></Field><Field label="Detalle del servido e inoculación" wide><textarea rows="3" value={form.inoculationDetail} onChange={(e) => setValue('inoculationDetail', e.target.value)} /></Field><Field label="Observaciones" wide><textarea rows="3" value={form.observations} onChange={(e) => setValue('observations', e.target.value)} /></Field></div>}
        {editing.step_key === 'incubation' && <div className="form-grid"><Field label="Código de incubadora"><input value={form.incubatorCode} onChange={(e) => setValue('incubatorCode', e.target.value)} required /></Field><Field label="Responsable"><select value={form.operatorUserId} onChange={(e) => setValue('operatorUserId', e.target.value)}>{data.operators.map((item) => <option value={item.id} key={item.id}>{item.full_name}</option>)}</select></Field><Field label="Temperatura (°C)"><input type="number" step="0.1" value={form.temperatureC} onChange={(e) => setValue('temperatureC', e.target.value)} required /></Field><Field label="Duración (horas)"><input type="number" step="0.5" value={form.durationHours} onChange={(e) => setValue('durationHours', e.target.value)} /></Field><Field label="Inicio"><input type="datetime-local" value={form.startedAt} onChange={(e) => setValue('startedAt', e.target.value)} required /></Field><Field label="Fin programado"><input type="datetime-local" value={form.endedAt} onChange={(e) => setValue('endedAt', e.target.value)} required /></Field><Field label="Atmósfera / condición"><input value={form.atmosphere} onChange={(e) => setValue('atmosphere', e.target.value)} /></Field><Field label="Posición / bandeja"><input value={form.positionReference} onChange={(e) => setValue('positionReference', e.target.value)} /></Field><Field label="Verificación de condición"><ResultSelect value={form.conditionResult} onChange={(e) => setValue('conditionResult', e.target.value)} allowNA={false} /></Field><Field label="Motivo y condición de incubación" wide><textarea rows="3" value={form.incubationPurpose} onChange={(e) => setValue('incubationPurpose', e.target.value)} required /></Field><Field label="Observaciones" wide><textarea rows="3" value={form.observations} onChange={(e) => setValue('observations', e.target.value)} /></Field></div>}
        {editing.step_key === 'reading' && <div className="form-grid"><Field label="Fecha de lectura"><input type="datetime-local" value={form.readingAt} onChange={(e) => setValue('readingAt', e.target.value)} required /></Field><Field label="Analista"><select value={form.analystId} onChange={(e) => setValue('analystId', e.target.value)} required><option value="">Seleccionar…</option>{(isAdmin ? (selectedService?.assigned_analysts || []) : data.analysts).map((item) => <option value={item.id} key={item.id}>{item.full_name}</option>)}</select></Field><Field label="Método de lectura"><input value={form.method} onChange={(e) => setValue('method', e.target.value)} required /></Field><Field label="Dilución"><input value={form.dilution} onChange={(e) => setValue('dilution', e.target.value)} /></Field><Field label="Unidades"><input value={form.units} onChange={(e) => setValue('units', e.target.value)} required /></Field><Field label="Resultado de revisión"><ResultSelect value={form.reviewResult} onChange={(e) => setValue('reviewResult', e.target.value)} allowNA={false} /></Field><Field label="Control positivo"><ResultSelect value={form.positiveControl} onChange={(e) => setValue('positiveControl', e.target.value)} /></Field><Field label="Control negativo"><ResultSelect value={form.negativeControl} onChange={(e) => setValue('negativeControl', e.target.value)} /></Field><Field label="Resultado y lectura" wide><textarea rows="4" value={form.resultSummary} onChange={(e) => setValue('resultSummary', e.target.value)} required /></Field><Field label="Observaciones" wide><textarea rows="3" value={form.observations} onChange={(e) => setValue('observations', e.target.value)} /></Field></div>}
        {editing.step_key === 'report' && <div className="micro-report-form"><label className={`final-report-drop ${form.report ? 'selected' : ''}`}><input type="file" accept="application/pdf,.pdf" onChange={chooseReport} /><IcoFile /><span><strong>{form.report ? form.report.fileName : 'Seleccionar informe final'}</strong><small>PDF validado de hasta 3 MB</small></span></label><div className="form-grid"><Field label="Fecha de emisión"><input type="datetime-local" value={form.issuedAt} onChange={(e) => setValue('issuedAt', e.target.value)} required /></Field><Field label="Nota de emisión" wide><textarea rows="3" value={form.notes} onChange={(e) => setValue('notes', e.target.value)} /></Field></div><div className="micro-client-publish-note"><IcoShield /><span><strong>Publicación al cliente</strong><small>Este PDF aparecerá en la trazabilidad y en Resultados.</small></span></div></div>}
        {error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancelar</button><button className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : editing.step_key === 'report' ? 'Publicar informe' : 'Guardar y completar etapa'}</button></div></form></div>}
    </div>
  )
}
