import { useEffect, useMemo, useState } from 'react'
import { IcoArrow, IcoCheck } from '../components/Icons.jsx'
import { api } from '../data/api.js'

const STEPS = ['Servicio', 'Sede', 'Detalles', 'Confirmar']
const MAX_ANALYSES = 60
const SAMPLE_MODES = [
  { id: 'client_delivery', title: 'Entrega en laboratorio', text: 'El cliente entregará la muestra.' },
  { id: 'aslabs_collection', title: 'Recojo de muestra', text: 'AS Labs recogerá una muestra ya preparada.' },
  { id: 'aslabs_sampling', title: 'Muestreo en campo', text: 'AS Labs realizará directamente la toma de muestra.' },
  { id: 'none', title: 'No requiere muestra', text: 'La orden continúa sin recojo, entrega ni muestreo.' },
]
const normalizeText = (value = '') => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export default function NuevaOrden({ go, notify, user }) {
  const isAdmin = user.role === 'admin'
  const [step, setStep] = useState(0)
  const [catalog, setCatalog] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [catalogSearch, setCatalogSearch] = useState('')
  const [catalogCategoryFilter, setCatalogCategoryFilter] = useState('all')
  const [catalogGroupFilter, setCatalogGroupFilter] = useState('all')
  const [sites, setSites] = useState([])
  const [samplingSiteId, setSamplingSiteId] = useState('')
  const [zones, setZones] = useState([])
  const [zoneId, setZoneId] = useState('')
  const [zona, setZona] = useState('')
  const [muestras, setMuestras] = useState(4)
  const [prioridad, setPrioridad] = useState('estandar')
  const [notas, setNotas] = useState('')
  const [quoteReference, setQuoteReference] = useState('')
  const [sampleIntakeScheduledAt, setSampleIntakeScheduledAt] = useState('')
  const [sampleIntakeMode, setSampleIntakeMode] = useState('client_delivery')
  const [clients, setClients] = useState([])
  const [clientUserId, setClientUserId] = useState('')
  const [analysts, setAnalysts] = useState([])
  const [selectedAnalystIds, setSelectedAnalystIds] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const selectedItems = useMemo(
    () => catalog.filter((item) => selectedIds.includes(item.id)),
    [catalog, selectedIds],
  )
  const catalogCategories = useMemo(() => {
    const values = new Map()
    catalog.forEach((item) => {
      if (item.category_id && !values.has(item.category_id)) values.set(item.category_id, item.category_name)
    })
    return Array.from(values, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }, [catalog])
  const catalogGroups = useMemo(() => {
    const values = new Set(
      catalog
        .filter((item) => catalogCategoryFilter === 'all' || item.category_id === catalogCategoryFilter)
        .map((item) => item.group_name)
        .filter(Boolean),
    )
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'es'))
  }, [catalog, catalogCategoryFilter])
  const visibleServices = useMemo(() => {
    const search = normalizeText(catalogSearch.trim())
    return catalog
      .filter((item) => {
        const searchable = normalizeText(`${item.name} ${item.category_name || ''} ${item.description || ''} ${item.matrix_scope || ''} ${item.group_name || ''}`)
        const matchesCategory = catalogCategoryFilter === 'all' || item.category_id === catalogCategoryFilter
        const matchesGroup = catalogGroupFilter === 'all' || item.group_name === catalogGroupFilter
        return matchesCategory && matchesGroup && (!search || searchable.includes(search))
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }, [catalog, catalogSearch, catalogCategoryFilter, catalogGroupFilter])
  const availableSites = sites.filter((site) => (
    site.site_type === 'sampling'
      && (!isAdmin || !clientUserId || site.client_user_id === clientUserId)
  ))
  const availableZones = zones.filter((item) => !isAdmin || !clientUserId || item.client_user_id === clientUserId)

  useEffect(() => {
    api.serviceCatalog()
      .then((result) => {
        setCatalog(result.catalog)
      })
      .catch((requestError) => setError(requestError.message))
    api.tracking()
      .then((result) => setSites(result.sites || []))
      .catch(() => setSites([]))
    api.zones()
      .then((result) => setZones(result.zones || []))
      .catch(() => setZones([]))
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    Promise.all([api.users(), api.analysts()]).then(([userResult, analystResult]) => {
      const available = userResult.users.filter((account) => account.role_slug === 'client' && account.status === 'active')
      setClients(available)
      setClientUserId(available[0]?.id || '')
      setAnalysts((analystResult.analysts || []).filter((analyst) => analyst.status === 'active' && !analyst.biotechnology_access))
    }).catch(() => { setClients([]); setAnalysts([]) })
  }, [isAdmin])

  useEffect(() => {
    if (samplingSiteId && !availableSites.some((site) => site.id === samplingSiteId)) {
      setSamplingSiteId('')
    }
    if (zoneId && !availableZones.some((item) => item.id === zoneId)) setZoneId('')
  }, [clientUserId])

  const chooseSite = (siteId) => {
    setSamplingSiteId(siteId)
    const site = sites.find((item) => item.id === siteId)
    if (site) setZona(site.name)
  }

  const chooseZone = (selectedZoneId) => {
    setZoneId(selectedZoneId)
    setSamplingSiteId('')
    const selectedZone = zones.find((item) => item.id === selectedZoneId)
    if (selectedZone) setZona(selectedZone.name)
  }

  const toggleService = (serviceId) => {
    setSelectedIds((current) => {
      if (current.includes(serviceId)) return current.filter((id) => id !== serviceId)
      if (current.length >= MAX_ANALYSES) {
        setError(`Puedes agrupar hasta ${MAX_ANALYSES} análisis en una sola solicitud.`)
        return current
      }
      setError('')
      return [...current, serviceId]
    })
  }

  const canNext = (step === 0 && selectedIds.length > 0 && (!isAdmin || clientUserId))
    || (step === 1 && zona.trim())
    || (step === 2 && quoteReference.trim())
  const next = () => setStep((current) => Math.min(current + 1, 3))
  const back = () => setStep((current) => Math.max(current - 1, 0))

  const confirmar = async () => {
    setSaving(true)
    setError('')
    try {
      await api.createService({
        clientUserId: isAdmin ? clientUserId : undefined,
        serviceTypeIds: selectedIds,
        zoneId: zoneId || undefined,
        samplingSiteId: samplingSiteId || undefined,
        quoteReference,
        sampleIntakeMode,
        sampleIntakeScheduledAt: sampleIntakeScheduledAt ? new Date(sampleIntakeScheduledAt).toISOString() : null,
        zoneName: zona,
        sampleCount: muestras,
        priority: prioridad,
        notes: notas,
        analystIds: isAdmin ? selectedAnalystIds : undefined,
      })
      notify(isAdmin ? 'Servicio creado y asignado al cliente.' : 'Solicitud enviada. Un administrador la revisará.')
      go('ordenes')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="wizard-steps anim-in d1">
        {STEPS.map((label, index) => (
          <div key={label} style={{ display: 'contents' }}>
            <div className={`wz-step ${index === step ? 'active' : ''} ${index < step ? 'done' : ''}`}>
              <div className="wz-num">{index < step ? <IcoCheck /> : index + 1}</div>
              {label}
            </div>
            {index < STEPS.length - 1 && <div className="wz-line" />}
          </div>
        ))}
      </div>

      <div className="card order-wizard-card anim-in d2">
        {step === 0 && (
          <>
            <div className="card-title" style={{ marginBottom: 4 }}>¿Qué servicio necesitas?</div>
            <div className="muted" style={{ marginBottom: 20 }}>
              {isAdmin
                ? 'Selecciona el cliente y todos los análisis cotizados para la misma muestra o lote.'
                : 'Selecciona todos los análisis incluidos en tu cotización. Puedes combinarlos entre distintas familias.'}
            </div>
            {isAdmin && (
              <label className="field" style={{ marginBottom: 18 }}>
                <span>Cliente</span>
                <select value={clientUserId} onChange={(event) => { setClientUserId(event.target.value); setZoneId(''); setSamplingSiteId(''); setZona('') }} required>
                  {clients.length === 0 && <option value="">No hay clientes activos</option>}
                  {clients.map((client) => <option key={client.id} value={client.id}>{client.full_name} · {client.company}</option>)}
                </select>
              </label>
            )}
            <div className="catalog-subhead">
              <div><span>Catálogo unificado</span><strong>Todos los servicios</strong></div>
              <small>{catalog.length} disponibles · puedes combinar varios</small>
            </div>
            <div className="catalog-tools">
              <label className="catalog-search">
                <span aria-hidden="true">⌕</span>
                <input
                  value={catalogSearch}
                  onChange={(event) => setCatalogSearch(event.target.value)}
                  placeholder="Buscar cualquier servicio, análisis, microorganismo o parámetro…"
                  aria-label="Buscar en todos los servicios"
                />
                {catalogSearch && <button type="button" onClick={() => setCatalogSearch('')} aria-label="Limpiar búsqueda">×</button>}
              </label>
              <div className="catalog-filter-row" aria-label="Filtros del catálogo">
                <label className="catalog-filter-select">
                  <span>Tipo</span>
                  <select
                    value={catalogCategoryFilter}
                    onChange={(event) => {
                      setCatalogCategoryFilter(event.target.value)
                      setCatalogGroupFilter('all')
                    }}
                  >
                    <option value="all">Todos los tipos</option>
                    {catalogCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <label className="catalog-filter-select">
                  <span>Grupo</span>
                  <select value={catalogGroupFilter} onChange={(event) => setCatalogGroupFilter(event.target.value)}>
                    <option value="all">Todos los grupos</option>
                    {catalogGroups.map((group) => <option key={group} value={group}>{group}</option>)}
                  </select>
                </label>
                {(catalogSearch || catalogCategoryFilter !== 'all' || catalogGroupFilter !== 'all') && (
                  <button
                    type="button"
                    className="catalog-reset-filters"
                    onClick={() => {
                      setCatalogSearch('')
                      setCatalogCategoryFilter('all')
                      setCatalogGroupFilter('all')
                    }}
                  >
                    Limpiar filtros
                  </button>
                )}
              </div>
            </div>
            <div className="catalog-results-line">
              <span>{visibleServices.length} de {catalog.length} servicios</span>
              {selectedIds.length > 0 && (
                <button type="button" className="catalog-clear" onClick={() => setSelectedIds([])}>Limpiar selección</button>
              )}
            </div>
            {visibleServices.length > 0 ? (
              <div className="analysis-grid subservice-grid catalog-unified-grid">
                {visibleServices.map((item) => (
                  <button
                    key={item.id}
                    className={`analysis-card ${selectedIds.includes(item.id) ? 'selected' : ''}`}
                    aria-pressed={selectedIds.includes(item.id)}
                    onClick={() => toggleService(item.id)}
                  >
                    <span className="analysis-selection-mark">{selectedIds.includes(item.id) ? <IcoCheck /> : '+'}</span>
                    <span className="analysis-icon">{item.icon}</span>
                    <div className="analysis-name">{item.name}</div>
                    <div className="analysis-category-label">{item.category_name}{item.group_name ? ` · ${item.group_name}` : ''}</div>
                    <div className="analysis-desc">{item.description}</div>
                    {item.matrix_scope && <div className="analysis-matrix">{item.matrix_scope}</div>}
                    <div className="analysis-duration">Duración estimada · {item.estimated_duration}</div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="catalog-no-results">
                <strong>No encontramos ese servicio</strong>
                <span>Prueba con el nombre, microorganismo, matriz o parámetro.</span>
              </div>
            )}
            <div className={`selected-analysis-summary ${selectedItems.length ? 'has-items' : ''}`}>
              <div>
                <span className="selected-analysis-count">{selectedItems.length}</span>
                <div>
                  <strong>{selectedItems.length === 1 ? 'Análisis seleccionado' : 'Análisis seleccionados'}</strong>
                  <small>Todos quedarán agrupados en un solo servicio para la misma muestra.</small>
                </div>
              </div>
              {selectedItems.length > 0 ? (
                <div className="selected-analysis-chips">
                  {selectedItems.map((item) => (
                    <button key={item.id} onClick={() => toggleService(item.id)} title={`Quitar ${item.name}`}>
                      <span>{item.name}</span>
                      <small>{item.category_name}</small>
                      <b>×</b>
                    </button>
                  ))}
                </div>
              ) : (
                <p>Marca uno o varios análisis del catálogo para continuar.</p>
              )}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="card-title" style={{ marginBottom: 4 }}>¿Dónde se realizará el servicio?</div>
            <div className="muted" style={{ marginBottom: 20 }}>Selecciona una zona delimitada, una sede de muestreo o indica otra ubicación.</div>
            {availableZones.length > 0 && <>
              <div className="location-choice-title"><span>Zonas delimitadas</span><small>La selección quedará vinculada permanentemente a la orden.</small></div>
              <div className="saved-sites-grid saved-zones-grid">
                {availableZones.map((item) => (
                  <button key={item.id} className={`saved-site-card saved-zone-card ${zoneId === item.id ? 'selected' : ''}`} onClick={() => chooseZone(item.id)}>
                    <span style={{ background: item.color || '#2f6b4f' }}>⌗</span>
                    <div><strong>{item.name}</strong><small>{item.crop || 'Zona de campo'}{item.area_ha ? ` · ${item.area_ha} ha` : ''}</small></div>
                    {zoneId === item.id && <IcoCheck />}
                  </button>
                ))}
              </div>
            </>}
            {availableSites.length > 0 && (
              <><div className="location-choice-title"><span>Sedes de muestreo</span><small>Ubicaciones puntuales guardadas.</small></div>
              <div className="saved-sites-grid">
                {availableSites.map((site) => (
                  <button
                    key={site.id}
                    className={`saved-site-card ${samplingSiteId === site.id ? 'selected' : ''}`}
                    onClick={() => { setZoneId(''); chooseSite(site.id) }}
                  >
                    <span>⌖</span>
                    <div><strong>{site.name}</strong><small>{site.address || 'Sede de muestreo'}</small></div>
                    {samplingSiteId === site.id && <IcoCheck />}
                  </button>
                ))}
              </div>
              </>
            )}
            <label className="field mt-2">
              <span>{availableSites.length ? 'O escribe una ubicación distinta' : 'Ubicación o zona'}</span>
              <input
                value={zona}
                onChange={(event) => {
                  setZona(event.target.value)
                  setZoneId('')
                  if (samplingSiteId && event.target.value !== sites.find((site) => site.id === samplingSiteId)?.name) {
                    setSamplingSiteId('')
                  }
                }}
                placeholder="Ej. Lote Norte, Invernadero 2 o Planta de empaque"
                autoFocus
              />
            </label>
            {isAdmin && (
              <p className="field-help">Las sedes nuevas se gestionan desde “Cuadrillas y mapa” y quedarán disponibles para futuros servicios.</p>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <div className="card-title" style={{ marginBottom: 20 }}>Detalles de la muestra</div>
            <div className="order-sample-mode">
              <div className="order-sample-mode-title"><strong>¿Cómo se gestionará la muestra?</strong><span>Selecciona una sola opción.</span></div>
              <div>
                {SAMPLE_MODES.map((mode) => <button
                  type="button"
                  key={mode.id}
                  className={sampleIntakeMode === mode.id ? 'selected' : ''}
                  onClick={() => { setSampleIntakeMode(mode.id); if (mode.id === 'none') setSampleIntakeScheduledAt('') }}
                ><i>{sampleIntakeMode === mode.id ? <IcoCheck /> : '○'}</i><span><strong>{mode.title}</strong><small>{mode.text}</small></span></button>)}
              </div>
            </div>
            <div className="grid-2">
              <div className="field">
                <label>Número de muestras</label>
                <input type="number" min="1" max="500" value={muestras} disabled={sampleIntakeMode === 'none'} onChange={(event) => setMuestras(+event.target.value)} />
              </div>
              <div className="field">
                <label>Prioridad</label>
                <select value={prioridad} onChange={(event) => setPrioridad(event.target.value)}>
                  <option value="estandar">Estándar</option>
                  <option value="rapida">Rápida</option>
                  <option value="urgente">Urgente 48h</option>
                </select>
              </div>
            </div>
            <div className="field mt-2">
              <label>Referencia de cotización</label>
              <input value={quoteReference} onChange={(event) => setQuoteReference(event.target.value)} placeholder="Ej. COT-2026-00124" required />
              <small className="field-help">La solicitud se registra únicamente cuando AS Laboratorios ya emitió una cotización.</small>
            </div>
            {sampleIntakeMode !== 'none' && <div className="field mt-2 sample-schedule-field">
              <label>{sampleIntakeMode === 'aslabs_sampling' ? 'Fecha y hora del muestreo' : sampleIntakeMode === 'aslabs_collection' ? 'Fecha y hora del recojo' : 'Fecha y hora de entrega de muestra'}</label>
              <input type="datetime-local" value={sampleIntakeScheduledAt} onChange={(event) => setSampleIntakeScheduledAt(event.target.value)} />
              <small className="field-help">Opcional. Se mostrará como recordatorio en la orden hasta registrar la muestra y la firma del cliente.</small>
            </div>}
            <div className="field mt-2">
              <label>Notas para el laboratorio</label>
              <textarea rows="3" placeholder="Condiciones, alcance o instrucciones relevantes…" value={notas} onChange={(event) => setNotas(event.target.value)} />
            </div>
            {isAdmin && (
              <section className="service-analyst-assignment mt-2">
                <header>
                  <div><span className="eyebrow">Equipo operativo</span><h3>Asignar analistas</h3><p>Opcional. Puedes elegir uno o varios y modificar el equipo después de crear el servicio.</p></div>
                  <strong>{selectedAnalystIds.length}</strong>
                </header>
                <div className="service-analyst-grid">
                  {analysts.map((analyst) => {
                    const selected = selectedAnalystIds.includes(analyst.id)
                    return <label className={selected ? 'selected' : ''} key={analyst.id}>
                      <input type="checkbox" checked={selected} onChange={() => setSelectedAnalystIds((current) => selected ? current.filter((id) => id !== analyst.id) : [...current, analyst.id])} />
                      <span>{analyst.full_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('')}</span>
                      <div><strong>{analyst.full_name}</strong><small>{analyst.specialty || 'Operaciones de laboratorio'}</small></div>
                      <i>{selected ? <IcoCheck /> : '+'}</i>
                    </label>
                  })}
                </div>
              </section>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <div className="card-title" style={{ marginBottom: 20 }}>{isAdmin ? 'Confirma el nuevo servicio' : 'Confirma tu solicitud'}</div>
            <div className="grid-2">
              <div className="card order-summary-card">
                <div className="card-kicker">Resumen</div>
                <Row
                  k="Familias"
                  v={[...new Set(selectedItems.map((item) => item.category_name))].join(', ')}
                />
                <Row k="Análisis incluidos" v={selectedItems.length} />
                <div className="order-selected-analysis-list">
                  {selectedItems.map((item) => (
                    <div key={item.id}><IcoCheck /><span>{item.name}</span><small>{item.category_name}</small></div>
                  ))}
                </div>
                {isAdmin && <Row k="Cliente" v={clients.find((client) => client.id === clientUserId)?.full_name} />}
                <Row k="Sede o ubicación" v={zona} />
                <Row k="Gestión de muestra" v={SAMPLE_MODES.find((mode) => mode.id === sampleIntakeMode)?.title} />
                <Row k="Muestras" v={sampleIntakeMode === 'none' ? 'No requerida' : muestras} />
                <Row k="Prioridad" v={prioridad} />
                <Row k="Duración estimada" v={selectedItems.length === 1 ? selectedItems[0]?.estimated_duration : 'Según cada análisis'} />
                <Row k="Cotización" v={quoteReference} />
                {sampleIntakeMode !== 'none' && <Row k={sampleIntakeMode === 'aslabs_sampling' ? 'Muestreo' : sampleIntakeMode === 'aslabs_collection' ? 'Recojo' : 'Entrega'} v={sampleIntakeScheduledAt ? new Date(sampleIntakeScheduledAt).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' }) : 'Sin programación'} />}
                {isAdmin && <Row k="Analistas" v={selectedAnalystIds.length ? analysts.filter((analyst) => selectedAnalystIds.includes(analyst.id)).map((analyst) => analyst.full_name).join(', ') : 'Sin asignar'} />}
              </div>
              <div className="card quote-confirmation-card">
                <div className="card-kicker">Cotización previa</div>
                <div className="quote-confirmation-icon"><IcoCheck /></div>
                <div className="card-title">Solicitud vinculada</div>
                <div className="muted">El equipo administrativo validará la referencia antes de activar el servicio.</div>
                <div className="row mt-2" style={{ gap: 8 }}>
                  <span className="badge listo">Cotización emitida</span>
                  <span className="badge analisis">Revisión administrativa</span>
                </div>
              </div>
            </div>
            {notas && <div className="muted mt-2">Nota: “{notas}”</div>}
          </>
        )}

        <div className="spread mt-3">
          <button className="btn btn-ghost" onClick={step === 0 ? () => go('ordenes') : back}>
            {step === 0 ? 'Cancelar' : '← Atrás'}
          </button>
          {step < 3 ? (
            <button className="btn btn-primary" disabled={!canNext} onClick={next}>Continuar <IcoArrow /></button>
          ) : (
            <button className="btn btn-primary" onClick={confirmar} disabled={saving}>
              <IcoCheck /> {saving ? 'Guardando…' : isAdmin ? 'Crear servicio' : 'Enviar solicitud'}
            </button>
          )}
        </div>
        {error && <div className="form-error mt-2">{error}</div>}
      </div>
    </div>
  )
}

function Row({ k, v }) {
  return (
    <div className="spread" style={{ padding: '7px 0', borderBottom: '1px solid var(--stroke)' }}>
      <span className="muted">{k}</span>
      <span style={{ fontWeight: 600, fontSize: 13.5, textTransform: 'capitalize', textAlign: 'right' }}>{v}</span>
    </div>
  )
}
