import { useEffect, useMemo, useState } from 'react'
import { IcoCalendar, IcoCheck, IcoDna, IcoFile, IcoLocation, IcoShield } from '../components/Icons.jsx'
import { api } from '../data/api.js'

const dateTime = (value, fallback = 'Pendiente') => {
  if (!value) return fallback
  return new Date(value).toLocaleString('es-PE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const statusText = {
  accepted: 'Servicio aceptado',
  in_progress: 'En proceso',
  completed: 'Completado',
}

function DnaHelix() {
  return (
    <div className="dna-helix" aria-hidden="true">
      {Array.from({ length: 9 }, (_, index) => (
        <span style={{ '--helix-i': index }} key={index}>
          <i />
          <b />
        </span>
      ))}
    </div>
  )
}

export default function DnaTracking({ user }) {
  const [steps, setSteps] = useState([])
  const [order, setOrder] = useState(null)
  const [orders, setOrders] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const result = await api.dna(selectedId)
        if (!active) return
        setOrder(result.order || null)
        setOrders(result.orders || [])
        setSteps(result.steps || [])
      } catch {
        // Conserva la última lectura válida durante interrupciones breves.
      } finally {
        if (active) setLoaded(true)
      }
    }
    load()
    const interval = setInterval(load, 20000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [selectedId])

  const currentIndex = steps.findIndex((step) => step.state === 'current')
  const completedCount = steps.filter((step) => step.state === 'done').length
  const progress = steps.length
    ? Math.round(((completedCount + (currentIndex >= 0 ? 0.55 : 0)) / steps.length) * 100)
    : 0
  const sampleCount = Number(order?.sample_count || 0)
  const samplePreview = Math.min(sampleCount, 12)
  const activeStep = useMemo(
    () => steps.find((step) => step.state === 'current') || steps.find((step) => step.state === 'pending') || steps.at(-1),
    [steps],
  )
  const evidenceCount = steps.reduce((total, step) => total + Number(step.photoCount || 0), 0)
  const analyst = [...steps].reverse().find((step) => step.analyst)?.analyst
  const responsible = [...steps].reverse().find((step) => step.performedBy)?.performedBy

  if (!loaded) {
    return (
      <div className="card services-loading dna-loading">
        <span className="dna-loading-orbit"><IcoDna /></span>
        Consultando la trazabilidad de DNA…
      </div>
    )
  }

  if (!order) {
    return (
      <section className="card services-empty dna-empty anim-in d1">
        <span className="services-empty-icon"><IcoDna /></span>
        <span className="eyebrow">Extracción de DNA</span>
        <h2>No hay servicios de DNA activos</h2>
        <p>La trazabilidad aparecerá aquí cuando exista una solicitud aceptada y el laboratorio inicie el proceso.</p>
      </section>
    )
  }

  return (
    <div className="dna-page">
      {user.role === 'admin' && orders.length > 1 && (
        <div className="dna-order-switcher anim-in">
          <span>Servicio visualizado</span>
          <select value={order.id} onChange={(event) => setSelectedId(event.target.value)}>
            {orders.map((item) => (
              <option value={item.id} key={item.id}>
                {item.code} · {item.clientCompany || item.clientName}
              </option>
            ))}
          </select>
        </div>
      )}

      <section className="dna-hero dna-hero-vivid anim-in d1">
        <div className="dna-hero-glow dna-hero-glow-one" />
        <div className="dna-hero-glow dna-hero-glow-two" />
        <div className="dna-hero-copy">
          <div className="dna-hero-main">
            <div className="dna-hero-icon"><IcoDna /></div>
            <div>
              <div className="eyebrow">Orden {order.code}</div>
              <h1>Extracción y purificación de DNA</h1>
              <p>Seguimiento verificable de {sampleCount} muestras, desde la solicitud hasta la entrega.</p>
            </div>
          </div>
          <div className="dna-status-row">
            <span className={`dna-live-status ${order.status}`}>
              <i /> {statusText[order.status] || order.status}
            </span>
            <strong>{Math.min(progress, 100)}% trazado</strong>
          </div>
        </div>
        <div className="dna-hero-visual">
          <DnaHelix />
          <span>Proceso biotecnológico</span>
        </div>
        <div className="dna-hero-meta">
          <div><span>Cliente</span><strong>{order.client_company || order.client_name}</strong></div>
          <div><span>Zona de muestreo</span><strong>{order.zone_name}</strong></div>
          <div><span>Muestras</span><strong>{sampleCount} unidades</strong></div>
          <div><span>Prioridad</span><strong className="capitalize">{order.priority}</strong></div>
        </div>
      </section>

      <div className="dna-layout mt-2">
        <section className="card dna-timeline-card anim-in d2">
          <div className="section-head">
            <div>
              <div className="card-kicker">Proceso técnico</div>
              <h2>Trazabilidad paso a paso</h2>
            </div>
            <span className="progress-chip">{completedCount} de {steps.length} completadas</span>
          </div>

          <div className="dna-overall-progress">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${Math.min(progress, 100)}%` }} />
            </div>
            <div className="spread muted"><span>Solicitud</span><strong>{Math.min(progress, 100)}%</strong><span>Entrega</span></div>
          </div>

          <div className="dna-steps">
            {steps.map((step, index) => (
              <article className={`dna-step ${step.state}`} key={step.id}>
                <div className="dna-step-node">
                  {step.state === 'done' ? <IcoCheck /> : <span>{index + 1}</span>}
                </div>
                <div className="dna-step-copy">
                  <strong>{step.title}</strong>
                  <span>{step.detail}</span>
                  <div className="dna-step-evidence">
                    {step.analyst && <span>Analista · {step.analyst}</span>}
                    {step.performedBy && <span>Responsable · {step.performedBy}</span>}
                    {Number(step.photoCount) > 0 && <span>{step.photoCount} foto{Number(step.photoCount) === 1 ? '' : 's'}</span>}
                  </div>
                </div>
                <time>{dateTime(step.completedAt || step.startedAt)}</time>
                <div className="dna-step-actions">
                  {step.state === 'current' && <span className="current-label"><i /> En proceso</span>}
                  <a
                    className="dna-pdf-link"
                    href={`/api/service-workflow?serviceId=${encodeURIComponent(order.id)}&stageId=${encodeURIComponent(step.id)}&format=pdf`}
                    target="_blank"
                    rel="noreferrer"
                    title={`Descargar PDF de ${step.title}`}
                  >
                    <IcoFile /> PDF
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="dna-side">
          <article className="card dna-focus-card anim-in d3">
            <div className="card-kicker">{order.status === 'completed' ? 'Estado del servicio' : 'Etapa activa'}</div>
            <div className="dna-focus-icon"><IcoDna /></div>
            <h2>{order.status === 'completed' ? 'Trazabilidad completada' : activeStep?.title}</h2>
            <p>{order.status === 'completed'
              ? 'El recorrido técnico está disponible por etapa con sus fechas y documentos.'
              : activeStep?.detail}</p>
            <div className="shipment-date">
              <span>Última actualización</span>
              <strong>{dateTime(order.updated_at)}</strong>
            </div>
          </article>

          <article className="card dna-sample-card anim-in d4">
            <div className="section-head">
              <div>
                <div className="card-kicker">Muestras</div>
                <h2>Control del lote</h2>
              </div>
              <span className="sample-total">{sampleCount}</span>
            </div>
            <div className="sample-grid">
              {Array.from({ length: samplePreview }, (_, index) => (
                <div className="sample-tube" key={index}>
                  <span>DNA-{String(index + 1).padStart(2, '0')}</span>
                  <strong>{order.status === 'completed' ? 'Trazada' : index < Math.ceil(samplePreview * progress / 100) ? 'Procesada' : 'En lote'}</strong>
                </div>
              ))}
            </div>
            {sampleCount > samplePreview && <div className="sample-more">+ {sampleCount - samplePreview} muestras dentro del mismo lote</div>}
          </article>

          <article className="card quality-card anim-in d5">
            <div className="section-head">
              <div>
                <div className="card-kicker">Registro técnico</div>
                <h2>Datos del proceso</h2>
              </div>
              <div className="quality-shield"><IcoShield /></div>
            </div>
            <dl className="detail-list">
              <div><dt><IcoLocation /> Zona</dt><dd>{order.zone_name}</dd></div>
              <div><dt><IcoCalendar /> Inicio</dt><dd>{dateTime(order.accepted_at || order.requested_at)}</dd></div>
              <div><dt>Evidencias</dt><dd>{evidenceCount} foto{evidenceCount === 1 ? '' : 's'}</dd></div>
              <div><dt>Analista</dt><dd>{analyst || responsible || 'Por registrar'}</dd></div>
            </dl>
          </article>
        </aside>
      </div>
    </div>
  )
}
