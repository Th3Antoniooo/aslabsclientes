import { useEffect, useMemo, useState } from 'react'
import { IcoCheck, IcoFlask, IcoShield, IcoUsers } from './Icons.jsx'
import { api } from '../data/api.js'

const normalize = (value = '') => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const SAMPLE_MODES = [
  ['client_delivery', 'Entrega en laboratorio'],
  ['aslabs_collection', 'Recojo de muestra'],
  ['aslabs_sampling', 'Muestreo en campo'],
  ['none', 'No requiere muestra'],
]
const localDateTimeInput = (value) => {
  if (!value) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

export default function ServiceEditModal({ service, canAssignAnalysts, analysts, notify, onClose, onSaved }) {
  const [catalog, setCatalog] = useState([])
  const [clients, setClients] = useState([])
  const [sites, setSites] = useState([])
  const [zones, setZones] = useState([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    clientUserId: service.client_user_id,
    displayName: service.display_name || service.service_type_name || '',
    serviceTypeIds: (service.service_items || []).map((item) => item.catalogServiceId),
    samplingSiteId: service.sampling_site_id || '',
    zoneId: service.zone_id || '',
    zoneName: service.zone_name || '',
    sampleCount: service.sample_count || 1,
    priority: service.priority || 'estandar',
    quoteReference: service.quote_reference || '',
    sampleIntakeMode: service.sample_intake_mode || 'client_delivery',
    sampleIntakeScheduledAt: localDateTimeInput(service.sample_intake_scheduled_at),
    notes: service.notes || '',
    status: service.status || 'accepted',
    analystIds: (service.assigned_analysts || []).map((analyst) => analyst.id),
  })

  useEffect(() => {
    Promise.all([api.serviceCatalog(), api.users(), api.tracking(), api.zones()])
      .then(([catalogResult, userResult, trackingResult, zoneResult]) => {
        setCatalog(catalogResult.catalog || [])
        setClients((userResult.users || []).filter((account) => account.role_slug === 'client' && account.status === 'active'))
        setSites((trackingResult.sites || []).filter((site) => site.site_type === 'sampling' && site.active !== false))
        setZones(zoneResult.zones || [])
      })
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false))
  }, [])

  const categories = useMemo(() => {
    const result = new Map()
    catalog.forEach((item) => {
      if (!result.has(item.category_id)) result.set(item.category_id, { id: item.category_id, name: item.category_name, icon: item.icon, count: 0 })
      result.get(item.category_id).count += 1
    })
    return [...result.values()]
  }, [catalog])

  const visibleCatalog = useMemo(() => {
    const term = normalize(search.trim())
    return catalog.filter((item) => (category === 'all' || item.category_id === category)
      && (!term || normalize(`${item.name} ${item.category_name} ${item.group_name || ''} ${item.description || ''}`).includes(term)))
  }, [catalog, category, search])

  const selectedItems = catalog.filter((item) => form.serviceTypeIds.includes(item.id))
  const availableSites = sites.filter((site) => site.client_user_id === form.clientUserId)
  const availableZones = zones.filter((item) => item.client_user_id === form.clientUserId)

  const toggleAnalysis = (id) => setForm((current) => ({
    ...current,
    serviceTypeIds: current.serviceTypeIds.includes(id)
      ? current.serviceTypeIds.filter((item) => item !== id)
      : current.serviceTypeIds.length < 60 ? [...current.serviceTypeIds, id] : current.serviceTypeIds,
  }))

  const toggleAnalyst = (id) => setForm((current) => ({
    ...current,
    analystIds: current.analystIds.includes(id)
      ? current.analystIds.filter((item) => item !== id)
      : [...current.analystIds, id],
  }))

  const save = async (event) => {
    event.preventDefault()
    if (!form.serviceTypeIds.length) return setError('La orden debe conservar al menos un análisis.')
    setSaving(true)
    setError('')
    try {
      await api.editService(service.id, {
        ...form,
        sampleCount: Number(form.sampleCount),
        analystIds: canAssignAnalysts ? form.analystIds : undefined,
        samplingSiteId: form.samplingSiteId || null,
        sampleIntakeScheduledAt: form.sampleIntakeMode !== 'none' && form.sampleIntakeScheduledAt ? new Date(form.sampleIntakeScheduledAt).toISOString() : null,
      })
      await onSaved()
      notify('Orden actualizada. Se conservaron etapas, PDFs, historial y operaciones vinculadas.')
      onClose()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  return <div className="modal-overlay service-edit-overlay" onClick={onClose}>
    <form className="modal service-edit-modal" onSubmit={save} onClick={(event) => event.stopPropagation()}>
      <header className="service-edit-head">
        <div className="service-edit-head-icon"><IcoFlask /></div>
        <div><span className="eyebrow">{service.code} · expediente vinculado</span><h2>Editar orden completa</h2><p>Cambia cliente, alcance, ubicación y responsables sin borrar la trazabilidad existente.</p></div>
        <button type="button" className="modal-close" onClick={onClose}>×</button>
      </header>

      {loading ? <div className="service-edit-loading">Preparando la orden…</div> : <div className="service-edit-body">
        <section className="service-edit-section">
          <div className="service-edit-section-title"><span>01</span><div><h3>Datos de la orden</h3><p>Identificación administrativa y estado general.</p></div></div>
          <div className="form-grid">
            <label className="field"><span>Cliente</span><select value={form.clientUserId} onChange={(event) => setForm({ ...form, clientUserId: event.target.value, samplingSiteId: '', zoneId: '', zoneName: '' })} required>{clients.map((client) => <option value={client.id} key={client.id}>{client.full_name} · {client.company}</option>)}</select></label>
            <label className="field"><span>Estado</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="pending">Pendiente</option><option value="accepted">Aceptado</option><option value="in_progress">En proceso</option><option value="completed">Completado</option><option value="rejected">Rechazado</option></select></label>
            <label className="field field-wide"><span>Nombre visible del servicio</span><input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} maxLength="120" placeholder="Nombre operativo visible para el cliente" /></label>
            <label className="field"><span>Referencia de cotización</span><input value={form.quoteReference} onChange={(event) => setForm({ ...form, quoteReference: event.target.value })} required /></label>
            <label className="field"><span>Prioridad</span><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}><option value="estandar">Estándar</option><option value="rapida">Rápida</option><option value="urgente">Urgente</option></select></label>
          </div>
        </section>

        <section className="service-edit-section service-edit-scope">
          <div className="service-edit-section-title"><span>02</span><div><h3>Alcance solicitado</h3><p>Una orden puede incluir varios análisis, incluso de familias distintas.</p></div><strong>{form.serviceTypeIds.length}</strong></div>
          <div className="service-edit-selected">
            {selectedItems.map((item) => <button type="button" key={item.id} onClick={() => toggleAnalysis(item.id)}><span>{item.name}</span><small>{item.category_name}</small><b>×</b></button>)}
          </div>
          <div className="service-edit-catalog-tools">
            <label><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar análisis, parámetro o familia…" /></label>
            <div><button type="button" className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>Todos</button>{categories.map((item) => <button type="button" className={category === item.id ? 'active' : ''} key={item.id} onClick={() => setCategory(item.id)}>{item.icon} {item.name}</button>)}</div>
          </div>
          <div className="service-edit-catalog">
            {visibleCatalog.map((item) => {
              const selected = form.serviceTypeIds.includes(item.id)
              return <button type="button" className={selected ? 'selected' : ''} key={item.id} onClick={() => toggleAnalysis(item.id)}><span>{item.icon || '◌'}</span><div><strong>{item.name}</strong><small>{item.category_name}{item.group_name ? ` · ${item.group_name}` : ''}</small></div><i>{selected ? <IcoCheck /> : '+'}</i></button>
            })}
          </div>
        </section>

        <section className="service-edit-section">
          <div className="service-edit-section-title"><span>03</span><div><h3>Muestras y ubicación</h3><p>La sede se filtra automáticamente según el cliente.</p></div></div>
          <div className="form-grid">
            <label className="field"><span>Número de muestras</span><input type="number" min="1" max="500" value={form.sampleCount} onChange={(event) => setForm({ ...form, sampleCount: event.target.value })} required /></label>
            <label className="field"><span>Gestión de muestra</span><select value={form.sampleIntakeMode} onChange={(event) => setForm({ ...form, sampleIntakeMode: event.target.value, sampleIntakeScheduledAt: event.target.value === 'none' ? '' : form.sampleIntakeScheduledAt })}>{SAMPLE_MODES.map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label className="field"><span>Zona delimitada</span><select value={form.zoneId} onChange={(event) => { const zone = zones.find((item) => item.id === event.target.value); setForm({ ...form, zoneId: event.target.value, samplingSiteId: '', zoneName: zone?.name || form.zoneName }) }}><option value="">Sin zona delimitada</option>{availableZones.map((zone) => <option value={zone.id} key={zone.id}>{zone.name}</option>)}</select></label>
            <label className="field"><span>Sede de muestreo</span><select value={form.samplingSiteId} onChange={(event) => { const site = sites.find((item) => item.id === event.target.value); setForm({ ...form, samplingSiteId: event.target.value, zoneId: '', zoneName: site?.name || form.zoneName }) }}><option value="">Coordenada o ubicación libre</option>{availableSites.map((site) => <option value={site.id} key={site.id}>{site.name}</option>)}</select></label>
            <label className="field field-wide"><span>Zona o ubicación</span><input value={form.zoneName} onChange={(event) => setForm({ ...form, zoneName: event.target.value, samplingSiteId: '', zoneId: '' })} required /></label>
            {form.sampleIntakeMode !== 'none' && <label className="field field-wide sample-schedule-field"><span>{form.sampleIntakeMode === 'aslabs_sampling' ? 'Fecha y hora del muestreo' : form.sampleIntakeMode === 'aslabs_collection' ? 'Fecha y hora del recojo' : 'Fecha y hora de entrega de muestra'}</span><input type="datetime-local" value={form.sampleIntakeScheduledAt} onChange={(event) => setForm({ ...form, sampleIntakeScheduledAt: event.target.value })} /><small>Opcional · controla el recordatorio visible hasta que se registre la muestra.</small></label>}
            <label className="field field-wide"><span>Notas e instrucciones</span><textarea rows="3" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Condiciones de la muestra, método, alcance o indicaciones…" /></label>
          </div>
        </section>

        {canAssignAnalysts && <section className="service-edit-section">
          <div className="service-edit-section-title"><span>04</span><div><h3>Equipo autorizado</h3><p>Cualquiera de los seleccionados podrá intervenir en todas las etapas.</p></div><strong>{form.analystIds.length}</strong></div>
          <div className="service-analyst-grid">{analysts.map((analyst) => {
            const selected = form.analystIds.includes(analyst.id)
            return <label className={selected ? 'selected' : ''} key={analyst.id}><input type="checkbox" checked={selected} onChange={() => toggleAnalyst(analyst.id)} /><span>{analyst.full_name.split(/\s+/).slice(0,2).map((part) => part[0]).join('')}</span><div><strong>{analyst.full_name}</strong><small>{analyst.specialty || 'Operaciones de laboratorio'}</small></div><i>{selected ? <IcoCheck /> : '+'}</i></label>
          })}</div>
        </section>}

        <div className="service-edit-preserve"><IcoShield /><div><strong>Edición no destructiva</strong><span>Los PDFs, fotos, etapas, informes, cuadrillas y operaciones ya registradas no se eliminan.</span></div></div>
      </div>}

      {error && <div className="form-error service-edit-error">{error}</div>}
      <footer className="service-edit-actions"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={loading || saving || !form.serviceTypeIds.length}><IcoUsers /> {saving ? 'Guardando cambios…' : 'Guardar orden completa'}</button></footer>
    </form>
  </div>
}
