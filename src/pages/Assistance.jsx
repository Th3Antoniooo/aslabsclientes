import { useEffect, useMemo, useState } from 'react'
import { IcoChat, IcoCheck, IcoOrders, IcoPlus, IcoSearch, IcoSend, IcoShield } from '../components/Icons.jsx'
import { api } from '../data/api.js'

const STATUS = {
  open: { label:'Pendiente de AS Labs', admin:'Por responder', tone:'open' },
  answered: { label:'Respondida', admin:'Respondida', tone:'answered' },
  closed: { label:'Resuelta', admin:'Cerrada', tone:'closed' },
}
const CATEGORY = {
  general:'Consulta general', order:'Orden o servicio', sample:'Muestra o muestreo',
  results:'Resultados', documents:'Documentos y PDF', technical:'Soporte técnico',
}
const emptyForm = { subject:'',category:'general',serviceId:'',message:'',priority:'normal' }
const date = (value) => value ? new Date(value).toLocaleString('es-PE', { dateStyle:'medium',timeStyle:'short' }) : '—'

export default function Assistance({ user, notify }) {
  const admin = user.role === 'admin'
  const [data,setData] = useState({ tickets:[],services:[],stats:{ total:0,open:0,answered:0,closed:0 } })
  const [loading,setLoading] = useState(true)
  const [selectedId,setSelectedId] = useState('')
  const [filter,setFilter] = useState(admin ? 'open' : 'all')
  const [search,setSearch] = useState('')
  const [composer,setComposer] = useState(false)
  const [form,setForm] = useState(emptyForm)
  const [reply,setReply] = useState('')
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')

  const load = async (preferred = '') => {
    setLoading(true)
    try {
      const result = await api.support()
      setData(result)
      const exists = result.tickets.some((ticket) => ticket.id === (preferred || selectedId))
      setSelectedId(exists ? (preferred || selectedId) : (result.tickets[0]?.id || ''))
      setError('')
    } catch (requestError) { setError(requestError.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const visible = useMemo(() => data.tickets.filter((ticket) => {
    const matchesFilter = filter === 'all' || ticket.status === filter
    const term = search.trim().toLowerCase()
    const haystack = `${ticket.code} ${ticket.subject} ${ticket.client_name || ''} ${ticket.client_company || ''} ${ticket.service_code || ''} ${ticket.service_name || ''}`.toLowerCase()
    return matchesFilter && (!term || haystack.includes(term))
  }), [data.tickets,filter,search])
  const selected = data.tickets.find((ticket) => ticket.id === selectedId) || null

  const create = async (event) => {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const result = await api.createSupportTicket(form)
      setForm(emptyForm); setComposer(false)
      notify?.('Consulta enviada. El equipo de AS Labs te responderá aquí.', 'success')
      await load(result.ticket?.id || '')
    } catch (requestError) { setError(requestError.message) }
    finally { setBusy(false) }
  }
  const sendReply = async (event) => {
    event.preventDefault()
    if (!selected || !reply.trim()) return
    setBusy(true); setError('')
    try {
      await api.replySupportTicket(selected.id, reply)
      setReply(''); notify?.('Respuesta enviada.', 'success'); await load(selected.id)
    } catch (requestError) { setError(requestError.message) }
    finally { setBusy(false) }
  }
  const setStatus = async (status) => {
    if (!selected) return
    setBusy(true); setError('')
    try {
      await api.updateSupportTicket(selected.id, status)
      notify?.(status === 'closed' ? 'Consulta marcada como resuelta.' : 'Consulta reabierta.', 'success')
      await load(selected.id)
    } catch (requestError) { setError(requestError.message) }
    finally { setBusy(false) }
  }

  return <div className="support-page">
    <section className="support-hero">
      <div className="support-hero-icon"><IcoChat /></div>
      <div className="support-hero-copy">
        <span className="eyebrow">{admin ? 'Atención al cliente' : 'Ayuda directa'}</span>
        <h1>{admin ? 'Centro de asistencia' : '¿En qué podemos ayudarte?'}</h1>
        <p>{admin ? 'Responde consultas y acompaña a cada cliente desde una bandeja centralizada.' : 'Pregunta sobre tus órdenes, muestras, resultados o documentos. Un administrador de AS Labs te responderá aquí.'}</p>
      </div>
      {admin ? <div className="support-hero-stats">
        <div><strong>{data.stats.open}</strong><span>por responder</span></div>
        <div><strong>{data.stats.answered}</strong><span>respondidas</span></div>
        <div><strong>{data.stats.closed}</strong><span>resueltas</span></div>
      </div> : <button type="button" className="support-primary" onClick={() => setComposer(true)}><IcoPlus /> Nueva consulta</button>}
    </section>

    {error && <div className="form-error support-error">{error}</div>}

    <section className="support-workspace">
      <aside className="support-inbox">
        <header>
          <div><span className="eyebrow">Conversaciones</span><strong>{admin ? 'Bandeja de clientes' : 'Mis consultas'}</strong></div>
          {!admin && <button type="button" onClick={() => setComposer(true)} aria-label="Nueva consulta"><IcoPlus /></button>}
        </header>
        <label className="support-search"><IcoSearch /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={admin ? 'Buscar cliente, orden o asunto…' : 'Buscar una consulta…'} /></label>
        <div className="support-filters">
          {[['all','Todas'],['open',admin ? 'Pendientes' : 'Abiertas'],['answered','Respondidas'],['closed','Resueltas']].map(([id,label]) => <button type="button" key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{label}</button>)}
        </div>
        <div className="support-ticket-list">
          {loading ? <div className="support-list-empty">Cargando conversaciones…</div> : visible.length ? visible.map((ticket) => {
            const state = STATUS[ticket.status] || STATUS.open
            const last = ticket.messages?.[ticket.messages.length - 1]
            return <button type="button" key={ticket.id} className={`support-ticket-card ${selectedId === ticket.id ? 'active' : ''}`} onClick={() => setSelectedId(ticket.id)}>
              <span className={`support-ticket-avatar ${state.tone}`}>{admin ? String(ticket.client_name || 'C').slice(0,1) : <IcoChat />}</span>
              <span className="support-ticket-content">
                <small>{admin ? ticket.client_name : ticket.code}<em className={state.tone}>{admin ? state.admin : state.label}</em></small>
                <strong>{ticket.subject}</strong>
                <span>{last?.message || CATEGORY[ticket.category]}</span>
                <time>{date(ticket.last_message_at)}</time>
              </span>
            </button>
          }) : <div className="support-list-empty"><IcoChat /><strong>No hay conversaciones</strong><span>{search ? 'Prueba otra búsqueda.' : admin ? 'Las nuevas consultas aparecerán aquí.' : 'Crea tu primera consulta cuando necesites ayuda.'}</span></div>}
        </div>
      </aside>

      <article className="support-thread">
        {selected ? <>
          <header className="support-thread-head">
            <div>
              <span className="support-thread-code">{selected.code}</span>
              <h2>{selected.subject}</h2>
              <p>{admin ? `${selected.client_name}${selected.client_company ? ` · ${selected.client_company}` : ''}` : CATEGORY[selected.category]}
                {selected.service_code ? ` · ${selected.service_code}` : ''}</p>
            </div>
            <div className="support-thread-actions">
              <span className={`support-status ${STATUS[selected.status]?.tone}`}>{admin ? STATUS[selected.status]?.admin : STATUS[selected.status]?.label}</span>
              {admin && (selected.status === 'closed'
                ? <button type="button" onClick={() => setStatus('open')} disabled={busy}>Reabrir</button>
                : <button type="button" onClick={() => setStatus('closed')} disabled={busy}><IcoCheck /> Marcar resuelta</button>)}
            </div>
          </header>
          {selected.service_code && <div className="support-order-link"><IcoOrders /><span><small>Orden vinculada</small><strong>{selected.service_code} · {selected.service_name}</strong></span></div>}
          <div className="support-messages">
            {selected.messages?.map((message) => {
              const mine = message.authorId === user.id
              const fromAdmin = message.authorRole === 'admin'
              return <div className={`support-message ${mine ? 'mine' : ''} ${fromAdmin ? 'from-admin' : ''}`} key={message.id}>
                <span className="support-message-author">{fromAdmin ? <IcoShield /> : <IcoChat />}</span>
                <div><small>{mine ? 'Tú' : fromAdmin ? `${message.authorName} · AS Labs` : message.authorName}</small><p>{message.message}</p><time>{date(message.createdAt)}</time></div>
              </div>
            })}
          </div>
          {selected.status === 'closed' ? <div className="support-closed"><IcoCheck /><span><strong>Consulta resuelta</strong><small>{admin ? 'Puedes reabrirla si necesitas continuar.' : 'Si necesitas más ayuda, crea una nueva consulta.'}</small></span></div> : <form className="support-composer" onSubmit={sendReply}>
            <textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder={admin ? 'Escribe una respuesta clara para el cliente…' : 'Escribe tu mensaje…'} rows="2" maxLength="4000" />
            <button type="submit" disabled={busy || !reply.trim()}><IcoSend /> {busy ? 'Enviando…' : 'Enviar'}</button>
          </form>}
        </> : <div className="support-thread-empty"><span><IcoChat /></span><h2>{admin ? 'Selecciona una conversación' : 'Tu asistencia, en un solo lugar'}</h2><p>{admin ? 'Abre una consulta de la bandeja para responder al cliente.' : 'Aquí conservarás las preguntas y respuestas relacionadas con tus servicios.'}</p>{!admin && <button type="button" className="support-primary" onClick={() => setComposer(true)}><IcoPlus /> Hacer una pregunta</button>}</div>}
      </article>
    </section>

    {composer && <div className="modal-overlay support-modal-overlay" onClick={() => setComposer(false)}>
      <form className="support-modal" onSubmit={create} onClick={(event) => event.stopPropagation()}>
        <header><div><span className="eyebrow">Asistencia AS Labs</span><h2>Nueva consulta</h2><p>Cuéntanos qué necesitas. Los campos son breves para que puedas enviarla rápido.</p></div><button type="button" className="modal-close" onClick={() => setComposer(false)}>×</button></header>
        <div className="support-form-grid">
          <label><span>¿Sobre qué necesitas ayuda?</span><select value={form.category} onChange={(event) => setForm({ ...form,category:event.target.value })}>{Object.entries(CATEGORY).map(([id,label]) => <option value={id} key={id}>{label}</option>)}</select></label>
          <label><span>Orden relacionada <small>Opcional</small></span><select value={form.serviceId} onChange={(event) => setForm({ ...form,serviceId:event.target.value })}><option value="">Ninguna orden específica</option>{data.services.map((service) => <option value={service.id} key={service.id}>{service.code} · {service.name}</option>)}</select></label>
          <label className="wide"><span>Asunto</span><input value={form.subject} onChange={(event) => setForm({ ...form,subject:event.target.value })} placeholder="Ej. Consulta sobre el PDF de mi muestra" maxLength="160" autoFocus /></label>
          <label className="wide"><span>Tu pregunta</span><textarea value={form.message} onChange={(event) => setForm({ ...form,message:event.target.value })} placeholder="Escribe aquí los detalles…" rows="5" maxLength="4000" /></label>
        </div>
        <footer><button type="button" className="btn btn-ghost" onClick={() => setComposer(false)}>Cancelar</button><button type="submit" className="support-primary" disabled={busy}>{busy ? 'Enviando…' : <><IcoSend /> Enviar consulta</>}</button></footer>
      </form>
    </div>}
  </div>
}
