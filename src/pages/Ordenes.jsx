import { useEffect, useMemo, useState } from 'react'
import { IcoArrow, IcoCalendar, IcoCheck, IcoOrders, IcoPlus, IcoShield, IcoUsers } from '../components/Icons.jsx'
import ServiceWorkflowModal from '../components/ServiceWorkflowModal.jsx'
import ServiceEditModal from '../components/ServiceEditModal.jsx'
import { api } from '../data/api.js'
import { orderWarning } from '../utils/orderWarnings.js'

const STATUS = {
  pending: { label: 'Pendiente de aprobación', className: 'recibido' },
  accepted: { label: 'Aceptado', className: 'laboratorio' },
  in_progress: { label: 'En proceso', className: 'analisis' },
  completed: { label: 'Completado', className: 'listo' },
  rejected: { label: 'Rechazado', className: 'rejected' },
}

const FILTERS = [
  ['all', 'Todos'],
  ['pending', 'Por aprobar'],
  ['accepted', 'Aceptados'],
  ['in_progress', 'En proceso'],
  ['completed', 'Completados'],
]

function deadlineInfo(value) {
  if (!value) return null
  const hours = Math.ceil((new Date(value).getTime() - Date.now()) / 3_600_000)
  if (hours <= 0) return { tone: 'overdue', label: `Venció hace ${Math.max(1, Math.ceil(Math.abs(hours) / 24))} día${Math.abs(hours) > 24 ? 's' : ''}` }
  if (hours <= 48) return { tone: 'due-soon', label: hours <= 24 ? `Vence en ${hours} h` : `Vence en ${Math.ceil(hours / 24)} días` }
  return null
}

