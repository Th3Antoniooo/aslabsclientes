import { useEffect, useMemo, useState } from 'react'
import { IcoCheck, IcoFile, IcoSend, IcoShield } from '../components/Icons.jsx'
import { api } from '../data/api.js'

const STATE = {
  delivered: ['Entregado', 'success'], opened: ['Abierto', 'success'], clicked: ['Enlace abierto', 'success'],
  sent: ['Enviado', 'sent'], pending: ['Pendiente', 'pending'], delivery_delayed: ['Demorado', 'pending'],
  bounced: ['Rebotado', 'danger'], complained: ['Marcado como spam', 'danger'], failed: ['Error', 'danger'],
  skipped: ['Omitido por modo de prueba', 'muted'],
}
const EVENT = {
  order_created: 'Orden registrada', sample_rescheduled: 'Reprogramación de muestra',
  sample_received: 'Conformidad de muestra', results_ready: 'Resultados listos',
}
const date = (value) => value ? new Date(value).toLocaleString('es-PE', { dateStyle:'medium', timeStyle:'short' }) : '—'

function deliveryState(item) {
  const key = item.provider_last_event || item.status || 'pending'
  const [label,tone] = STATE[key] || [key, 'muted']
  return { key,label,tone }
}

export default function EmailDeliveries() {
  const [data,setData] = useState({ deliveries:[],stats:{ total:0,delivered:0,sent:0,failed:0,skipped:0 } })
  const [loading,setLoading] = useState(true)
  const [refreshing,setRefreshing] = useState(false)
  const [selected,setSelected] = useState(null)
  const [search,setSearch] = useState('')
  const [filter,setFilter] = useState('all')
  const [error,setError] = useState('')

  const load = async (refreshId = '') => {
    if (!refreshId) setLoading(true)
    else setRefreshing(true)
    try {
      const result = await api.emailDeliveries(refreshId)
      setData(result)
      if (selected) setSelected(result.deliveries.find((item) => item.id === selected.id) || selected)
      setError('')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false); setRefreshing(false)
    }
  }
  useEffect(() => { load() }, [])

  const visible = useMemo(() => data.deliveries.filter((item) => {
    const state = deliveryState(item)
    const matchesFilter = filter === 'all'
      || (filter === 'delivered' && ['delivered','opened','clicked'].includes(state.key))
      || (filter === 'failed' && ['failed','bounced','complained'].includes(state.key))
      || state.key === filter
      || item.status === filter
    const term = search.trim().toLowerCase()
    const matchesSearch = !term || `${item.subject} ${item.recipient_email || ''} ${item.service_code || ''} ${item.client_name || ''}`.toLowerCase().includes(term)
    return matchesFilter && matchesSearch
  }), [data.deliveries,filter,search])

  const open = async (item) => {
    setSelected(item)
    if (item.provider_message_id) {
      setRefreshing(true)
      try {
        const result = await api.emailDeliveries(item.id)
        setData(result)
        setSelected(result.deliveries.find((delivery) => delivery.id === item.id) || item)
      } catch (requestError) {
        setError(requestError.message)
      } finally { setRefreshing(false) }
    }
  }

  return <div className="email-log-page">
    <section className="email-log-hero">
      <div><span className="eyebrow">Comunicaciones · Resend</span><h1>Correos enviados</h1><p>Seguimiento administrativo de mensajes, entregas, errores y documentos compartidos con clientes.</p></div>
      <div className="email-log-live"><i /><span><strong>Registro conectado</strong><small>Los estados se actualizan al abrir cada envío</small></span></div>
    </section>

    <section className="email-log-stats">
      <article><span><IcoSend /></span><div><small>Total registrado</small><strong>{data.stats.total}</strong></div></article>
      <article className="success"><span><IcoCheck /></span><div><small>Entregados</small><strong>{data.stats.delivered}</strong></div></article>
      <article className="sent"><span><IcoSend /></span><div><small>Enviados</small><strong>{data.stats.sent}</strong></div></article>
      <article className="danger"><span><IcoShield /></span><div><small>Con error</small><strong>{data.stats.failed}</strong></div></article>
    </section>

    <section className="email-log-panel">
      <header>
        <label className="email-log-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar correo, orden, cliente o asunto…" /></label>
        <div className="email-log-filters">
          {[['all','Todos'],['delivered','Entregados'],['sent','Enviados'],['failed','Errores'],['skipped','Omitidos']].map(([id,label]) => <button type="button" className={filter === id ? 'active' : ''} onClick={() => setFilter(id)} key={id}>{label}</button>)}
        </div>
      </header>
      {error && <div className="form-error">{error}</div>}
      {loading ? <div className="email-log-empty">Consultando comunicaciones…</div> : visible.length ? <div className="email-log-list">
        {visible.map((item) => { const state = deliveryState(item); return <button type="button" onClick={() => open(item)} key={item.id}>
          <span className={`email-state-dot ${state.tone}`}><IcoSend /></span>
          <div className="email-log-main"><small>{EVENT[item.event_type] || item.event_type}</small><strong>{item.subject}</strong><span>{item.recipient_email || 'Sin destinatario'}{item.client_name ? ` · ${item.client_name}` : ''}</span></div>
          <div className="email-log-order"><strong>{item.service_code || 'Sin orden'}</strong><span>{date(item.sent_at || item.created_at)}</span></div>
          <span className={`email-status ${state.tone}`}>{state.label}</span>
        </button> })}
      </div> : <div className="email-log-empty"><IcoFile /><strong>No hay correos con este filtro</strong><span>Prueba otra búsqueda o estado.</span></div>}
    </section>

    {selected && <div className="modal-overlay email-preview-overlay" onClick={() => setSelected(null)}>
      <section className="modal email-preview-modal" onClick={(event) => event.stopPropagation()}>
        <header><div><span className="eyebrow">{selected.service_code || EVENT[selected.event_type]}</span><h2>{selected.subject}</h2><p>Para: {selected.recipient_email || 'Sin destinatario'} · {date(selected.sent_at || selected.created_at)}</p></div><button className="modal-close" onClick={() => setSelected(null)}>×</button></header>
        <div className="email-preview-meta">
          <span className={`email-status ${deliveryState(selected).tone}`}>{deliveryState(selected).label}</span>
          <div><strong>{selected.client_name || 'Cliente no vinculado'}</strong><small>{selected.service_name || EVENT[selected.event_type] || 'Comunicación automática'}</small></div>
          {selected.provider_message_id && <button type="button" className="btn btn-ghost btn-sm" onClick={() => load(selected.id)} disabled={refreshing}>{refreshing ? 'Actualizando…' : 'Actualizar estado'}</button>}
        </div>
        {selected.preview_html ? <iframe title={`Vista previa de ${selected.subject}`} sandbox="" srcDoc={selected.preview_html} /> : <div className="email-preview-unavailable"><IcoFile /><strong>Vista visual no almacenada</strong><span>Este envío es anterior a la creación del módulo. Su asunto, destinatario y estado sí permanecen registrados.</span></div>}
        {selected.error_message && <div className="email-preview-error"><IcoShield /><span><strong>Detalle del envío</strong><small>{selected.error_message}</small></span></div>}
      </section>
    </div>}
  </div>
}
