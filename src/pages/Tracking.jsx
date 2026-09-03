import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { CENTRO_MAPA } from '../data/mock.js'
import { IcoCheck, IcoLocation, IcoPlus, IcoShield, IcoUser } from '../components/Icons.jsx'
import { api } from '../data/api.js'

const STATE_LABELS = {
  available: 'Disponible',
  at_laboratory: 'En sede del laboratorio',
  en_route: 'En ruta',
  sampling: 'Realizando muestreo',
  applying: 'Realizando aplicación',
  returning: 'Retornando al laboratorio',
  paused: 'En pausa',
}

const TYPE_LABELS = {
  sampling: 'Muestreo',
  application: 'Aplicación',
  logistics: 'Logística',
  laboratory: 'Laboratorio',
}

function timeAgo(value) {
  if (!value) return 'Sin reporte'
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 12) return 'Ahora'
  if (seconds < 60) return `Hace ${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `Hace ${minutes} min`
  return `Hace ${Math.floor(minutes / 60)} h`
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function crewInitials(crew) {
  if (crew.members?.length) return crew.members.slice(0, 2).map((member) => member.initials?.[0]).join('')
  return crew.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

function crewFunction(crew) {
  const types = [...new Set((crew.assignments || []).map((assignment) => TYPE_LABELS[assignment.assignmentType] || assignment.assignmentType))]
  return types.length ? types.join(' + ') : 'Equipo disponible'
}

const EMPTY_DATA = { crews: [], sites: [], members: [], services: [] }

export default function Tracking({ user }) {
  const isAdmin = user.role === 'admin'
  const [data, setData] = useState(EMPTY_DATA)
  const [clients, setClients] = useState([])
  const [selected, setSelected] = useState('')
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const [mapPickMode, setMapPickMode] = useState(false)
  const [pickedLocation, setPickedLocation] = useState(null)
  const [tool, setTool] = useState('site')
  const [siteForm, setSiteForm] = useState({ name: '', siteType: 'laboratory', clientUserId: '', address: '', lat: '', lng: '' })
  const [memberForm, setMemberForm] = useState({ fullName: '', roleTitle: '', phone: '' })
  const [crewForm, setCrewForm] = useState({ name: '', homeSiteId: '' })
  const [membershipForm, setMembershipForm] = useState({ crewId: '', memberId: '', role: '' })
  const [assignmentForm, setAssignmentForm] = useState({ crewId: '', serviceId: '', assignmentType: 'sampling', scheduledAt: '', notes: '' })
  const [locationForm, setLocationForm] = useState({
    operationalState: 'available', statusText: '', currentSiteId: '', lat: '', lng: '',
    assignmentId: '', assignmentStatus: '',
  })
  const mapEl = useRef(null)
  const mapObj = useRef(null)
  const markers = useRef({})
  const pickerMarker = useRef(null)
  const editorEl = useRef(null)
  const autoFitDone = useRef(false)

  const laboratories = data.sites.filter((site) => site.site_type === 'laboratory')
  const selectedCrew = data.crews.find((crew) => crew.id === selected)

  const applyData = (result) => {
    setData({
      crews: result.crews || [],
      sites: result.sites || [],
      members: result.members || [],
      services: result.services || [],
    })
    setSelected((current) => result.crews?.some((crew) => crew.id === current) ? current : result.crews?.[0]?.id || '')
  }

  const load = async (silent = false) => {
    try {
      const result = await api.tracking()
      applyData(result)
      setConnected(true)
      if (!silent) setError('')
    } catch (requestError) {
      setConnected(false)
      if (!silent) setError(requestError.message)
    }
  }

  useEffect(() => {
    load()
    const interval = setInterval(() => load(true), 4000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    api.users()
      .then((result) => setClients(result.users.filter((account) => account.role_slug === 'client' && account.status === 'active')))
      .catch(() => setClients([]))
  }, [isAdmin])

  useEffect(() => {
    if (mapObj.current || !mapEl.current) return
    const map = L.map(mapEl.current, { zoomControl: true, attributionControl: false }).setView(CENTRO_MAPA, 14)
    mapObj.current = map
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map)
    return () => {
      Object.values(markers.current).forEach((marker) => marker.remove())
      markers.current = {}
      pickerMarker.current?.remove()
      pickerMarker.current = null
      map.remove()
      mapObj.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapObj.current
    if (!map || !isAdmin) return undefined
    const mapContainer = map.getContainer()
    const choosePoint = (event) => {
      if (!mapPickMode || !selected) return
      if (event.target?.closest?.('.leaflet-control, .leaflet-marker-icon')) return
      const latlng = map.mouseEventToLatLng(event)
      const point = { lat: Number(latlng.lat.toFixed(6)), lng: Number(latlng.lng.toFixed(6)) }
      setLocationForm((current) => ({ ...current, currentSiteId: '', lat: point.lat, lng: point.lng }))
      setPickedLocation(point)
      setMapPickMode(false)
      window.setTimeout(() => editorEl.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 180)
    }
    mapContainer.addEventListener('click', choosePoint, true)
    return () => mapContainer.removeEventListener('click', choosePoint, true)
  }, [isAdmin, mapPickMode, selected])

  useEffect(() => {
    const map = mapObj.current
    if (!map) return
    if (!pickedLocation) {
      pickerMarker.current?.remove()
      pickerMarker.current = null
      return
    }
    const icon = L.divIcon({
      className: 'location-picker-marker-wrap',
      html: '<div class="location-picker-marker"><span>✓</span><small>Nueva ubicación</small></div>',
      iconSize: [52, 52],
      iconAnchor: [26, 45],
    })
    if (!pickerMarker.current) pickerMarker.current = L.marker([pickedLocation.lat, pickedLocation.lng], { icon, interactive: false }).addTo(map)
    else pickerMarker.current.setLatLng([pickedLocation.lat, pickedLocation.lng]).setIcon(icon)
  }, [pickedLocation])

  useEffect(() => {
    const map = mapObj.current
    if (!map) return
    const liveKeys = new Set()

    data.sites.forEach((site) => {
      const key = `site-${site.id}`
      liveKeys.add(key)
      const icon = L.divIcon({
        className: 'site-marker-wrap',
        html: `<div class="site-map-marker ${site.site_type}"><span>${site.site_type === 'laboratory' ? 'AS' : '⌖'}</span><small>${escapeHtml(site.name)}</small></div>`,
        iconSize: [48, 48],
        iconAnchor: [24, 24],
      })
      if (!markers.current[key]) markers.current[key] = L.marker([site.lat, site.lng], { icon }).addTo(map)
      else {
        markers.current[key].setLatLng([site.lat, site.lng])
        markers.current[key].setIcon(icon)
      }
    })

    data.crews.forEach((crew) => {
      if (crew.current_lat == null || crew.current_lng == null) return
      const key = `crew-${crew.id}`
      liveKeys.add(key)
      const icon = L.divIcon({
        className: 'worker-marker-wrap',
        html: `<div class="worker-map-marker ${selected === crew.id ? 'selected' : ''}">
          <span>${escapeHtml(crewInitials(crew))}</span><i></i>
          <small><b>${escapeHtml(crew.name)}</b><em>${escapeHtml(crewFunction(crew))}</em></small>
        </div>`,
        iconSize: [56, 56],
        iconAnchor: [24, 24],
      })
      if (!markers.current[key]) {
        markers.current[key] = L.marker([crew.current_lat, crew.current_lng], { icon }).addTo(map)
        markers.current[key].on('click', () => setSelected(crew.id))
      } else {
        markers.current[key].setLatLng([crew.current_lat, crew.current_lng])
        markers.current[key].setIcon(icon)
      }
    })

    Object.keys(markers.current).forEach((key) => {
      if (!liveKeys.has(key)) {
        markers.current[key].remove()
        delete markers.current[key]
      }
    })

    const crewPositions = data.crews
      .filter((crew) => crew.current_lat != null && crew.current_lng != null)
      .map((crew) => [crew.current_lat, crew.current_lng])
    if (!autoFitDone.current && crewPositions.length) {
      autoFitDone.current = true
      window.setTimeout(() => {
        if (crewPositions.length === 1) map.flyTo(crewPositions[0], 16, { duration: 0.7 })
        else map.fitBounds(L.latLngBounds(crewPositions), { padding: [70, 70], maxZoom: 16 })
      }, 180)
    }
  }, [data.crews, data.sites, selected])

  useEffect(() => {
    if (!selectedCrew) return
    setMapPickMode(false)
    setPickedLocation(null)
    setLocationForm({
      operationalState: selectedCrew.operational_state,
      statusText: selectedCrew.status_text || '',
      currentSiteId: selectedCrew.current_site_id || '',
      lat: selectedCrew.current_lat ?? '',
      lng: selectedCrew.current_lng ?? '',
      assignmentId: selectedCrew.assignments?.[0]?.id || '',
      assignmentStatus: selectedCrew.assignments?.[0]?.status || '',
    })
  }, [selected])

  const focusCrew = (crew) => {
    setSelected(crew.id)
    if (crew.current_lat != null && crew.current_lng != null) {
      mapObj.current?.flyTo([crew.current_lat, crew.current_lng], 17, { duration: 0.8 })
    }
  }

  const runAction = async (payload, success, reset) => {
    setWorking(true)
    setError('')
    try {
      const result = await api.updateTracking(payload)
      applyData(result)
      reset?.()
      setError('')
      if (success) window.setTimeout(() => setError(''), 2500)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setWorking(false)
    }
  }

  const createSite = (event) => {
    event.preventDefault()
    runAction(
      { action: 'create_site', ...siteForm },
      'Sede creada',
      () => setSiteForm({ name: '', siteType: 'laboratory', clientUserId: '', address: '', lat: '', lng: '' }),
    )
  }

  const createMember = (event) => {
    event.preventDefault()
    runAction(
      { action: 'create_member', ...memberForm },
      'Integrante creado',
      () => setMemberForm({ fullName: '', roleTitle: '', phone: '' }),
    )
  }

  const createCrew = (event) => {
    event.preventDefault()
    runAction(
      { action: 'create_crew', ...crewForm },
      'Cuadrilla creada',
      () => setCrewForm({ name: '', homeSiteId: '' }),
    )
  }

  const assignMember = (event) => {
    event.preventDefault()
    runAction(
      { action: 'assign_member', ...membershipForm },
      'Integrante asignado',
      () => setMembershipForm({ crewId: '', memberId: '', role: '' }),
    )
  }

  const assignService = (event) => {
    event.preventDefault()
    runAction(
      {
        action: 'assign_service',
        ...assignmentForm,
        scheduledAt: assignmentForm.scheduledAt ? new Date(assignmentForm.scheduledAt).toISOString() : null,
      },
      'Servicio asignado',
      () => setAssignmentForm({ crewId: '', serviceId: '', assignmentType: 'sampling', scheduledAt: '', notes: '' }),
    )
  }

  const updateCrew = (event) => {
    event.preventDefault()
    runAction(
      { action: 'update_crew', crewId: selected, ...locationForm },
      'Ubicación actualizada',
      () => { setMapPickMode(false); setPickedLocation(null) },
    )
  }

  const updateAssignment = (assignment, progress) => {
    const status = progress === 100 ? 'completed' : progress >= 60 ? 'on_site' : progress >= 25 ? 'en_route' : 'planned'
    runAction(
      { action: 'update_crew', crewId: selected, assignmentId: assignment.id, assignmentStatus: status, assignmentProgress: progress },
      progress === 100 ? 'Servicio completado' : 'Avance actualizado',
    )
  }

  const chooseCurrentSite = (siteId) => {
    const site = data.sites.find((item) => item.id === siteId)
    setMapPickMode(false)
    setPickedLocation(null)
    setLocationForm((current) => ({
      ...current,
      currentSiteId: siteId,
      lat: site?.lat ?? current.lat,
      lng: site?.lng ?? current.lng,
    }))
  }

  const startMapPick = () => {
    if (!selectedCrew) return
    setMapPickMode((current) => {
      const next = !current
      if (next) window.setTimeout(() => mapEl.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100)
      return next
    })
  }

  return (
    <div className={`tracking-page ${isAdmin ? 'admin-tracking' : 'client-tracking'}`}>
      <section className="tracking-page-head anim-in d1">
        <div>
          <span className="eyebrow">{isAdmin ? 'Operación de campo' : 'Seguimiento en campo'}</span>
          <h1>{isAdmin ? 'Cuadrillas, sedes y servicios' : 'Cuadrillas de mis servicios'}</h1>
          <p>{isAdmin
            ? 'Una cuadrilla puede atender varios servicios. Su ubicación y sus integrantes se actualizan desde este centro.'
            : 'Consulta el equipo asignado, la etapa operativa y su ubicación más reciente.'}</p>
        </div>
        <div className={`tracking-live ${connected ? '' : 'reconnecting'}`}><span className="status-dot" /> {connected ? 'Actualización cada 4 s' : 'Reconectando…'}</div>
      </section>

      {!isAdmin && (
        <section className="client-field-overview anim-in d2">
          <header>
            <div>
              <span className="eyebrow">Estado de la operación</span>
              <h2>{data.crews.length ? `${data.crews.length} ${data.crews.length === 1 ? 'cuadrilla asignada' : 'cuadrillas asignadas'}` : 'Sin cuadrillas asignadas'}</h2>
              <p>Estas son las funciones y ubicaciones reportadas para tus servicios.</p>
            </div>
            <span className={`field-live-indicator ${connected ? '' : 'offline'}`}><i /> {connected ? 'Ubicación en vivo' : 'Reconectando'}</span>
          </header>
          {data.crews.length > 0 && (
            <div className="client-field-crew-grid">
              {data.crews.map((crew) => {
                const mainAssignment = crew.assignments?.[0]
                return (
                  <button key={crew.id} className={selected === crew.id ? 'selected' : ''} onClick={() => focusCrew(crew)}>
                    <div className="client-field-crew-icon">{crewInitials(crew)}<span /></div>
                    <div>
                      <small>{crewFunction(crew)}</small>
                      <strong>{crew.name}</strong>
                      <p><IcoLocation /> {crew.current_site_name || crew.home_laboratory_name || 'Ubicación reportada en el mapa'}</p>
                    </div>
                    <div className="client-field-crew-state">
                      <span>{crew.status_text || STATE_LABELS[crew.operational_state]}</span>
                      <strong>{mainAssignment?.serviceName || 'Sin servicio activo'}</strong>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </section>
      )}

      {isAdmin && (
        <section className="card field-ops-card anim-in d2">
          <div className="field-ops-head">
            <div><div className="card-kicker">Centro operativo</div><h2>Configurar operación</h2></div>
            <div className="field-ops-tabs">
              {[
                ['site', 'Sede'],
                ['member', 'Integrante'],
                ['crew', 'Cuadrilla'],
                ['membership', 'Equipo'],
                ['assignment', 'Servicio'],
              ].map(([id, label]) => (
                <button key={id} className={`btn btn-sm ${tool === id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTool(id)}>{label}</button>
              ))}
            </div>
          </div>

          {tool === 'site' && (
            <form className="field-ops-form" onSubmit={createSite}>
              <label className="field"><span>Tipo de sede</span><select value={siteForm.siteType} onChange={(event) => setSiteForm({ ...siteForm, siteType: event.target.value })}><option value="laboratory">Sede del laboratorio</option><option value="sampling">Sede de muestreo</option></select></label>
              <label className="field"><span>Nombre</span><input value={siteForm.name} onChange={(event) => setSiteForm({ ...siteForm, name: event.target.value })} placeholder="Ej. Laboratorio Lima" required /></label>
              {siteForm.siteType === 'sampling' && (
                <label className="field"><span>Cliente</span><select value={siteForm.clientUserId} onChange={(event) => setSiteForm({ ...siteForm, clientUserId: event.target.value })} required><option value="">Seleccionar</option>{clients.map((client) => <option value={client.id} key={client.id}>{client.full_name} · {client.company}</option>)}</select></label>
              )}
              <label className="field"><span>Dirección o referencia</span><input value={siteForm.address} onChange={(event) => setSiteForm({ ...siteForm, address: event.target.value })} placeholder="Dirección visible para operación" /></label>
              <label className="field"><span>Latitud</span><input type="number" step="any" value={siteForm.lat} onChange={(event) => setSiteForm({ ...siteForm, lat: event.target.value })} placeholder="-12.0464" required /></label>
              <label className="field"><span>Longitud</span><input type="number" step="any" value={siteForm.lng} onChange={(event) => setSiteForm({ ...siteForm, lng: event.target.value })} placeholder="-77.0428" required /></label>
              <button className="btn btn-primary" disabled={working}><IcoPlus /> Guardar sede</button>
            </form>
          )}

          {tool === 'member' && (
            <form className="field-ops-form compact" onSubmit={createMember}>
              <label className="field"><span>Nombre completo</span><input value={memberForm.fullName} onChange={(event) => setMemberForm({ ...memberForm, fullName: event.target.value })} required /></label>
              <label className="field"><span>Función</span><input value={memberForm.roleTitle} onChange={(event) => setMemberForm({ ...memberForm, roleTitle: event.target.value })} placeholder="Muestreador, técnico, aplicador…" /></label>
              <label className="field"><span>Teléfono</span><input value={memberForm.phone} onChange={(event) => setMemberForm({ ...memberForm, phone: event.target.value })} /></label>
              <button className="btn btn-primary" disabled={working}><IcoPlus /> Añadir integrante</button>
            </form>
          )}

          {tool === 'crew' && (
            <form className="field-ops-form compact" onSubmit={createCrew}>
              <label className="field"><span>Nombre de la cuadrilla</span><input value={crewForm.name} onChange={(event) => setCrewForm({ ...crewForm, name: event.target.value })} placeholder="Ej. Cuadrilla Norte" required /></label>
              <label className="field"><span>Sede base del laboratorio</span><select value={crewForm.homeSiteId} onChange={(event) => setCrewForm({ ...crewForm, homeSiteId: event.target.value })} required><option value="">{laboratories.length ? 'Seleccionar sede' : 'Primero crea una sede de laboratorio'}</option>{laboratories.map((site) => <option value={site.id} key={site.id}>{site.name}</option>)}</select></label>
              <button className="btn btn-primary" disabled={working || !laboratories.length}><IcoPlus /> Crear cuadrilla</button>
            </form>
          )}

          {tool === 'membership' && (
            <form className="field-ops-form compact" onSubmit={assignMember}>
              <label className="field"><span>Cuadrilla</span><select value={membershipForm.crewId} onChange={(event) => setMembershipForm({ ...membershipForm, crewId: event.target.value })} required><option value="">Seleccionar</option>{data.crews.map((crew) => <option value={crew.id} key={crew.id}>{crew.name}</option>)}</select></label>
              <label className="field"><span>Integrante</span><select value={membershipForm.memberId} onChange={(event) => setMembershipForm({ ...membershipForm, memberId: event.target.value })} required><option value="">Seleccionar</option>{data.members.map((member) => <option value={member.id} key={member.id}>{member.full_name} · {member.role_title || 'Sin función'}</option>)}</select></label>
              <label className="field"><span>Responsabilidad en esta cuadrilla</span><input value={membershipForm.role} onChange={(event) => setMembershipForm({ ...membershipForm, role: event.target.value })} placeholder="Ej. Responsable de muestreo" /></label>
              <button className="btn btn-primary" disabled={working}><IcoUser /> Asignar integrante</button>
            </form>
          )}

          {tool === 'assignment' && (
            <form className="field-ops-form" onSubmit={assignService}>
              <label className="field"><span>Cuadrilla</span><select value={assignmentForm.crewId} onChange={(event) => setAssignmentForm({ ...assignmentForm, crewId: event.target.value })} required><option value="">Seleccionar</option>{data.crews.map((crew) => <option value={crew.id} key={crew.id}>{crew.name} · {crew.assignments?.length || 0} servicios</option>)}</select></label>
              <label className="field"><span>Servicio activo</span><select value={assignmentForm.serviceId} onChange={(event) => setAssignmentForm({ ...assignmentForm, serviceId: event.target.value })} required><option value="">Seleccionar</option>{data.services.map((service) => <option value={service.id} key={service.id}>{service.code} · {service.service_type_name} · {service.client_name}</option>)}</select></label>
              <label className="field"><span>Actividad</span><select value={assignmentForm.assignmentType} onChange={(event) => setAssignmentForm({ ...assignmentForm, assignmentType: event.target.value })}><option value="sampling">Muestreo</option><option value="application">Aplicación</option><option value="logistics">Logística</option><option value="laboratory">Laboratorio</option></select></label>
              <label className="field"><span>Fecha programada</span><input type="datetime-local" value={assignmentForm.scheduledAt} onChange={(event) => setAssignmentForm({ ...assignmentForm, scheduledAt: event.target.value })} /></label>
              <label className="field"><span>Indicaciones</span><input value={assignmentForm.notes} onChange={(event) => setAssignmentForm({ ...assignmentForm, notes: event.target.value })} placeholder="Opcional" /></label>
              <button className="btn btn-primary" disabled={working}><IcoCheck /> Asignar servicio</button>
            </form>
          )}
        </section>
      )}

      {error && <div className="form-error">{error}</div>}

      <div className="tracking-layout">
        <section className="tracking-map-card anim-in d2">
          <div className="tracking-toolbar">
            <div><div className="card-kicker">{isAdmin ? 'Mapa operativo' : 'Ubicación de las cuadrillas'}</div><h2>{data.crews.length} cuadrillas · {data.sites.length} sedes</h2></div>
            <div className="map-key"><span><i className="crew-key" /> Cuadrilla</span><span><i className="lab-key" /> Laboratorio</span><span><i className="site-key" /> Muestreo</span></div>
          </div>
          <div className={`tracking-map ${mapPickMode ? 'picking-location' : ''}`} ref={mapEl} />
          {mapPickMode && (
            <div className="map-location-pick-banner">
              <span><IcoLocation /></span>
              <div><strong>Selecciona la nueva ubicación</strong><small>Haz clic en cualquier punto del mapa para colocar la cuadrilla.</small></div>
              <button type="button" onClick={() => setMapPickMode(false)}>Cancelar</button>
            </div>
          )}
          {connected && data.crews.length === 0 && data.sites.length === 0 && (
            <div className="map-empty-state"><span><IcoLocation /></span><strong>Mapa listo para operar</strong><p>{isAdmin ? 'Añade una sede del laboratorio y crea la primera cuadrilla.' : 'Las ubicaciones aparecerán cuando un servicio tenga cuadrilla asignada.'}</p></div>
          )}
          <div className="map-legend"><span><i className="legend-online" /> Posición más reciente</span><span><IcoShield /> Visible solo para usuarios autorizados</span></div>
        </section>

        <aside className="tracking-side anim-in d3">
          <div className="card workers-panel">
            <div className="section-head"><div><div className="card-kicker">Operación compartida</div><h2>Cuadrillas activas</h2></div><span className="count-pill">{data.crews.length}</span></div>
            <div className="workers-list">
              {connected && data.crews.length === 0 && <div className="workers-empty">{isAdmin ? 'Aún no se han creado cuadrillas.' : 'No hay cuadrillas asignadas a tus servicios.'}</div>}
              {data.crews.map((crew) => (
                <button className={`worker-card crew-card ${selected === crew.id ? 'selected' : ''}`} key={crew.id} onClick={() => focusCrew(crew)}>
                  <div className="worker-card-head">
                    <div className="worker-avatar">{crewInitials(crew)}<span /></div>
                    <div><strong>{crew.name}</strong><span>{STATE_LABELS[crew.operational_state] || crew.operational_state}</span></div>
                    <div className="gps-time">{timeAgo(crew.last_seen_at)}</div>
                  </div>
                  <div className="crew-function-line"><IcoLocation /> <strong>{crewFunction(crew)}</strong><span>{crew.current_site_name || crew.home_laboratory_name || 'Ubicación por actualizar'}</span></div>
                  <div className="crew-member-stack">{crew.members?.length ? crew.members.map((member) => <span key={member.id}>{member.fullName}</span>) : <span>Integrantes por asignar</span>}</div>
                  <div className="crew-service-count">{crew.assignments?.length || 0} {(crew.assignments?.length || 0) === 1 ? 'servicio simultáneo' : 'servicios simultáneos'}</div>
                  <div className="progress-track"><div className="progress-fill" style={{ width: `${crew.progress}%` }} /></div>
                </button>
              ))}
            </div>
          </div>

          {selectedCrew && (
            <div className="card selected-worker-card crew-detail-card">
              <div className="card-kicker">Detalle operativo</div>
              <div className="selected-worker-title"><IcoLocation /><div><strong>{selectedCrew.status_text || STATE_LABELS[selectedCrew.operational_state]}</strong><span>{selectedCrew.name}</span></div></div>
              <div className="crew-assignments">
                <span className="field-label">Servicios asignados</span>
                {selectedCrew.assignments?.length ? selectedCrew.assignments.map((assignment) => (
                  <article className="crew-service-simple" key={assignment.id}>
                    <div><strong>{assignment.serviceName}</strong><span>{assignment.code} · {TYPE_LABELS[assignment.assignmentType]}</span></div>
                    <span className={`badge ${assignment.status === 'completed' ? 'listo' : 'analisis'}`}>{assignment.progress || 0}%</span>
                    <p>{assignment.clientName}{assignment.samplingSite ? ` · ${assignment.samplingSite}` : ''}</p>
                    {assignment.scheduledAt && <time>Programado: {new Date(assignment.scheduledAt).toLocaleString('es-PE')}</time>}
                    <div className="crew-service-progress"><i style={{ width: `${assignment.progress || 0}%` }} /></div>
                    {isAdmin && <div className="crew-service-quick-actions">
                      <button type="button" className={(assignment.progress || 0) === 0 ? 'active' : ''} onClick={() => updateAssignment(assignment,0)}>Pendiente</button>
                      <button type="button" className={(assignment.progress || 0) === 25 ? 'active' : ''} onClick={() => updateAssignment(assignment,25)}>En ruta</button>
                      <button type="button" className={(assignment.progress || 0) === 60 ? 'active' : ''} onClick={() => updateAssignment(assignment,60)}>En sitio</button>
                      <button type="button" className={(assignment.progress || 0) === 100 ? 'active' : ''} onClick={() => updateAssignment(assignment,100)}>Completar</button>
                    </div>}
                    {assignment.assignmentType === 'sampling' && assignment.status !== 'completed' && <small className="crew-auto-hint">La firma del cliente lo completará automáticamente.</small>}
                  </article>
                )) : <div className="workers-empty">Disponible, sin servicios asignados.</div>}
              </div>
              <dl className="detail-list">
                <div><dt>Sede base</dt><dd>{selectedCrew.home_laboratory_name || 'Opcional, sin asignar'}</dd></div>
                <div><dt>Ubicación actual</dt><dd>{selectedCrew.current_site_name || 'Coordenadas manuales'}</dd></div>
                <div><dt>Integrantes</dt><dd>{selectedCrew.members?.length || 0}</dd></div>
              </dl>

              {isAdmin && (
                <form className="crew-live-editor" onSubmit={updateCrew} ref={editorEl}>
                  <div className="spread"><span className="field-label">Editar en tiempo real</span><span className="tracking-live"><span className="status-dot" /> En vivo</span></div>
                  <label className="field"><span>Estado</span><select value={locationForm.operationalState} onChange={(event) => setLocationForm({ ...locationForm, operationalState: event.target.value })}>{Object.entries(STATE_LABELS).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
                  <label className="field"><span>Mensaje visible</span><input value={locationForm.statusText} onChange={(event) => setLocationForm({ ...locationForm, statusText: event.target.value })} placeholder="Ej. Recolectando muestras" /></label>
                  <label className="field"><span>Ubicación guardada</span><select value={locationForm.currentSiteId} onChange={(event) => chooseCurrentSite(event.target.value)}><option value="">Coordenadas manuales</option>{data.sites.map((site) => <option value={site.id} key={site.id}>{site.name} · {site.site_type === 'laboratory' ? 'Laboratorio' : 'Muestreo'}</option>)}</select></label>
                  <button type="button" className={`map-pick-location-button ${mapPickMode ? 'active' : ''}`} onClick={startMapPick}>
                    <IcoLocation />
                    <span><strong>{mapPickMode ? 'Esperando un punto en el mapa…' : 'Elegir ubicación haciendo clic en el mapa'}</strong><small>{pickedLocation ? 'Punto seleccionado. Guarda para publicar la nueva posición.' : 'Más rápido que escribir latitud y longitud.'}</small></span>
                  </button>
                  <div className="grid-2">
                    <label className="field"><span>Latitud</span><input type="number" step="any" value={locationForm.lat} onChange={(event) => { setPickedLocation(null); setLocationForm({ ...locationForm, currentSiteId: '', lat: event.target.value }) }} /></label>
                    <label className="field"><span>Longitud</span><input type="number" step="any" value={locationForm.lng} onChange={(event) => { setPickedLocation(null); setLocationForm({ ...locationForm, currentSiteId: '', lng: event.target.value }) }} /></label>
                  </div>
                  <button className="btn btn-primary" disabled={working}>Guardar ubicación y estado</button>
                </form>
              )}
              {!isAdmin && <div className="privacy-note">La ubicación corresponde a la jornada de los servicios asignados a tu organización.</div>}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
