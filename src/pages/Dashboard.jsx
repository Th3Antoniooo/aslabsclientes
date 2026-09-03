import { useEffect, useMemo, useState } from 'react'
import { IcoArrow, IcoCalendar, IcoCheck, IcoDna, IcoDrop, IcoFile, IcoLeaf, IcoLocation, IcoMap, IcoPlus, IcoShield, IcoUsers } from '../components/Icons.jsx'
import ServiceWorkflowModal from '../components/ServiceWorkflowModal.jsx'
import { api } from '../data/api.js'
import banner from '../assets/aslabs-banner.webp'

const STATUS_LABEL = {
  pending: 'Pendiente de aprobación',
  accepted: 'Aceptado',
  in_progress: 'En proceso',
  completed: 'Completado',
  rejected: 'Rechazado',
}

const CREW_STATE_LABEL = {
  available: 'Disponible',
  at_laboratory: 'En sede del laboratorio',
  en_route: 'En ruta',
  sampling: 'Realizando muestreo',
  applying: 'Realizando aplicación',
  returning: 'Retornando al laboratorio',
  paused: 'En pausa',
}

const CREW_FUNCTION_LABEL = {
  sampling: 'Muestreo',
  application: 'Aplicación',
  logistics: 'Logística',
  laboratory: 'Laboratorio',
}

function serviceProgress(service) {
  const totalStages = Number(service.total_stages || 0)
  if (service.status === 'completed') return 100
  if (!totalStages) return 0
  return Math.min(95, Math.round(((Number(service.current_stage_position || 0) + 1) / totalStages) * 100))
}

function formatShortDate(value) {
  if (!value) return 'Sin fecha'
  return new Date(value).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' })
}

function ClientServiceCard({ service, prominent = false, onOpen, go }) {
  const progress = serviceProgress(service)
  const isPending = service.status === 'pending'
  const analyses = service.service_items || []
  const open = () => isPending ? go('ordenes') : onOpen(service)

  return (
    <article className={`client-priority-card ${isPending ? 'pending' : 'active'} ${prominent ? 'prominent' : ''}`}>
      <div className="client-priority-top">
        <span className="service-code">{service.code}</span>
        <span className={`badge ${service.status === 'completed' ? 'listo' : isPending ? 'recibido' : 'analisis'}`}>
          {STATUS_LABEL[service.status] || service.status}
        </span>
      </div>
      <div className="client-priority-main">
        <div>
          <h3>{service.service_type_name}</h3>
          <p><IcoLocation /> {service.zone_name || 'Sede por confirmar'} <span>·</span> {service.sample_count || 0} {Number(service.sample_count) === 1 ? 'muestra' : 'muestras'}</p>
        </div>
        {!isPending && (
          <div className="client-progress-orb" style={{ '--service-progress': `${progress * 3.6}deg` }}>
            <div><strong>{progress}%</strong><span>avance</span></div>
          </div>
        )}
      </div>
      {analyses.length > 0 && (
        <div className="client-analysis-chips" aria-label="Análisis incluidos">
          {analyses.slice(0, 3).map((item) => <span key={item.id || item.name}>{item.name}</span>)}
          {analyses.length > 3 && <span>+{analyses.length - 3} más</span>}
        </div>
      )}
      {isPending ? (
        <div className="client-pending-message">
          <span><IcoCalendar /></span>
          <div><strong>Solicitud enviada</strong><p>AS Labs está revisando la información para iniciar el servicio.</p></div>
        </div>
      ) : (
        <>
          <div className="client-current-stage-row">
            <span>Etapa actual</span>
            <strong>{service.current_stage_title || (service.status === 'completed' ? 'Servicio finalizado' : 'Preparando flujo')}</strong>
          </div>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
        </>
      )}
      <footer>
        <span>Actualizado {formatShortDate(service.updated_at)}</span>
        <button className={`btn ${prominent ? 'btn-primary' : 'btn-ghost'} btn-sm`} onClick={open}>
          {isPending ? 'Ver solicitud' : 'Ver trazabilidad'} <IcoArrow />
        </button>
      </footer>
    </article>
  )
}

