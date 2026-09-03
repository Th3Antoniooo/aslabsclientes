import { useEffect, useMemo, useState } from 'react'
import { api } from '../data/api.js'
import { IcoCheck, IcoFile, IcoFlask, IcoPlus, IcoShield, IcoUser } from '../components/Icons.jsx'

const indicatorOptions = [
  ['not_applicable', 'No aplica'], ['pending', 'Pendiente'], ['conforming', 'Conforme'], ['nonconforming', 'No conforme'],
]

const EQUIPMENT_LABELS = {
  autoclave: 'Autoclave', spectrophotometer: 'Espectrofotómetro', incubator: 'Incubadora',
  shaker_incubator: 'Shaker incubador', centrifuge: 'Centrífuga', oven: 'Horno', flow_cabinet: 'Cabina de flujo laminar',
}

function runForm(equipment = null, currentUserId = '') {
  const type = equipment?.equipment_type || 'autoclave'
  return {
    equipmentId: equipment?.id || '', serviceIds: [], workArea: 'laboratory', workTarget: '', quickStart: false, operatorUserId: currentUserId,
    materialDescription: '', storagePosition: '', observations: '',
    temperatureC: type === 'autoclave' ? '121' : type === 'oven' ? '105' : '',
    pressureBar: type === 'autoclave' ? '1.05' : '',
    durationMinutes: type === 'autoclave' ? '15' : '', rpm: '',
  }
}