export default function Ordenes({ go, notify, user }) {
  const isAdmin = user.role === 'admin'
  const canAssignAnalysts = isAdmin && ['antoniog@aslaboratorios.com', 'aespinales@aslaboratorios.com'].includes(String(user.email || '').toLowerCase())
  const [services, setServices] = useState([])
  const [trashedServices, setTrashedServices] = useState([])
  const [analysts, setAnalysts] = useState([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(null)
  const [error, setError] = useState('')
  const [selectedService, setSelectedService] = useState(null)
  const [editingService, setEditingService] = useState(null)
  const [assignmentTarget, setAssignmentTarget] = useState(null)
  const [assignmentIds, setAssignmentIds] = useState([])
  const [trashTarget, setTrashTarget] = useState(null)
  const [trashReason, setTrashReason] = useState('')

  const load = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      if (isAdmin) {
        const [result, trashResult, analystResult] = await Promise.all([
          api.services(),
          api.trashedServices(),
          canAssignAnalysts ? api.analysts() : Promise.resolve({ analysts: [] }),
        ])
        setServices(result.services)
        setTrashedServices(trashResult.services || [])
        setAnalysts((analystResult.analysts || []).filter((analyst) => analyst.status === 'active' && !analyst.biotechnology_access))
      } else {
        const result = await api.services()
        setServices(result.services)
      }
      setError('')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    const interval = setInterval(() => load(true), 10000)
    return () => clearInterval(interval)
  }, [isAdmin, canAssignAnalysts])

  const visible = useMemo(() => {
    if (filter === 'trash') return trashedServices
    return filter === 'all' ? services : services.filter((service) => service.status === filter)
  }, [filter, services, trashedServices])

  const summary = useMemo(() => ({
    pending: services.filter((service) => service.status === 'pending').length,
    active: services.filter((service) => ['accepted', 'in_progress'].includes(service.status)).length,
    completed: services.filter((service) => service.status === 'completed').length,
  }), [services])

  const update = async (service, status) => {
    setUpdating(service.id)
    try {
      await api.updateService(service.id, status)
      await load()
      notify(status === 'accepted' ? 'Solicitud aceptada. El servicio ya está activo.' : 'Estado del servicio actualizado.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setUpdating(null)
    }
  }

  const openAssignment = (service) => {
    setAssignmentTarget(service)
    setAssignmentIds((service.assigned_analysts || []).map((analyst) => analyst.id))
    setError('')
  }

  const saveAssignment = async (event) => {
    event.preventDefault()
    setUpdating(assignmentTarget.id)
    setError('')
    try {
      await api.assignServiceAnalysts(assignmentTarget.id, assignmentIds)
      await load()
      setAssignmentTarget(null)
      notify(assignmentIds.length ? 'Equipo de analistas actualizado.' : 'El servicio quedó sin analistas asignados.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setUpdating(null)
    }
  }

  const sendToTrash = async (event) => {
    event.preventDefault()
    setUpdating(trashTarget.id)
    setError('')
    try {
      await api.trashService(trashTarget.id, trashReason)
      if (selectedService?.id === trashTarget.id) setSelectedService(null)
      await load()
      setTrashTarget(null)
      setTrashReason('')
      notify('Servicio enviado a la papelera. Sus datos y documentos se conservaron.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setUpdating(null)
    }
  }

  const restore = async (service) => {
    setUpdating(service.id)
    setError('')
    try {
      await api.restoreService(service.id)
      await load()
      notify('Servicio restaurado con todas sus etapas, archivos y asignaciones.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setUpdating(null)
    }
  }

  return (
    <div className="services-page">
      <section className="services-heading orders-command-hero anim-in d1">
        <div className="orders-command-copy">
          <span className="eyebrow">{isAdmin ? 'Bandeja administrativa' : 'Servicios AS Labs'}</span>
          <h1>{isAdmin ? 'Solicitudes y servicios' : 'Mis solicitudes'}</h1>
          <p>
            {isAdmin
              ? 'Aprueba las solicitudes de clientes o crea un servicio directamente.'
              : 'Solicita un análisis y consulta aquí la decisión del equipo de AS Laboratorios.'}
          </p>
        </div>
        <div className="orders-command-side">
          <div className="orders-command-stats" aria-label="Resumen de órdenes">
            <div><strong>{summary.pending}</strong><span>Por aprobar</span></div>
            <div><strong>{summary.active}</strong><span>En curso</span></div>
            <div><strong>{summary.completed}</strong><span>Finalizadas</span></div>
          </div>
          <button className="btn btn-accent orders-create-button" onClick={() => go('nueva')}>
            <IcoPlus /> {isAdmin ? 'Crear servicio' : 'Solicitar servicio'}
          </button>
        </div>
      </section>

      <div className="services-toolbar anim-in d2">
        <div className="row" style={{ gap: 7, flexWrap: 'wrap' }}>
          {FILTERS.map(([id, label]) => (
            <button key={id} className={`btn btn-sm ${filter === id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter(id)}>
              {label}
              {id !== 'all' && services.filter((service) => service.status === id).length > 0 && (
                <span className="filter-count">{services.filter((service) => service.status === id).length}</span>
              )}
            </button>
          ))}
          {isAdmin && (
            <button className={`btn btn-sm ${filter === 'trash' ? 'btn-primary' : 'btn-ghost'} trash-filter`} onClick={() => setFilter('trash')}>
              Papelera
              {trashedServices.length > 0 && <span className="filter-count">{trashedServices.length}</span>}
            </button>
          )}
        </div>
        <span className="services-total">{visible.length} {visible.length === 1 ? 'registro' : 'registros'}</span>
      </div>

      {error && <div className="form-error">{error}</div>}

      {loading ? (
        <div className="card services-loading">Cargando servicios…</div>
      ) : visible.length === 0 ? (
        <section className="card services-empty anim-in d3">
          <span className="services-empty-icon"><IcoOrders /></span>
          <span className="eyebrow">Sin registros</span>
          <h2>{filter === 'trash' ? 'La papelera está vacía' : isAdmin ? 'No hay solicitudes pendientes' : 'Aún no tienes servicios'}</h2>
          <p>
            {filter === 'trash'
              ? 'Los servicios enviados aquí se conservan como respaldo hasta que decidas restaurarlos.'
              : isAdmin
              ? 'Cuando un cliente solicite un servicio aparecerá aquí para que puedas aceptarlo o rechazarlo.'
              : 'Tu cuenta está lista. Envía tu primera solicitud cuando necesites un análisis.'}
          </p>
          {filter !== 'trash' && <button className="btn btn-primary" onClick={() => go('nueva')}>
            <IcoPlus /> {isAdmin ? 'Crear servicio para un cliente' : 'Solicitar mi primer servicio'}
          </button>}
        </section>
      ) : (
        <section className="services-list anim-in d3">
          {visible.map((service) => {
            const status = STATUS[service.status] || STATUS.pending
            const deadline = deadlineInfo(service.sample_due_at)
            const warning = orderWarning(service, { internal: isAdmin })
            return (
              <article className={`card service-request-card order-glass-card ${filter === 'trash' ? 'archived' : service.status} ${isAdmin && deadline ? deadline.tone : ''}`} key={service.id}>
                <header className="service-card-identity">
                  <div className="service-code">{service.code}</div>
                  <span className={`badge ${filter === 'trash' ? 'archived' : status.className}`}>{filter === 'trash' ? 'En papelera' : status.label}</span>
                </header>
                <div className="service-request-main">
                  <div>
                    <h3>{service.service_type_name}</h3>
                    <p>{service.zone_name} · {service.sample_count} {service.sample_count === 1 ? 'muestra' : 'muestras'}</p>
                    {(service.service_items?.length || 0) > 1 && (
                      <div className="service-analysis-pills">
                        {service.service_items.slice(0, 3).map((item) => <span key={item.id}>{item.name}</span>)}
                        {service.service_items.length > 3 && <span>+{service.service_items.length - 3}</span>}
                      </div>
                    )}
                    {isAdmin && <span className="service-client">{service.client_name} · {service.client_company}</span>}
                    {isAdmin && deadline && !warning && <div className={`service-deadline-flag ${deadline.tone}`}><IcoCalendar /><span><strong>{deadline.label}</strong><small>{service.pending_samples} muestra{service.pending_samples === 1 ? '' : 's'} pendiente{service.pending_samples === 1 ? '' : 's'} · {new Date(service.sample_due_at).toLocaleString('es-PE')}</small></span></div>}
                    {warning && <div className={`service-smart-warning ${warning.tone}`}><IcoShield /><span><strong>{warning.title}</strong><small>{warning.detail}</small></span></div>}
                    {isAdmin && filter !== 'trash' && (
                      <div className={`service-assigned-team ${(service.assigned_analysts || []).length ? '' : 'empty'}`}>
                        <IcoUsers />
                        <span>{(service.assigned_analysts || []).length
                          ? service.assigned_analysts.map((analyst) => analyst.fullName).join(', ')
                          : 'Sin analistas asignados'}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="service-card-facts">
                  <div className="service-request-meta">
                    <span>Prioridad</span>
                    <strong>{service.priority}</strong>
                  </div>
                  <div className="service-request-meta">
                    <span>{filter === 'trash' ? 'Archivado' : 'Solicitado'}</span>
                    <strong>{new Date(filter === 'trash' ? service.archived_at : service.requested_at).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' })}</strong>
                  </div>
                </div>
                {filter === 'trash' ? (
                  <div className="service-actions service-actions-stack">
                    <small>{service.archive_reason || 'Sin motivo registrado'}</small>
                    <button className="btn btn-primary btn-sm" disabled={updating === service.id} onClick={() => restore(service)}>Restaurar servicio</button>
                  </div>
                ) : isAdmin ? (
                  <div className="service-actions service-actions-wrap">
                    {service.status === 'pending' && <>
                      <button className="btn btn-ghost btn-sm" disabled={updating === service.id} onClick={() => update(service, 'rejected')}>Rechazar</button>
                      <button className="btn btn-primary btn-sm" disabled={updating === service.id} onClick={() => update(service, 'accepted')}><IcoCheck /> Aceptar</button>
                    </>}
                    {['accepted', 'in_progress', 'completed'].includes(service.status) && (
                      <button className="btn btn-primary btn-sm" onClick={() => setSelectedService(service)}>Gestionar etapas <IcoArrow /></button>
                    )}
                    <button className="btn btn-ghost btn-sm service-full-edit-button" onClick={() => setEditingService(service)}>Editar orden completa</button>
                    {canAssignAnalysts && <button className="btn btn-ghost btn-sm" onClick={() => openAssignment(service)}><IcoUsers /> Asignar analistas</button>}
                    <button className="service-trash-link" onClick={() => { setTrashTarget(service); setTrashReason(''); setError('') }}>Enviar a papelera</button>
                  </div>
                ) : ['accepted', 'in_progress', 'completed'].includes(service.status) ? (
                  <div className="service-actions">
                    <button className="btn btn-primary btn-sm" onClick={() => setSelectedService(service)}>Ver seguimiento <IcoArrow /></button>
                  </div>
                ) : <div className="service-actions service-actions-empty" />}
              </article>
            )
          })}
        </section>
      )}

      {selectedService && (
        <ServiceWorkflowModal
          service={selectedService}
          user={user}
          notify={notify}
          onChanged={load}
          onEditService={(item) => { setSelectedService(null); setEditingService(item) }}
          onClose={() => setSelectedService(null)}
        />
      )}

      {editingService && <ServiceEditModal service={editingService} canAssignAnalysts={canAssignAnalysts} analysts={analysts} notify={notify} onClose={() => setEditingService(null)} onSaved={load} />}

      {assignmentTarget && (
        <div className="modal-overlay" onClick={() => setAssignmentTarget(null)}>
          <form className="modal service-assignment-modal" onSubmit={saveAssignment} onClick={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <span className="modal-icon"><IcoUsers /></span>
              <div>
                <span className="eyebrow">{assignmentTarget.code}</span>
                <h2>Analistas del servicio</h2>
                <p>Selecciona uno o varios. Cualquiera de ellos podrá trabajar en todas las etapas de este código.</p>
              </div>
            </div>
            <div className="assignment-summary-bar">
              <div><strong>{assignmentIds.length}</strong><span>{assignmentIds.length === 1 ? 'analista asignado' : 'analistas asignados'}</span></div>
              {assignmentIds.length > 0 && <button type="button" onClick={() => setAssignmentIds([])}>Quitar todos</button>}
            </div>
            <div className="service-analyst-grid service-analyst-modal-grid">
              {analysts.map((analyst) => {
                const selected = assignmentIds.includes(analyst.id)
                return <label className={selected ? 'selected' : ''} key={analyst.id}>
                  <input type="checkbox" checked={selected} onChange={() => setAssignmentIds((current) => selected ? current.filter((id) => id !== analyst.id) : [...current, analyst.id])} />
                  <span>{analyst.full_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('')}</span>
                  <div><strong>{analyst.full_name}</strong><small>{analyst.specialty || 'Operaciones de laboratorio'}</small></div>
                  <i>{selected ? <IcoCheck /> : '+'}</i>
                </label>
              })}
              {!analysts.length && <div className="assignment-empty">No hay analistas operativos activos. Puedes crearlos desde “Analistas”.</div>}
            </div>
            {error && <div className="form-error">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setAssignmentTarget(null)}>Cancelar</button>
              <button className="btn btn-primary" disabled={updating === assignmentTarget.id}>{updating === assignmentTarget.id ? 'Guardando…' : 'Guardar equipo'}</button>
            </div>
          </form>
        </div>
      )}

      {trashTarget && (
        <div className="modal-overlay" onClick={() => setTrashTarget(null)}>
          <form className="modal service-trash-modal" onSubmit={sendToTrash} onClick={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <span className="modal-icon warning"><IcoShield /></span>
              <div>
                <span className="eyebrow">Respaldo reversible</span>
                <h2>Enviar servicio a la papelera</h2>
                <p>{trashTarget.code} · {trashTarget.service_type_name}</p>
              </div>
            </div>
            <div className="trash-safety-note"><IcoShield /><div><strong>No se eliminará ningún dato</strong><span>Se conservarán las etapas, PDFs, fotos, analistas, cuadrillas y el historial completo. Podrás restaurarlo cuando quieras.</span></div></div>
            <label className="field mt-2"><span>Motivo (opcional)</span><textarea rows="3" maxLength="300" value={trashReason} onChange={(event) => setTrashReason(event.target.value)} placeholder="Ej. Servicio duplicado o archivado temporalmente" /></label>
            {error && <div className="form-error">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setTrashTarget(null)}>Cancelar</button>
              <button className="btn btn-danger-soft" disabled={updating === trashTarget.id}>{updating === trashTarget.id ? 'Enviando…' : 'Enviar a papelera'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