function ClientCrewStatus({ crews, go }) {
  return (
    <section className="dashboard-crew-status client-dashboard-crew anim-in d5">
      <header>
        <div className="dashboard-crew-title">
          <span className="dashboard-crew-icon"><IcoMap /></span>
          <div>
            <span className="eyebrow">Estado de la cuadrilla de muestreo</span>
            <h2>{crews.length ? 'Operación de campo asignada' : 'Sin operación de campo asignada'}</h2>
            <p>Ubicación, función y personal relacionado con tus servicios.</p>
          </div>
        </div>
        <button className="btn btn-white" onClick={() => go('tracking')}>Abrir mapa en vivo <IcoArrow /></button>
      </header>
      {crews.length > 0 ? (
        <div className="dashboard-crew-grid">
          {crews.map((crew) => {
            const assignment = crew.assignments?.[0]
            const functions = [...new Set((crew.assignments || []).map((item) => CREW_FUNCTION_LABEL[item.assignmentType] || item.assignmentType))]
            return (
              <article key={crew.id}>
                <div className="dashboard-crew-avatar">
                  {crew.members?.length
                    ? crew.members.slice(0, 2).map((member) => member.initials?.[0]).join('')
                    : crew.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('')}
                  <span />
                </div>
                <div className="dashboard-crew-main">
                  <span>{functions.join(' + ') || 'Equipo de campo'}</span>
                  <h3>{crew.name}</h3>
                  <p>{assignment?.serviceName || 'Servicio por confirmar'}</p>
                </div>
                <div className="dashboard-crew-location">
                  <span><IcoLocation /> Ubicación actual</span>
                  <strong>{crew.current_site_name || crew.home_laboratory_name || 'Actualización pendiente'}</strong>
                </div>
                <div className="dashboard-crew-state">
                  <i />
                  <span>{crew.status_text || CREW_STATE_LABEL[crew.operational_state] || crew.operational_state}</span>
                </div>
                <button className="dashboard-crew-map-link" onClick={() => go('tracking')}>Ver ubicación <IcoArrow /></button>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="dashboard-crew-empty">
          <IcoLocation />
          <div><strong>Aún no hay una cuadrilla vinculada</strong><span>Cuando AS Laboratorios asigne un equipo, aparecerá aquí automáticamente.</span></div>
        </div>
      )}
    </section>
  )
}

function ClientDashboard({ go, user, services, crews, counts, loading, selectedService, setSelectedService, notify }) {
  const pendingServices = services.filter((service) => service.status === 'pending')
  const activeServices = services.filter((service) => ['accepted', 'in_progress'].includes(service.status))
  const completedServices = services.filter((service) => service.status === 'completed')
  const hasWork = pendingServices.length > 0 || activeServices.length > 0

  return (
    <div className="client-dashboard">
      <section className="client-dashboard-hero anim-in d1">
        <div className="client-hero-copy">
          <div className="client-hero-eyebrow-row">
            <span className="eyebrow">Portal de clientes AS Labs</span>
            <span className="client-sync-note"><i /> Información sincronizada</span>
          </div>
          <h1>Hola, {(user.nombre || 'bienvenido').split(' ')[0]}.</h1>
          <p>{hasWork ? 'Tus solicitudes y servicios en marcha, organizados para que sepas qué sigue en cada momento.' : 'Todo listo para gestionar tus próximos análisis y consultar sus resultados.'}</p>
          <div className="client-hero-actions">
            <button className="btn btn-accent" onClick={() => go('nueva')}><IcoPlus /> Solicitar servicio</button>
            <button className="btn btn-white" onClick={() => go('ordenes')}>Ver todos mis servicios <IcoArrow /></button>
          </div>
        </div>
        <div className="client-overview-panel">
          <div className={counts.pending ? 'attention' : ''}>
            <span>Pendientes</span><strong>{loading ? '—' : counts.pending}</strong><small>{counts.pending ? 'En revisión' : 'Todo al día'}</small>
          </div>
          <div><span>En marcha</span><strong>{loading ? '—' : counts.active}</strong><small>Con seguimiento</small></div>
          <div><span>Completados</span><strong>{loading ? '—' : counts.completed}</strong><small>Historial disponible</small></div>
        </div>
      </section>

      <section className="client-priority-section anim-in d2">
        <header className="client-priority-head">
          <div>
            <span className="eyebrow">Lo principal</span>
            <h2>{pendingServices.length ? 'Servicios pendientes de atención' : activeServices.length ? 'Servicios actualmente en marcha' : 'No tienes servicios pendientes'}</h2>
            <p>{pendingServices.length ? 'Estas solicitudes ya fueron enviadas y están siendo revisadas por el laboratorio.' : activeServices.length ? 'Consulta el avance y abre la trazabilidad completa sin salir del dashboard.' : 'Cuando envíes una solicitud aparecerá aquí en primer lugar.'}</p>
          </div>
          <span className={`client-priority-count ${pendingServices.length ? 'has-pending' : ''}`}><strong>{pendingServices.length}</strong> pendientes</span>
        </header>

        {pendingServices.length > 0 && (
          <div className="client-priority-grid pending-grid">
            {pendingServices.map((service) => <ClientServiceCard key={service.id} service={service} prominent go={go} onOpen={setSelectedService} />)}
          </div>
        )}

        {pendingServices.length === 0 && activeServices.length === 0 && (
          <div className="client-all-clear">
            <span><IcoCheck /></span>
            <div><strong>Todo al día</strong><p>No hay solicitudes esperando revisión ni servicios actualmente en proceso.</p></div>
            <button className="btn btn-primary" onClick={() => go('nueva')}>Solicitar un servicio <IcoArrow /></button>
          </div>
        )}

        {activeServices.length > 0 && (
          <div className="client-active-block">
            {pendingServices.length > 0 && <div className="client-section-divider"><span>Servicios en marcha</span><small>{activeServices.length} activos</small></div>}
            <div className="client-priority-grid active-grid">
              {activeServices.map((service, index) => <ClientServiceCard key={service.id} service={service} prominent={pendingServices.length === 0 && index === 0} go={go} onOpen={setSelectedService} />)}
            </div>
          </div>
        )}
      </section>

      <section className="client-dashboard-shortcuts anim-in d4">
        <button onClick={() => go('ordenes')}><span><IcoDna /></span><div><strong>Todos mis servicios</strong><small>Solicitudes, activos y completados</small></div><IcoArrow /></button>
        <button onClick={() => go('resultados')}><span><IcoFile /></span><div><strong>Informes finales</strong><small>{completedServices.length ? `${completedServices.length} ${completedServices.length === 1 ? 'servicio completado' : 'servicios completados'}` : 'Aún no hay informes publicados'}</small></div><IcoArrow /></button>
        <button onClick={() => go('tracking')}><span><IcoMap /></span><div><strong>Mapa de cuadrillas</strong><small>{crews.length ? `${crews.length} ${crews.length === 1 ? 'equipo asignado' : 'equipos asignados'}` : 'Sin equipos asignados'}</small></div><IcoArrow /></button>
      </section>

      <ClientCrewStatus crews={crews} go={go} />

      {completedServices.length > 0 && (
        <section className="client-completed-strip anim-in d5">
          <div><span className="eyebrow">Historial</span><h2>Servicios completados</h2><p>Revisa trazabilidad, evidencias e informes disponibles.</p></div>
          <div className="client-completed-list">
            {completedServices.slice(0, 3).map((service) => (
              <button key={service.id} onClick={() => setSelectedService(service)}>
                <span><IcoCheck /></span><div><strong>{service.service_type_name}</strong><small>{service.code} · {formatShortDate(service.updated_at)}</small></div><IcoArrow />
              </button>
            ))}
          </div>
          <button className="btn btn-ghost" onClick={() => go('ordenes')}>Ver historial completo</button>
        </section>
      )}

      {selectedService && (
        <ServiceWorkflowModal
          service={selectedService}
          user={user}
          onClose={() => setSelectedService(null)}
          notify={notify || (() => {})}
        />
      )}
    </div>
  )
}

export default function Dashboard({ go, user, notify }) {
  const isAdmin = user.role === 'admin'
  const [services, setServices] = useState([])
  const [userCount, setUserCount] = useState(0)
  const [crews, setCrews] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedService, setSelectedService] = useState(null)

  useEffect(() => {
    let active = true
    Promise.all([
      api.services(),
      isAdmin ? api.users() : Promise.resolve({ users: [] }),
      isAdmin ? Promise.resolve({ crews: [] }) : api.tracking().catch(() => ({ crews: [] })),
    ]).then(([serviceData, userData, trackingData]) => {
      if (!active) return
      setServices(serviceData.services)
      setUserCount(userData.users.filter((account) => account.status === 'active').length)
      setCrews(trackingData.crews || [])
    }).catch(() => {}).finally(() => active && setLoading(false))
    return () => { active = false }
  }, [isAdmin])

  useEffect(() => {
    if (isAdmin) return undefined
    let active = true
    const interval = setInterval(() => {
      Promise.all([api.tracking(), api.services()])
        .then(([trackingResult, serviceResult]) => {
          if (!active) return
          setCrews(trackingResult.crews || [])
          setServices(serviceResult.services || [])
        })
        .catch(() => {})
    }, 10000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [isAdmin])

  const counts = useMemo(() => ({
    pending: services.filter((service) => service.status === 'pending').length,
    active: services.filter((service) => ['accepted', 'in_progress'].includes(service.status)).length,
    completed: services.filter((service) => service.status === 'completed').length,
  }), [services])

  const stats = isAdmin
    ? [
      { k: 'Solicitudes por aprobar', v: counts.pending, d: counts.pending ? 'Requieren decisión' : 'Bandeja al día', ico: <IcoLeaf /> },
      { k: 'Servicios activos', v: counts.active, d: 'De todos los clientes', ico: <IcoLocation /> },
      { k: 'Servicios completados', v: counts.completed, d: 'Histórico real', ico: <IcoDrop /> },
      { k: 'Usuarios activos', v: userCount, d: 'Administradores y clientes', ico: <IcoUsers /> },
    ]
    : [
      { k: 'Solicitudes pendientes', v: counts.pending, d: counts.pending ? 'En revisión por AS Labs' : 'Sin solicitudes', ico: <IcoLeaf /> },
      { k: 'Servicios activos', v: counts.active, d: counts.active ? 'En atención' : 'Sin servicios', ico: <IcoLocation /> },
      { k: 'Servicios completados', v: counts.completed, d: counts.completed ? 'Con historial disponible' : 'Sin resultados', ico: <IcoDrop /> },
      { k: 'Informes disponibles', v: counts.completed, d: counts.completed ? 'Trazabilidad descargable' : 'Sin informes', ico: <IcoArrow /> },
    ]

  if (!isAdmin) {
    return (
      <ClientDashboard
        go={go}
        user={user}
        services={services}
        crews={crews}
        counts={counts}
        loading={loading}
        selectedService={selectedService}
        setSelectedService={setSelectedService}
        notify={notify}
      />
    )
  }

  const recentServices = services.slice(0, 3)

  return (
    <div>
      <section className="dashboard-hero anim-in d1">
        <img src={banner} alt="" />
        <div className="dashboard-hero-overlay" />
        <div className="dashboard-hero-content">
          <div className="eyebrow">{isAdmin ? 'Centro administrativo AS Labs' : 'Portal de clientes AS Labs'}</div>
          <h1>Hola, {(user.nombre || 'bienvenido').split(' ')[0]}.</h1>
          <p>
            {isAdmin
              ? 'Administra clientes, revisa solicitudes y crea servicios sin mezclar tu cuenta con la información de un cliente.'
              : services.length
                ? 'Consulta en un vistazo el estado, avance y siguiente etapa de todos tus servicios.'
                : 'Tu cuenta comienza sin servicios. Cuando lo necesites, envía una solicitud al equipo de AS Laboratorios.'}
          </p>
          <div className="row hero-actions">
            {isAdmin ? (
              <>
                <button className="btn btn-accent" onClick={() => go('accesos')}><IcoUsers /> Administrar usuarios</button>
                <button className="btn btn-white" onClick={() => go('ordenes')}><IcoCheck /> Revisar solicitudes</button>
              </>
            ) : (
              <button className="btn btn-accent" onClick={() => go('nueva')}><IcoPlus /> Solicitar servicio</button>
            )}
          </div>
        </div>
        <div className="hero-status-card">
          <span className={`status-dot ${services.length === 0 ? 'idle' : ''}`} />
          <div>
            <strong>{loading ? 'Consultando información…' : services.length === 0 ? 'Sin servicios registrados' : `${services.length} registros`}</strong>
            <small>{isAdmin ? 'Vista general, no cuenta de cliente' : services.length ? 'Resumen actualizado de tu cuenta' : 'Puedes solicitar tu primer servicio'}</small>
          </div>
          <button onClick={() => go(isAdmin || services.length ? 'ordenes' : 'nueva')} aria-label={isAdmin || services.length ? 'Ver servicios' : 'Solicitar servicio'}><IcoArrow /></button>
        </div>
      </section>

      {isAdmin && (
        <section className="admin-entry-card anim-in d2">
          <div className="admin-entry-icon"><IcoShield /></div>
          <div className="admin-entry-copy">
            <span className="eyebrow">Administración</span>
            <h2>Gestiona usuarios y accesos</h2>
            <p>Crea cuentas, asigna roles y decide qué módulos puede ver o editar cada perfil.</p>
          </div>
          <div className="admin-entry-features">
            <span><IcoCheck /> Crear usuarios</span>
            <span><IcoCheck /> Configurar roles</span>
            <span><IcoCheck /> Permisos por módulo</span>
          </div>
          <button className="btn btn-primary" onClick={() => go('accesos')}>Abrir administración <IcoArrow /></button>
        </section>
      )}

      <section className="stat-grid mt-2">
        {stats.map((stat, index) => (
          <article key={stat.k} className={`card stat-card anim-in d${index + 2}`}>
            <div className="stat-icon">{stat.ico}</div>
            <div>
              <div className="card-kicker">{stat.k}</div>
              <div className="stat-value">{stat.v}</div>
              <div className="stat-delta">{stat.d}</div>
            </div>
          </article>
        ))}
      </section>

      {!isAdmin && (
        <section className="dashboard-crew-status mt-2 anim-in d4">
          <header>
            <div className="dashboard-crew-title">
              <span className="dashboard-crew-icon"><IcoMap /></span>
              <div>
                <span className="eyebrow">Estado de la cuadrilla de muestreo</span>
                <h2>{crews.length ? 'Operación de campo asignada' : 'Sin operación de campo asignada'}</h2>
                <p>Ubicación, función y personal relacionado con tus servicios.</p>
              </div>
            </div>
            <button className="btn btn-white" onClick={() => go('tracking')}>Abrir mapa en vivo <IcoArrow /></button>
          </header>
          {crews.length > 0 ? (
            <div className="dashboard-crew-grid">
              {crews.map((crew) => {
                const assignment = crew.assignments?.[0]
                const functions = [...new Set((crew.assignments || []).map((item) => CREW_FUNCTION_LABEL[item.assignmentType] || item.assignmentType))]
                return (
                  <article key={crew.id}>
                    <div className="dashboard-crew-avatar">
                      {crew.members?.length
                        ? crew.members.slice(0, 2).map((member) => member.initials?.[0]).join('')
                        : crew.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('')}
                      <span />
                    </div>
                    <div className="dashboard-crew-main">
                      <span>{functions.join(' + ') || 'Equipo de campo'}</span>
                      <h3>{crew.name}</h3>
                      <p>{assignment?.serviceName || 'Servicio por confirmar'}</p>
                    </div>
                    <div className="dashboard-crew-location">
                      <span><IcoLocation /> Ubicación actual</span>
                      <strong>{crew.current_site_name || crew.home_laboratory_name || 'Actualización pendiente'}</strong>
                    </div>
                    <div className="dashboard-crew-state">
                      <i />
                      <span>{crew.status_text || CREW_STATE_LABEL[crew.operational_state] || crew.operational_state}</span>
                    </div>
                    <button className="dashboard-crew-map-link" onClick={() => go('tracking')}>Ver ubicación <IcoArrow /></button>
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="dashboard-crew-empty">
              <IcoLocation />
              <div><strong>Aún no hay una cuadrilla vinculada</strong><span>Cuando AS Laboratorios asigne un equipo de muestreo o aplicación, aparecerá aquí automáticamente.</span></div>
            </div>
          )}
        </section>
      )}

      {!isAdmin && services.length > 0 ? (
        <section className="client-summary mt-2 anim-in d5">
          <header className="client-summary-head">
            <div>
              <span className="eyebrow">Resumen de mis servicios</span>
              <h2>Actividad reciente</h2>
              <p>Estado actual, avance operativo y última actualización de tus análisis.</p>
            </div>
            <button className="btn btn-ghost" onClick={() => go('ordenes')}>Ver todos <IcoArrow /></button>
          </header>
          <div className="client-service-grid">
            {recentServices.map((service) => {
              const totalStages = Number(service.total_stages || 0)
              const progress = service.status === 'completed'
                ? 100
                : totalStages
                  ? Math.min(95, Math.round(((Number(service.current_stage_position || 0) + 1) / totalStages) * 100))
                  : 0
              return (
                <article className="card client-service-card" key={service.id}>
                  <div className="client-service-top">
                    <span className="service-code">{service.code}</span>
                    <span className={`badge ${service.status === 'completed' ? 'listo' : service.status === 'pending' ? 'recibido' : 'analisis'}`}>
                      {STATUS_LABEL[service.status]}
                    </span>
                  </div>
                  <h3>{service.service_type_name}</h3>
                  <p>{service.zone_name} · {service.sample_count} {service.sample_count === 1 ? 'muestra' : 'muestras'}</p>
                  <div className="client-service-stage">
                    <span>{service.current_stage_title || (service.status === 'pending' ? 'Esperando aprobación' : 'Preparando flujo')}</span>
                    <strong>{progress}%</strong>
                  </div>
                  <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
                  <footer>
                    <span>Actualizado {new Date(service.updated_at).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })}</span>
                    <button className="text-link" onClick={() => go('ordenes')}>Abrir seguimiento</button>
                  </footer>
                </article>
              )
            })}
          </div>
        </section>
      ) : (
        <section className="card dashboard-empty-panel mt-2 anim-in d4">
          <span className="dashboard-empty-icon">{isAdmin ? <IcoCheck /> : <IcoDna />}</span>
          <span className="eyebrow">{isAdmin ? 'Bandeja de solicitudes' : 'Estado inicial'}</span>
          <h2>
            {services.length === 0
              ? isAdmin ? 'No hay solicitudes ni servicios' : 'Tu cuenta todavía no tiene servicios'
              : 'Hay actividad para revisar'}
          </h2>
          <p>
            {services.length === 0
              ? isAdmin
                ? 'Cuando Maxim u otro cliente envíe una solicitud, aparecerá aquí para aceptarla o rechazarla.'
                : 'No hemos añadido datos de demostración. Todo lo que aparezca desde ahora corresponderá a solicitudes reales.'
              : 'Abre la bandeja para ver el detalle y el estado de cada registro.'}
          </p>
          <button className="btn btn-primary" onClick={() => go(services.length || isAdmin ? 'ordenes' : 'nueva')}>
            {services.length || isAdmin ? 'Abrir bandeja' : 'Solicitar mi primer servicio'} <IcoArrow />
          </button>
        </section>
      )}
    </div>
  )
}