function localInput(value = new Date()) {
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function displayDate(value) {
  return value ? new Date(value).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' }) : 'Sin registrar'
}

function cycleForm(record, currentUserId) {
  const now = new Date()
  const start = new Date(now.getTime() - 45 * 60000)
  return {
    id: record?.id || '', equipmentId: record?.equipment_id || '', serviceId: record?.service_id || '',
    loadType: record?.load_type || 'culture_media', loadDescription: record?.load_description || '',
    cycleNumber: record?.cycle_number || '', programName: record?.program_name || '',
    startedAt: localInput(record?.started_at || start), endedAt: localInput(record?.ended_at || now),
    temperatureC: record?.temperature_c || '121', pressureBar: record?.pressure_bar || '1.05',
    holdingMinutes: record?.holding_minutes ?? '15', operatorUserId: record?.operator_user_id || currentUserId,
    chemicalIndicator: record?.chemical_indicator || 'pending', biologicalIndicator: record?.biological_indicator || 'not_applicable',
    result: record?.result || 'pending', observations: record?.observations || '',
  }
}

function releaseForm(record, cycleId, currentUserId) {
  return {
    id: record?.id || '', cycleId: record?.cycle_id || cycleId || '', releasedAt: localInput(record?.released_at || new Date()),
    releasedByUserId: record?.released_by_user_id || currentUserId, materialCondition: record?.material_condition || '',
    packagingIntegrity: record?.packaging_integrity || 'conforming', chemicalIndicatorResult: record?.chemical_indicator_result || 'pending',
    biologicalIndicatorResult: record?.biological_indicator_result || 'not_applicable', releaseResult: record?.release_result || 'pending',
    observations: record?.observations || '',
  }
}

function nonconformityForm(record, cycleId, releaseId, currentUserId) {
  return {
    id: record?.id || '', cycleId: record?.cycle_id || cycleId || '', releaseId: record?.release_id || releaseId || '',
    detectedAt: localInput(record?.detected_at || new Date()), description: record?.description || '',
    immediateAction: record?.immediate_action || '', rootCause: record?.root_cause || '',
    correctiveAction: record?.corrective_action || '', responsibleUserId: record?.responsible_user_id || currentUserId,
    status: record?.status || 'open',
  }
}

function Field({ label, wide, children }) {
  return <label className={`field ${wide ? 'field-wide' : ''}`}><span>{label}</span>{children}</label>
}

function Status({ value, type }) {
  const labels = {
    conforming: 'Conforme', nonconforming: 'No conforme', pending: 'Pendiente',
    released: 'Liberado', rejected: 'Rechazado', open: 'Abierta', in_review: 'En revisión', closed: 'Cerrada',
    active: 'Operativo', maintenance: 'Mantenimiento', inactive: 'Inactivo',
  }
  const good = ['conforming', 'released', 'closed', 'active'].includes(value)
  const bad = ['nonconforming', 'rejected', 'open'].includes(value)
  return <span className={`lab-status ${good ? 'good' : bad ? 'bad' : type || 'pending'}`}><i />{labels[value] || value}</span>
}

function RecordActions({ type, record, onEdit, onRelease, onNonconformity }) {
  return (
    <div className="lab-record-actions">
      <a className="lab-pdf-link" href={`/api/services?labOperations=1&format=pdf&type=${type}&id=${record.id}`} target="_blank" rel="noreferrer"><IcoFile /> PDF</a>
      <button className="table-action" onClick={() => onEdit(record)}>Editar</button>
      {type === 'cycle' && !record.release_id && <button className="table-action accent" onClick={() => onRelease(record)}>Liberar</button>}
      {type === 'cycle' && <button className="table-action muted" onClick={() => onNonconformity(record)}>Reportar NC</button>}
    </div>
  )
}

export default function LabOperations({ user, notify }) {
  const quickWorker = Boolean(user.activeWorker?.codeCreatorOnly)
  const [data, setData] = useState({ equipment: [], services: [], operators: [], cycles: [], releases: [], nonconformities: [], equipmentRuns: [] })
  const [tab, setTab] = useState('live')
  const [dialog, setDialog] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const result = await api.equipmentOperations()
      const releaseByCycle = Object.fromEntries((result.releases || []).map((item) => [item.cycle_id, item]))
      setData({
        equipment: [], services: [], operators: [], releases: [], nonconformities: [], equipmentRuns: [],
        ...result,
        cycles: (result.cycles || []).map((cycle) => ({ ...cycle, release_id: releaseByCycle[cycle.id]?.id || null })),
      })
      setError('')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const stats = useMemo(() => ({
    equipment: data.equipment.filter((item) => item.status === 'active').length,
    pendingRelease: data.cycles.filter((cycle) => !cycle.release_id).length,
    openNc: data.nonconformities.filter((item) => item.status !== 'closed').length,
    today: data.cycles.filter((cycle) => new Date(cycle.started_at).toDateString() === new Date().toDateString()).length,
    running: data.equipmentRuns.filter((item) => item.status === 'running').length,
    overdue: data.equipmentRuns.filter((item) => item.overdue).length,
  }), [data])

  const openCycle = (record = null) => setDialog({ type: 'cycle', values: { ...cycleForm(record, user.id), equipmentId: record?.equipment_id || data.equipment.find((item) => item.status === 'active')?.id || '', serviceId: record?.service_id || data.services[0]?.id || '' } })
  const openRelease = (record = null, cycle = null) => setDialog({ type: 'release', values: releaseForm(record, cycle?.id, user.id) })
  const openNc = (record = null, cycle = null) => setDialog({ type: 'nonconformity', values: nonconformityForm(record, cycle?.id, record?.release_id, user.id) })
  const openEquipment = (record = null) => setDialog({ type: 'equipment', values: {
    id: record?.id || '', code: record?.code || '', name: record?.name || '', equipmentType: record?.equipment_type || 'autoclave',
    brand: record?.brand || '', model: record?.model || '', serialNumber: record?.serial_number || '', location: record?.location || '',
    status: record?.status || 'active', notes: record?.notes || '',
  } })
  const openRun = (equipment = null) => {
    const selected = equipment || data.equipment.find((item) => item.status === 'active') || null
    setDialog({ type: 'run', values: { ...runForm(selected, user.id), quickStart: quickWorker, workTarget: quickWorker ? 'biotechnology' : '' } })
    setError('')
  }

  const finishRun = async (record) => {
    setSaving(true); setError('')
    try {
      await api.updateEquipmentOperation({ action: 'finish_equipment_run', id: record.id })
      await load()
      notify(`${record.equipment_name} finalizado. La hora quedó registrada automáticamente.`)
    } catch (requestError) { setError(requestError.message) } finally { setSaving(false) }
  }

  const save = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (dialog.type === 'run') {
        const target = dialog.values.workTarget || ''
        const quickValues = quickWorker ? {
          quickStart: true,
          workArea: target === 'biotechnology' ? 'biotechnology' : 'laboratory',
          serviceIds: target.startsWith('order:') ? [target.slice(6)] : [],
        } : {}
        await api.createEquipmentOperation({ action: 'start_equipment_run', ...dialog.values, ...quickValues })
        setDialog(null)
        await load()
        notify('Uso iniciado. Hora y operador registrados automáticamente.')
        return
      }
      const actionType = dialog.type === 'nonconformity' ? 'nonconformity' : dialog.type
      const action = `${dialog.values.id ? 'update' : 'create'}_${actionType}`
      const payload = { action, ...dialog.values }
      if (dialog.values.id) await api.updateEquipmentOperation(payload)
      else await api.createEquipmentOperation(payload)
      setDialog(null)
      await load()
      notify(dialog.values.id ? 'Registro actualizado y trazabilidad conservada.' : 'Registro operativo creado y PDF habilitado.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  const setValue = (key, value) => setDialog((current) => ({ ...current, values: { ...current.values, [key]: value } }))
  const selectedCycle = dialog && ['release', 'nonconformity'].includes(dialog.type)
    ? data.cycles.find((cycle) => cycle.id === dialog.values.cycleId) : null
  const selectedEquipment = dialog?.type === 'run'
    ? data.equipment.find((item) => item.id === dialog.values.equipmentId) : null
  const availableReleaseCycles = data.cycles.filter((cycle) => !cycle.release_id || cycle.id === dialog?.values?.cycleId)

  return (
    <div className="lab-ops-page">
      <section className="lab-ops-hero anim-in d1">
        <div className="lab-ops-hero-copy">
          <span className="eyebrow">{quickWorker ? 'Registro rápido autorizado' : 'Control interno · equipos vinculados'}</span>
          <h1>{quickWorker ? 'Equipo, destino e iniciar.' : 'Uso de equipos'}</h1>
          <p>{quickWorker ? 'Solo tres pasos. El operador y la hora quedan registrados automáticamente.' : 'Inicia y finaliza cada operación con hora y responsable automáticos. Una misma carga puede quedar vinculada a varias órdenes.'}</p>
          <div className="lab-ops-actions">
            <button className="btn btn-accent" onClick={() => openRun()}><IcoPlus /> Iniciar uso de equipo</button>
            {user.role === 'admin' && <button className="btn btn-ghost" onClick={() => setTab('equipment')}><IcoFlask /> Gestionar equipos</button>}
          </div>
        </div>
        <div className="lab-ops-machine">
          <div className="machine-orbit"><span /><span /><span /></div>
          <div className="machine-icon"><IcoFlask /></div>
          <strong>{stats.running}</strong><span>equipos en uso ahora</span>
        </div>
      </section>

      {!quickWorker && <section className="lab-flow anim-in d2">
        <div className="lab-flow-title"><span>Flujo documental</span><small>Un expediente enlazado por servicio</small></div>
        <div className="lab-flow-step active"><b>01</b><div><strong>Autoclavado</strong><span>Parámetros y operador</span></div></div>
        <i className="lab-flow-line" />
        <div className="lab-flow-step"><b>02</b><div><strong>Liberación</strong><span>Verificación del material</span></div></div>
        <i className="lab-flow-line" />
        <div className="lab-flow-step optional"><b>03</b><div><strong>No conformidad</strong><span>Solo cuando corresponde</span></div></div>
      </section>}

      {!quickWorker && <div className="lab-stat-grid anim-in d2">
        <article><span className="lab-stat-icon"><IcoFlask /></span><div><strong>{stats.equipment}</strong><span>equipos operativos</span></div></article>
        <article><span className="lab-stat-icon amber"><IcoFile /></span><div><strong>{stats.running}</strong><span>usos en curso</span></div></article>
        <article><span className="lab-stat-icon"><IcoCheck /></span><div><strong>{data.equipmentRuns.filter((item) => new Date(item.started_at).toDateString() === new Date().toDateString()).length}</strong><span>registros de hoy</span></div></article>
        <article><span className="lab-stat-icon red"><IcoShield /></span><div><strong>{stats.overdue}</strong><span>alertas por tiempo excedido</span></div></article>
      </div>}

      <div className="lab-toolbar anim-in d3">
        <div className="segmented lab-tabs">
          <button className={tab === 'live' ? 'active' : ''} onClick={() => setTab('live')}>Uso en tiempo real <span>{data.equipmentRuns.length}</span></button>
          {user.role === 'admin' && <button className={tab === 'cycles' ? 'active' : ''} onClick={() => setTab('cycles')}>Formatos anteriores <span>{data.cycles.length}</span></button>}
          {user.role === 'admin' && <button className={tab === 'releases' ? 'active' : ''} onClick={() => setTab('releases')}>Liberaciones <span>{data.releases.length}</span></button>}
          {user.role === 'admin' && <button className={tab === 'nonconformities' ? 'active' : ''} onClick={() => setTab('nonconformities')}>No conformidades <span>{data.nonconformities.length}</span></button>}
          {user.role === 'admin' && <button className={tab === 'equipment' ? 'active' : ''} onClick={() => setTab('equipment')}>Equipos <span>{data.equipment.length}</span></button>}
        </div>
        {tab === 'live' && <button className="btn btn-primary" onClick={() => openRun()}><IcoPlus /> Iniciar equipo</button>}
        {tab === 'cycles' && <button className="btn btn-primary" onClick={() => openCycle()}><IcoPlus /> Nuevo ciclo</button>}
        {tab === 'releases' && <button className="btn btn-primary" onClick={() => openRelease()}><IcoPlus /> Nueva liberación</button>}
        {tab === 'nonconformities' && <button className="btn btn-primary" onClick={() => openNc()}><IcoPlus /> Reportar NC</button>}
        {tab === 'equipment' && user.role === 'admin' && <button className="btn btn-primary" onClick={() => openEquipment()}><IcoPlus /> Nuevo equipo</button>}
      </div>

      {error && !dialog && <div className="form-error">{error}</div>}
      {loading ? <div className="card lab-empty">Cargando operaciones…</div> : (
        <section className="card lab-records anim-in d3">
          {tab === 'live' && (data.equipmentRuns.length ? <div className="equipment-run-list">{data.equipmentRuns.map((record) => (
            <article className={`equipment-run-card ${record.status} ${record.overdue ? 'overdue' : ''}`} key={record.id}>
              <div className="equipment-run-main"><span className="lab-equipment-icon"><IcoFlask /></span><div><small>{record.record_code}</small><h3>{record.equipment_code} · {record.equipment_name}</h3><p>{record.material_description}</p></div></div>
              <div className="equipment-run-links"><span>{record.work_area === 'biotechnology' ? 'Área vinculada' : 'Órdenes vinculadas'}</span><div>{record.work_area === 'biotechnology' ? <b>BIOTECNOLOGÍA</b> : record.services.map((service) => <b key={service.id}>{service.code}</b>)}</div></div>
              <div className="equipment-run-timing"><span>Operador</span><strong>{record.operator_name}</strong><small>Inicio: {displayDate(record.started_at)}</small>{record.expected_end_at && <small>Fin previsto: {displayDate(record.expected_end_at)}</small>}</div>
              <div className="equipment-run-state">{record.overdue ? <Status value="nonconforming" /> : record.status === 'running' ? <Status value="pending" /> : <Status value="conforming" />}<small>{record.overdue ? 'Tiempo excedido' : record.status === 'running' ? 'En uso' : `Finalizado ${displayDate(record.ended_at)}`}</small></div>
              <div className="equipment-run-actions">{record.status === 'running' ? <button className="btn btn-primary" disabled={saving} onClick={() => finishRun(record)}><IcoCheck /> Terminar</button> : <a className="lab-pdf-link" href={`/api/services?labOperations=1&format=pdf&type=equipment-run&id=${record.id}`} target="_blank" rel="noreferrer"><IcoFile /> PDF de trazabilidad</a>}</div>
            </article>
          ))}</div> : <div className="lab-empty"><span><IcoFlask /></span><h2>Aún no hay usos registrados</h2><p>Elige un equipo, vincula una o varias órdenes y pulsa Iniciar.</p><button className="btn btn-primary" onClick={() => openRun()}><IcoPlus /> Iniciar primer equipo</button></div>)}

          {tab === 'cycles' && (data.cycles.length ? data.cycles.map((record) => (
            <article className="lab-record" key={record.id}>
              <div className="lab-record-code"><span><IcoFlask /></span><div><strong>{record.record_code}</strong><small>{record.equipment_code} · {record.cycle_number || 'Ciclo sin número'}</small></div></div>
              <div className="lab-record-service"><strong>{record.service_name}</strong><span>{record.service_code} · {record.client_name}</span><small>{record.load_description}</small></div>
              <div className="lab-record-params"><strong>{record.temperature_c} °C</strong><span>{record.pressure_bar} bar · {record.holding_minutes} min</span><small>{displayDate(record.started_at)}</small></div>
              <div><Status value={record.result} /><small className="lab-operator"><IcoUser /> {record.operator_name}</small></div>
              <RecordActions type="cycle" record={record} onEdit={openCycle} onRelease={(cycle) => openRelease(null, cycle)} onNonconformity={(cycle) => openNc(null, cycle)} />
            </article>
          )) : <div className="lab-empty"><span><IcoFlask /></span><h2>Aún no hay ciclos registrados</h2><p>El primer ciclo creará el formato de esterilización vinculado a un servicio.</p><button className="btn btn-primary" onClick={() => openCycle()}><IcoPlus /> Registrar primer ciclo</button></div>)}

          {tab === 'releases' && (data.releases.length ? data.releases.map((record) => (
            <article className="lab-record" key={record.id}>
              <div className="lab-record-code"><span className="released"><IcoCheck /></span><div><strong>{record.record_code}</strong><small>Origen: {record.cycle_record_code}</small></div></div>
              <div className="lab-record-service"><strong>{record.service_name}</strong><span>{record.service_code} · {record.client_name}</span><small>{record.material_condition}</small></div>
              <div className="lab-record-params"><strong>{displayDate(record.released_at)}</strong><span>{record.equipment_code}</span><small>{record.released_by_name}</small></div>
              <Status value={record.release_result} />
              <RecordActions type="release" record={record} onEdit={(item) => openRelease(item)} />
            </article>
          )) : <div className="lab-empty"><span><IcoCheck /></span><h2>No hay liberaciones</h2><p>Cuando termine un autoclavado, verifica el material y genera su formato de liberación.</p></div>)}

          {tab === 'nonconformities' && (data.nonconformities.length ? data.nonconformities.map((record) => (
            <article className="lab-record nc" key={record.id}>
              <div className="lab-record-code"><span className="nc"><IcoShield /></span><div><strong>{record.record_code}</strong><small>{record.cycle_record_code}</small></div></div>
              <div className="lab-record-service"><strong>{record.service_name}</strong><span>{record.service_code} · {record.client_name}</span><small>{record.description}</small></div>
              <div className="lab-record-params"><strong>{displayDate(record.detected_at)}</strong><span>Responsable: {record.responsible_name}</span><small>{record.immediate_action}</small></div>
              <Status value={record.status} />
              <RecordActions type="nonconformity" record={record} onEdit={(item) => openNc(item)} />
            </article>
          )) : <div className="lab-empty clean"><span><IcoShield /></span><h2>Sin no conformidades registradas</h2><p>Este tercer documento es opcional y solo se crea cuando existe una desviación.</p></div>)}

          {tab === 'equipment' && data.equipment.map((record) => (
            <article className="lab-equipment-row" key={record.id}>
              <span className="lab-equipment-icon"><IcoFlask /></span>
              <div><strong>{record.code} · {record.name}</strong><span>{record.location || 'Ubicación por definir'}</span></div>
              <div><small>Tipo</small><strong>{EQUIPMENT_LABELS[record.equipment_type] || record.equipment_type}</strong></div>
              <div><small>Identificación</small><strong>{[record.brand, record.model, record.serial_number].filter(Boolean).join(' · ') || 'Por completar'}</strong></div>
              <Status value={record.status} />
              {user.role === 'admin' && <button className="table-action" onClick={() => openEquipment(record)}>Editar ficha</button>}
            </article>
          ))}
        </section>
      )}

      {dialog && (
        <div className="modal-overlay" onClick={() => setDialog(null)}>
          <form className="modal lab-modal" onSubmit={save} onClick={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <span className={`modal-icon ${dialog.type === 'nonconformity' ? 'danger' : ''}`}>
                {dialog.type === 'nonconformity' ? <IcoShield /> : dialog.type === 'release' ? <IcoCheck /> : <IcoFlask />}
              </span>
              <div><span className="eyebrow">Trazabilidad interna</span><h2>{dialog.type === 'run' ? 'Iniciar uso de equipo' : `${dialog.values.id ? 'Editar' : 'Registrar'} ${dialog.type === 'cycle' ? 'autoclavado' : dialog.type === 'release' ? 'liberación de material' : dialog.type === 'nonconformity' ? 'no conformidad' : 'equipo'}`}</h2><p>{dialog.type === 'run' ? 'La hora y el operador se registrarán automáticamente al pulsar Iniciar.' : 'El registro quedará vinculado al expediente del servicio y tendrá su propio PDF.'}</p></div>
            </div>

            {dialog.type === 'run' && quickWorker && <div className="equipment-quick-start">
              <label><b>1</b><span><strong>Seleccionar equipo</strong><select value={dialog.values.equipmentId} onChange={(event) => { const equipment = data.equipment.find((item) => item.id === event.target.value); setDialog({ type: 'run', values: { ...runForm(equipment, user.id), quickStart: true, workTarget: dialog.values.workTarget || 'biotechnology' } }) }} required><option value="">Seleccionar equipo…</option>{data.equipment.filter((item) => item.status === 'active').map((item) => <option value={item.id} key={item.id}>{item.code} · {item.name}</option>)}</select></span></label>
              <label><b>2</b><span><strong>Seleccionar Orden o Biotecnología</strong><select value={dialog.values.workTarget} onChange={(event) => setValue('workTarget', event.target.value)} required><option value="">Seleccionar destino…</option><option value="biotechnology">Biotecnología · plantas y esterilización</option>{data.services.filter((service) => ['accepted','in_progress'].includes(service.status)).map((service) => <option value={`order:${service.id}`} key={service.id}>Orden {service.code}</option>)}</select></span></label>
              <div className="equipment-quick-confirm"><b>3</b><span><strong>Iniciar</strong><small>La hora y el operador se guardan automáticamente.</small></span><IcoCheck /></div>
            </div>}

            {dialog.type === 'run' && !quickWorker && <div className="equipment-run-form">
              <div className="form-grid">
                <Field label="Equipo" wide><select value={dialog.values.equipmentId} onChange={(event) => { const equipment = data.equipment.find((item) => item.id === event.target.value); setDialog({ type: 'run', values: { ...runForm(equipment, user.id), serviceIds: dialog.values.serviceIds } }) }} required><option value="">Seleccionar equipo…</option>{data.equipment.filter((item) => item.status === 'active').map((item) => <option value={item.id} key={item.id}>{item.code} · {item.name} · {EQUIPMENT_LABELS[item.equipment_type]}</option>)}</select></Field>
              </div>
              <section className="equipment-service-picker"><header><div><strong>Órdenes activas incluidas</strong><span>Puedes agregar material de varias órdenes asignadas en el mismo uso.</span></div><b>{dialog.values.serviceIds.length}</b></header><div>{data.services.filter((service) => ['accepted','in_progress'].includes(service.status)).map((service) => { const checked = dialog.values.serviceIds.includes(service.id); return <label className={checked ? 'selected' : ''} key={service.id}><input type="checkbox" checked={checked} onChange={() => setValue('serviceIds', checked ? dialog.values.serviceIds.filter((id) => id !== service.id) : [...dialog.values.serviceIds, service.id])} /><span>{service.code}</span><div><strong>{service.name}</strong><small>{service.items?.map((item) => item.name).slice(0,2).join(' · ')}</small></div><i>{checked ? <IcoCheck /> : '+'}</i></label> })}</div></section>
              {selectedEquipment && selectedEquipment.equipment_type !== 'flow_cabinet' && <div className="form-grid">
                <Field label="Qué se coloca / qué se analiza" wide><textarea rows="3" value={dialog.values.materialDescription} onChange={(e) => setValue('materialDescription', e.target.value)} placeholder="Material, muestra, medio, cantidad o carga…" required /></Field>
                {['autoclave','incubator','shaker_incubator','oven'].includes(selectedEquipment.equipment_type) && <Field label="Temperatura (°C)"><input type="number" step="0.1" value={dialog.values.temperatureC} onChange={(e) => setValue('temperatureC', e.target.value)} required={['autoclave','oven'].includes(selectedEquipment.equipment_type)} placeholder={selectedEquipment.equipment_type.includes('incubator') ? 'Según método' : ''} /></Field>}
                {selectedEquipment.equipment_type === 'autoclave' && <Field label="Presión (bar)"><input type="number" step="0.01" value={dialog.values.pressureBar} onChange={(e) => setValue('pressureBar', e.target.value)} required /></Field>}
                {['autoclave','incubator','shaker_incubator','centrifuge','oven'].includes(selectedEquipment.equipment_type) && <Field label="Tiempo previsto (opcional)"><input type="number" min="1" max="43200" value={dialog.values.durationMinutes} onChange={(e) => setValue('durationMinutes', e.target.value)} placeholder="El tiempo real se registra al terminar" /></Field>}
                {['shaker_incubator','centrifuge'].includes(selectedEquipment.equipment_type) && <Field label="RPM"><input type="number" min="1" value={dialog.values.rpm} onChange={(e) => setValue('rpm', e.target.value)} required /></Field>}
                {['incubator','shaker_incubator'].includes(selectedEquipment.equipment_type) && <Field label="Ubicación interna"><input value={dialog.values.storagePosition} onChange={(e) => setValue('storagePosition', e.target.value)} placeholder="Bandeja, nivel o posición" required /></Field>}
                {user.role === 'admin' && <Field label="Operador"><select value={dialog.values.operatorUserId} onChange={(e) => setValue('operatorUserId', e.target.value)}>{data.operators.map((item) => <option value={item.id} key={item.id}>{item.full_name}</option>)}</select></Field>}
                <Field label="Observaciones" wide><textarea rows="3" value={dialog.values.observations} onChange={(e) => setValue('observations', e.target.value)} placeholder="Método, condición especial o incidencia inicial…" /></Field>
              </div>}
              {selectedEquipment?.equipment_type === 'flow_cabinet' && <div className="equipment-quick-note"><IcoCheck /><div><strong>Registro rápido</strong><span>Para cabinas solo se guardarán equipo, órdenes, operador, inicio y final.</span></div></div>}
            </div>}

            {dialog.type === 'cycle' && <div className="form-grid">
              <Field label="Equipo"><select value={dialog.values.equipmentId} onChange={(e) => setValue('equipmentId', e.target.value)} required>{data.equipment.filter((item) => item.status === 'active' || item.id === dialog.values.equipmentId).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></Field>
              <Field label="Servicio vinculado"><select value={dialog.values.serviceId} onChange={(e) => setValue('serviceId', e.target.value)} required>{data.services.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name} · {item.client_name}</option>)}</select></Field>
              <Field label="Tipo de carga"><select value={dialog.values.loadType} onChange={(e) => setValue('loadType', e.target.value)}><option value="culture_media">Medios de cultivo</option><option value="material">Material</option><option value="mixed">Carga mixta</option></select></Field>
              <Field label="Operador"><select value={dialog.values.operatorUserId} onChange={(e) => setValue('operatorUserId', e.target.value)} required>{data.operators.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select></Field>
              <Field label="Número de ciclo"><input value={dialog.values.cycleNumber} onChange={(e) => setValue('cycleNumber', e.target.value)} placeholder="Ej. C-024" /></Field>
              <Field label="Programa"><input value={dialog.values.programName} onChange={(e) => setValue('programName', e.target.value)} placeholder="Ej. Líquidos 121 °C" /></Field>
              <Field label="Inicio"><input type="datetime-local" value={dialog.values.startedAt} onChange={(e) => setValue('startedAt', e.target.value)} required /></Field>
              <Field label="Fin"><input type="datetime-local" value={dialog.values.endedAt} onChange={(e) => setValue('endedAt', e.target.value)} required /></Field>
              <Field label="Temperatura (°C)"><input type="number" step="0.01" value={dialog.values.temperatureC} onChange={(e) => setValue('temperatureC', e.target.value)} required /></Field>
              <Field label="Presión (bar)"><input type="number" step="0.001" value={dialog.values.pressureBar} onChange={(e) => setValue('pressureBar', e.target.value)} required /></Field>
              <Field label="Tiempo de sostén (min)"><input type="number" min="0" value={dialog.values.holdingMinutes} onChange={(e) => setValue('holdingMinutes', e.target.value)} required /></Field>
              <Field label="Resultado"><select value={dialog.values.result} onChange={(e) => setValue('result', e.target.value)}><option value="pending">Pendiente</option><option value="conforming">Conforme</option><option value="nonconforming">No conforme</option></select></Field>
              <Field label="Indicador químico"><select value={dialog.values.chemicalIndicator} onChange={(e) => setValue('chemicalIndicator', e.target.value)}>{indicatorOptions.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></Field>
              <Field label="Indicador biológico"><select value={dialog.values.biologicalIndicator} onChange={(e) => setValue('biologicalIndicator', e.target.value)}>{indicatorOptions.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></Field>
              <Field label="Descripción de la carga" wide><textarea rows="3" value={dialog.values.loadDescription} onChange={(e) => setValue('loadDescription', e.target.value)} placeholder="Medios, material, cantidades y presentación" required /></Field>
              <Field label="Observaciones" wide><textarea rows="3" value={dialog.values.observations} onChange={(e) => setValue('observations', e.target.value)} /></Field>
            </div>}

            {dialog.type === 'release' && <div className="form-grid">
              <Field label="Ciclo de autoclavado" wide><select value={dialog.values.cycleId} onChange={(e) => setValue('cycleId', e.target.value)} required><option value="">Seleccionar ciclo…</option>{availableReleaseCycles.map((item) => <option key={item.id} value={item.id}>{item.record_code} · {item.service_name} · {item.load_description}</option>)}</select></Field>
              {selectedCycle && <div className="lab-linked-summary field-wide"><IcoFlask /><div><strong>{selectedCycle.service_name}</strong><span>{selectedCycle.equipment_code} · {selectedCycle.temperature_c} °C · {selectedCycle.operator_name}</span></div></div>}
              <Field label="Fecha y hora de liberación"><input type="datetime-local" value={dialog.values.releasedAt} onChange={(e) => setValue('releasedAt', e.target.value)} required /></Field>
              <Field label="Responsable"><select value={dialog.values.releasedByUserId} onChange={(e) => setValue('releasedByUserId', e.target.value)} required>{data.operators.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select></Field>
              <Field label="Integridad del empaque"><select value={dialog.values.packagingIntegrity} onChange={(e) => setValue('packagingIntegrity', e.target.value)}><option value="conforming">Conforme</option><option value="nonconforming">No conforme</option><option value="not_applicable">No aplica</option></select></Field>
              <Field label="Resultado de liberación"><select value={dialog.values.releaseResult} onChange={(e) => setValue('releaseResult', e.target.value)}><option value="pending">Pendiente</option><option value="released">Liberado</option><option value="rejected">Rechazado</option></select></Field>
              <Field label="Indicador químico"><select value={dialog.values.chemicalIndicatorResult} onChange={(e) => setValue('chemicalIndicatorResult', e.target.value)}>{indicatorOptions.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></Field>
              <Field label="Indicador biológico"><select value={dialog.values.biologicalIndicatorResult} onChange={(e) => setValue('biologicalIndicatorResult', e.target.value)}>{indicatorOptions.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></Field>
              <Field label="Condición del material" wide><textarea rows="3" value={dialog.values.materialCondition} onChange={(e) => setValue('materialCondition', e.target.value)} placeholder="Seco, íntegro, identificado, sin alteraciones…" required /></Field>
              <Field label="Observaciones" wide><textarea rows="3" value={dialog.values.observations} onChange={(e) => setValue('observations', e.target.value)} /></Field>
            </div>}

            {dialog.type === 'nonconformity' && <div className="form-grid">
              <Field label="Ciclo de autoclavado" wide><select value={dialog.values.cycleId} onChange={(e) => { setValue('cycleId', e.target.value); const release = data.releases.find((item) => item.cycle_id === e.target.value); setTimeout(() => setValue('releaseId', release?.id || ''), 0) }} required><option value="">Seleccionar ciclo…</option>{data.cycles.map((item) => <option key={item.id} value={item.id}>{item.record_code} · {item.service_name}</option>)}</select></Field>
              <Field label="Liberación vinculada"><select value={dialog.values.releaseId} onChange={(e) => setValue('releaseId', e.target.value)}><option value="">No aplica</option>{data.releases.filter((item) => item.cycle_id === dialog.values.cycleId).map((item) => <option key={item.id} value={item.id}>{item.record_code}</option>)}</select></Field>
              <Field label="Fecha de detección"><input type="datetime-local" value={dialog.values.detectedAt} onChange={(e) => setValue('detectedAt', e.target.value)} required /></Field>
              <Field label="Responsable"><select value={dialog.values.responsibleUserId} onChange={(e) => setValue('responsibleUserId', e.target.value)} required>{data.operators.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select></Field>
              <Field label="Estado"><select value={dialog.values.status} onChange={(e) => setValue('status', e.target.value)}><option value="open">Abierta</option><option value="in_review">En revisión</option><option value="closed">Cerrada</option></select></Field>
              <Field label="Descripción" wide><textarea rows="3" value={dialog.values.description} onChange={(e) => setValue('description', e.target.value)} required /></Field>
              <Field label="Acción inmediata" wide><textarea rows="3" value={dialog.values.immediateAction} onChange={(e) => setValue('immediateAction', e.target.value)} required /></Field>
              <Field label="Causa raíz" wide><textarea rows="3" value={dialog.values.rootCause} onChange={(e) => setValue('rootCause', e.target.value)} /></Field>
              <Field label="Acción correctiva" wide><textarea rows="3" value={dialog.values.correctiveAction} onChange={(e) => setValue('correctiveAction', e.target.value)} /></Field>
            </div>}

            {dialog.type === 'equipment' && <div className="form-grid">
              <Field label="Código"><input value={dialog.values.code} onChange={(e) => setValue('code', e.target.value)} placeholder="AUT-002" required /></Field>
              <Field label="Nombre"><input value={dialog.values.name} onChange={(e) => setValue('name', e.target.value)} required /></Field>
              <Field label="Tipo"><select value={dialog.values.equipmentType} onChange={(e) => setValue('equipmentType', e.target.value)}>{Object.entries(EQUIPMENT_LABELS).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
              <Field label="Estado"><select value={dialog.values.status} onChange={(e) => setValue('status', e.target.value)}><option value="active">Operativo</option><option value="maintenance">Mantenimiento</option><option value="inactive">Inactivo</option></select></Field>
              <Field label="Marca"><input value={dialog.values.brand} onChange={(e) => setValue('brand', e.target.value)} /></Field>
              <Field label="Modelo"><input value={dialog.values.model} onChange={(e) => setValue('model', e.target.value)} /></Field>
              <Field label="Número de serie"><input value={dialog.values.serialNumber} onChange={(e) => setValue('serialNumber', e.target.value)} /></Field>
              <Field label="Ubicación"><input value={dialog.values.location} onChange={(e) => setValue('location', e.target.value)} /></Field>
              <Field label="Notas" wide><textarea rows="3" value={dialog.values.notes} onChange={(e) => setValue('notes', e.target.value)} /></Field>
            </div>}

            {error && <div className="form-error">{error}</div>}
            <div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={() => setDialog(null)}>Cancelar</button><button className="btn btn-primary" disabled={saving || (dialog.type === 'run' && (!dialog.values.equipmentId || (quickWorker ? !dialog.values.workTarget : !dialog.values.serviceIds.length)))}>{saving ? 'Guardando…' : dialog.type === 'run' ? 'Iniciar ahora' : dialog.values.id ? 'Guardar cambios' : 'Crear registro'}</button></div>
          </form>
        </div>
      )}
    </div>
  )
}
