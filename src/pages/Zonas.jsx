import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { CENTRO_MAPA } from '../data/mock.js'
import { IcoPlus, IcoArrow, IcoLeaf } from '../components/Icons.jsx'
import { api } from '../data/api.js'

function polygonAreaHa(points) {
  if (points.length < 3) return 0
  const radius = 6378137
  const meanLat = points.reduce((total, point) => total + point[0], 0) / points.length
  const cosLat = Math.cos((meanLat * Math.PI) / 180)
  const projected = points.map(([lat, lng]) => [
    radius * (lng * Math.PI / 180) * cosLat,
    radius * (lat * Math.PI / 180),
  ])
  let area = 0
  projected.forEach(([x1, y1], index) => {
    const [x2, y2] = projected[(index + 1) % projected.length]
    area += (x1 * y2) - (x2 * y1)
  })
  return Math.abs(area / 2) / 10000
}

function toViewZone(zone) {
  return {
    id: zone.id,
    nombre: zone.name,
    color: zone.color,
    cultivo: zone.crop,
    area: zone.area_ha == null ? 'Área no calculada' : `${Number(zone.area_ha).toFixed(2)} ha`,
    coords: zone.coordinates,
    clientName: zone.client_name,
    clientCompany: zone.client_company,
  }
}

export default function Zonas({ go, notify, user }) {
  const isAdmin = user.role === 'admin'
  const mapRef = useRef(null)
  const mapObj = useRef(null)
  const layers = useRef({})
  const drawLayer = useRef(null)
  const [zonas, setZonas] = useState([])
  const [activa, setActiva] = useState(null)
  const [dibujando, setDibujando] = useState(false)
  const [nuevosPuntos, setNuevosPuntos] = useState([])
  const [nombre, setNombre] = useState('')
  const [cultivo, setCultivo] = useState('')
  const [clients, setClients] = useState([])
  const [clientUserId, setClientUserId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const dibujandoRef = useRef(false)

  const loadZones = async () => {
    setLoading(true)
    try {
      const result = await api.zones()
      const next = result.zones.map(toViewZone)
      setZonas(next)
      setActiva((current) => next.some((zone) => zone.id === current) ? current : next[0]?.id || null)
      setError('')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadZones()
    if (isAdmin) {
      api.users().then((result) => {
        const available = result.users.filter((account) => account.role_slug !== 'admin' && account.status === 'active')
        setClients(available)
        setClientUserId(available[0]?.id || '')
      }).catch(() => setClients([]))
    }
  }, [isAdmin])

  // Inicializar mapa
  useEffect(() => {
    if (mapObj.current) return
    const map = L.map(mapRef.current, { zoomControl: true, attributionControl: false }).setView(CENTRO_MAPA, 15)
    mapObj.current = map

    // Capa satelital (Esri World Imagery)
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
    }).addTo(map)

    // Etiquetas encima, tenues
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
      opacity: 0.5, maxZoom: 19,
    }).addTo(map)

    drawLayer.current = L.layerGroup().addTo(map)

    map.on('click', (e) => {
      if (!dibujandoRef.current) return
      const { lat, lng } = e.latlng
      setNuevosPuntos((pts) => {
        const next = [...pts, [lat, lng]]
        redibujar(next)
        return next
      })
    })

    return () => { map.remove(); mapObj.current = null }
  }, [])

  // Pintar zonas guardadas
  useEffect(() => {
    const map = mapObj.current
    if (!map) return
    Object.values(layers.current).forEach((l) => map.removeLayer(l))
    layers.current = {}
    zonas.forEach((z) => {
      const poly = L.polygon(z.coords, {
        color: z.id === activa ? '#efa23a' : z.color,
        weight: z.id === activa ? 4 : 2,
        fillColor: z.color,
        fillOpacity: z.id === activa ? 0.38 : 0.16,
        className: 'zone-poly',
      }).addTo(map)
      poly.on('click', () => setActiva(z.id))
      poly.bindTooltip(`${z.nombre} · ${z.area}`, { className: 'zone-tip', direction: 'top' })
      layers.current[z.id] = poly
    })
    const selectedLayer = layers.current[activa]
    if (selectedLayer) {
      map.fitBounds(selectedLayer.getBounds(), { padding: [48, 48], maxZoom: 18 })
    }
  }, [zonas, activa])

  const redibujar = (pts) => {
    const map = mapObj.current
    drawLayer.current.clearLayers()
    pts.forEach((p) => L.circleMarker(p, { radius: 5, color: '#2f6b4f', fillColor: '#2f6b4f', fillOpacity: 1 }).addTo(drawLayer.current))
    if (pts.length >= 2) L.polyline([...pts, pts[0]], { color: '#2f6b4f', weight: 2, dashArray: '6 6' }).addTo(drawLayer.current)
  }

  const toggleDibujo = async () => {
    if (dibujando) {
      if (nuevosPuntos.length < 3) {
        notify('Añade al menos tres puntos para guardar la zona.')
        return
      }
      if (!nombre.trim()) {
        setError('Escribe un nombre para la zona.')
        return
      }
      if (isAdmin && !clientUserId) {
        setError('Selecciona el cliente propietario de la zona.')
        return
      }
      setSaving(true)
      setError('')
      try {
        const result = await api.createZone({
          clientUserId: isAdmin ? clientUserId : undefined,
          name: nombre,
          crop: cultivo,
          areaHa: polygonAreaHa(nuevosPuntos),
          color: '#2f6b4f',
          coordinates: nuevosPuntos,
        })
        setNuevosPuntos([])
        drawLayer.current.clearLayers()
        setDibujando(false)
        dibujandoRef.current = false
        await loadZones()
        setActiva(result.zone.id)
        notify(`Zona “${nombre.trim()}” guardada correctamente.`)
      } catch (requestError) {
        setError(requestError.message)
      } finally {
        setSaving(false)
      }
    } else {
      if (isAdmin && !clientUserId) {
        setError('Selecciona un cliente antes de delimitar la zona.')
        return
      }
      setDibujando(true)
      dibujandoRef.current = true
      setNuevosPuntos([])
      setNombre(`Zona ${zonas.length + 1}`)
      setCultivo('')
      setError('')
      drawLayer.current.clearLayers()
    }
  }

  const irAZona = (z) => {
    setActiva(z.id)
    mapObj.current.fitBounds(L.polygon(z.coords).getBounds(), { padding: [40, 40] })
  }

  const zonaActiva = zonas.find((z) => z.id === activa)
  const hudCenter = zonaActiva?.coords?.[0] || CENTRO_MAPA

  return (
    <div className="grid-2" style={{ gridTemplateColumns: '1fr 320px', alignItems: 'start' }}>
      <div className="anim-in d1">
        <div className="map-wrap">
          <div ref={mapRef} className="leaflet-container" />
          <div className="map-corner tl" /><div className="map-corner tr" />
          <div className="map-corner bl" /><div className="map-corner br" />
          <div className="map-hud">
            <div className="map-hud-pill">◈ AGRO-SAT · {hudCenter[0].toFixed(3)}, {hudCenter[1].toFixed(3)}</div>
            {dibujando && <div className="map-hud-pill" style={{ color: 'var(--neon)' }}>✎ Dibujando · clic para añadir vértices ({nuevosPuntos.length})</div>}
          </div>
        </div>
        {dibujando && (
          <div className="zone-save-form mt-2">
            <label className="field">
              <span>Nombre de la zona</span>
              <input value={nombre} onChange={(event) => setNombre(event.target.value)} />
            </label>
            <label className="field">
              <span>Cultivo o uso</span>
              <input value={cultivo} onChange={(event) => setCultivo(event.target.value)} placeholder="Opcional" />
            </label>
          </div>
        )}
        <div className="row mt-2">
          <button className={`btn ${dibujando ? 'btn-primary' : 'btn-ghost'}`} onClick={toggleDibujo} disabled={saving}>
            {dibujando ? <>{saving ? 'Guardando…' : `✓ Guardar zona (${nuevosPuntos.length} pts)`}</> : <><IcoPlus /> Delimitar nueva zona</>}
          </button>
          <div className="muted">Traza el polígono de tu campo con coordenadas reales sobre el mapa satelital.</div>
        </div>
        {error && <div className="form-error mt-2">{error}</div>}
      </div>

      <div className="anim-in d2" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {isAdmin && (
          <div className="card">
            <div className="card-kicker">Cliente propietario</div>
            <label className="field mt-2">
              <span>Guardar zonas para</span>
              <select value={clientUserId} onChange={(event) => setClientUserId(event.target.value)} disabled={dibujando}>
                {clients.length === 0 && <option value="">No hay clientes activos</option>}
                {clients.map((client) => <option value={client.id} key={client.id}>{client.full_name} · {client.company}</option>)}
              </select>
            </label>
          </div>
        )}
        <div className="card">
          <div className="card-kicker">Zonas delimitadas</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 12 }}>
            {loading && <div className="workers-empty">Cargando zonas guardadas…</div>}
            {!loading && zonas.length === 0 && (
              <div className="workers-empty">Todavía no hay zonas creadas. Puedes delimitar la primera directamente sobre el mapa.</div>
            )}
            {zonas.map((z) => (
              <div key={z.id} className={`zone-chip ${activa === z.id ? 'active' : ''}`} onClick={() => irAZona(z)}>
                <div className="row" style={{ gap: 10 }}>
                  <span className="zone-color" style={{ color: z.color, background: z.color }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{z.nombre}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{z.cultivo} · {z.area}</div>
                    {isAdmin && <div className="zone-owner">{z.clientName} · {z.clientCompany}</div>}
                  </div>
                </div>
                <IcoArrow style={{ color: 'var(--neon-dim)' }} />
              </div>
            ))}
          </div>
        </div>

        {zonaActiva && (
          <div className="card">
            <div className="card-kicker">Detalle · {zonaActiva.nombre}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
              <Row k="Cultivo" v={zonaActiva.cultivo} />
              <Row k="Área" v={zonaActiva.area} />
              <Row k="Vértices" v={`${zonaActiva.coords.length} puntos`} />
              <div>
                <div className="muted" style={{ marginBottom: 6 }}>Coordenadas</div>
                <div className="mono" style={{ fontSize: 10.5, color: 'var(--neon-soft)', lineHeight: 1.7, background: 'rgba(0,255,157,0.04)', padding: 10, borderRadius: 8, border: '1px solid var(--stroke)' }}>
                  {zonaActiva.coords.map((c, i) => (
                    <div key={i}>P{i + 1}: {c[0].toFixed(5)}, {c[1].toFixed(5)}</div>
                  ))}
                </div>
              </div>
            </div>
            <button className="btn btn-primary btn-sm mt-2" style={{ width: '100%' }} onClick={() => go('nueva')}>
              <IcoLeaf /> Solicitar análisis para esta zona
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ k, v }) {
  return (
    <div className="spread">
      <span className="muted">{k}</span>
      <span style={{ fontWeight: 600, fontSize: 13 }}>{v}</span>
    </div>
  )
}
