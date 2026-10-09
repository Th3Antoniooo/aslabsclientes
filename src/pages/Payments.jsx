import { useEffect, useMemo, useRef, useState } from 'react'
import { IcoCheck, IcoCreditCard, IcoFile, IcoMail, IcoPlus, IcoSearch, IcoSend, IcoShield } from '../components/Icons.jsx'
import { api } from '../data/api.js'

const STATUS = {
  pending: { label:'Pendiente de pago',tone:'pending',hint:'Aún no se adjuntaron comprobantes.' },
  receipt_submitted: { label:'En revisión',tone:'review',hint:'Los comprobantes están listos para revisión.' },
  approved: { label:'Pago confirmado',tone:'approved',hint:'AS Labs confirmó este pago.' },
  rejected: { label:'Requiere corrección',tone:'rejected',hint:'Revisa la observación y vuelve a adjuntar el comprobante.' },
  cancelled: { label:'Cancelado',tone:'cancelled',hint:'La solicitud fue cancelada.' },
}
const emptyRequest = { serviceId:'',amount:'',currency:'PEN',concept:'',documentType:'boleta',dueDate:'',notes:'' }
const emptyUpload = { reference:'',paymentDate:new Date().toISOString().slice(0,10),notes:'' }

const money = (value, currency = 'PEN') => new Intl.NumberFormat('es-PE', {
  style:'currency',currency,minimumFractionDigits:2,
}).format(Number(value || 0))
const date = (value, withTime = false) => {
  if (!value) return '—'
  const normalized = !withTime && /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T12:00:00` : value
  return new Intl.DateTimeFormat('es-PE', withTime
    ? { dateStyle:'medium',timeStyle:'short' }
    : { dateStyle:'medium' }).format(new Date(normalized))
}

function filePayload(file) {
  if (!['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type)) {
    return Promise.reject(new Error(`${file.name}: usa PDF, JPG, PNG o WEBP.`))
  }
  if (file.size > 3 * 1024 * 1024) return Promise.reject(new Error(`${file.name}: el máximo es 3 MB.`))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve({ name:file.name,type:file.type,size:file.size,dataUrl:reader.result })
    reader.onerror = () => reject(new Error(`No pudimos leer ${file.name}.`))
    reader.readAsDataURL(file)
  })
}

export default function Payments({ user, notify }) {
  const admin = user.role === 'admin'
  const fileInput = useRef(null)
  const [data,setData] = useState({ payments:[],services:[],stats:{},configuration:{} })
  const [selectedId,setSelectedId] = useState('')
  const [filter,setFilter] = useState('all')
  const [search,setSearch] = useState('')
  const [loading,setLoading] = useState(true)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [requestOpen,setRequestOpen] = useState(false)
  const [requestForm,setRequestForm] = useState(emptyRequest)
  const [files,setFiles] = useState([])
  const [upload,setUpload] = useState(emptyUpload)
  const [reviewNotes,setReviewNotes] = useState('')

  const load = async (preferred = '') => {
    setLoading(true)
    try {
      const result = await api.payments()
      setData(result)
      const target = preferred || selectedId
      setSelectedId(result.payments.some((item) => item.id === target) ? target : (result.payments[0]?.id || ''))
      setError('')
    } catch (requestError) { setError(requestError.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const visible = useMemo(() => data.payments.filter((payment) => {
    const matchesFilter = filter === 'all' || payment.status === filter
    const term = search.trim().toLowerCase()
    const haystack = `${payment.code} ${payment.service_code} ${payment.service_name} ${payment.concept} ${payment.client_name || ''} ${payment.client_company || ''}`.toLowerCase()
    return matchesFilter && (!term || haystack.includes(term))
  }), [data.payments,filter,search])
  const selected = data.payments.find((payment) => payment.id === selectedId) || null
  const config = data.configuration || {}
  const hasPaymentData = Boolean(config.yape?.number || config.yape?.qrUrl || config.bank?.account || config.bank?.cci)

  const createRequest = async (event) => {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const result = await api.createPaymentRequest(requestForm)
      setRequestForm(emptyRequest); setRequestOpen(false)
      notify?.('Solicitud creada. El correo no se envió; puedes enviarlo cuando decidas.')
      await load(result.payment?.id || '')
    } catch (requestError) { setError(requestError.message) }
    finally { setBusy(false) }
  }

  const uploadReceipts = async (event) => {
    event.preventDefault()
    if (!selected || !files.length) return
    setBusy(true); setError('')
    try {
      for (const file of files) {
        await api.uploadPaymentReceipt({ paymentId:selected.id,file:await filePayload(file),...upload })
      }
      notify?.(`${files.length} comprobante${files.length === 1 ? '' : 's'} cargado${files.length === 1 ? '' : 's'} correctamente.`)
      setFiles([]); setUpload(emptyUpload)
      if (fileInput.current) fileInput.current.value = ''
      await load(selected.id)
    } catch (requestError) { setError(requestError.message) }
    finally { setBusy(false) }
  }

  const review = async (decision) => {
    if (!selected) return
    setBusy(true); setError('')
    try {
      await api.reviewPaymentRequest(selected.id,decision,reviewNotes)
      notify?.(decision === 'approved' ? 'Pago confirmado correctamente.' : 'La observación fue enviada al cliente.')
      setReviewNotes(''); await load(selected.id)
    } catch (requestError) { setError(requestError.message) }
    finally { setBusy(false) }
  }

  const cancel = async () => {
    if (!selected || !window.confirm(`¿Cancelar la solicitud ${selected.code}?`)) return
    setBusy(true); setError('')
    try { await api.cancelPaymentRequest(selected.id); notify?.('Solicitud cancelada.'); await load(selected.id) }
    catch (requestError) { setError(requestError.message) }
    finally { setBusy(false) }
  }

  const issueFiscal = async () => {
    if (!selected) return
    setBusy(true); setError('')
    try { await api.issueFiscalDocument(selected.id); notify?.('Comprobante electrónico emitido.'); await load(selected.id) }
    catch (requestError) { setError(requestError.message) }
    finally { setBusy(false) }
  }

  const sendPaymentEmail = async () => {
    if (!selected) return
    setBusy(true); setError('')
    try {
      await api.sendPaymentEmail(selected.id)
      notify?.(`Correo de pago enviado a ${selected.client_email}.`)
      await load(selected.id)
    } catch (requestError) { setError(requestError.message) }
    finally { setBusy(false) }
  }

  return <div className="payments-page">
    <section className="payments-hero">
      <div className="payments-hero-copy">
        <span className="eyebrow">{admin ? 'Cobranza y validación' : 'Centro de pagos'}</span>
        <h1>{admin ? 'Pagos de clientes, claros y verificables' : 'Tus pagos, en un solo lugar'}</h1>
        <p>{admin ? 'Solicita pagos, recibe varios comprobantes y confirma cada operación sin salir del portal.' : 'Consulta los datos de pago y adjunta uno o varios comprobantes para que AS Labs los revise.'}</p>
      </div>
      <div className="payments-hero-actions">
        {admin && <button type="button" className="payments-primary" onClick={() => setRequestOpen(true)}><IcoPlus /> Solicitar pago</button>}
        <div className="payments-security"><IcoShield /><span><strong>Archivos protegidos</strong><small>Solo tú y AS Labs pueden verlos</small></span></div>
      </div>
    </section>

    {error && <div className="form-error payments-error">{error}</div>}

    <section className="payments-metrics">
      <article><span className="metric-icon pending"><IcoCreditCard /></span><div><small>Solicitudes activas</small><strong>{Number(data.stats.pending || 0) + Number(data.stats.receipt_submitted || 0) + Number(data.stats.rejected || 0)}</strong></div></article>
      <article><span className="metric-icon review"><IcoFile /></span><div><small>En revisión</small><strong>{data.stats.receipt_submitted || 0}</strong></div></article>
      <article><span className="metric-icon approved"><IcoCheck /></span><div><small>Pagos confirmados</small><strong>{data.stats.approved || 0}</strong></div></article>
    </section>

    <section className="payments-workspace">
      <aside className="payments-list-panel">
        <header><div><span className="eyebrow">Solicitudes</span><strong>{admin ? 'Cobranza reciente' : 'Mis pagos'}</strong></div><span>{visible.length}</span></header>
        <label className="payments-search"><IcoSearch /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar orden o concepto…" /></label>
        <div className="payments-filters">
          {[['all','Todas'],['pending','Pendientes'],['receipt_submitted','En revisión'],['approved','Confirmadas']].map(([id,label]) => <button type="button" key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{label}</button>)}
        </div>
        <div className="payments-list">
          {loading ? <div className="payments-empty">Cargando pagos…</div> : visible.length ? visible.map((payment) => {
            const status = STATUS[payment.status] || STATUS.pending
            return <button type="button" key={payment.id} className={`payment-list-card ${selectedId === payment.id ? 'active' : ''}`} onClick={() => setSelectedId(payment.id)}>
              <span className={`payment-list-state ${status.tone}`}><IcoCreditCard /></span>
              <span className="payment-list-copy"><small>{payment.code}<em className={status.tone}>{status.label}</em></small><strong>{payment.concept}</strong><span>{admin ? payment.client_name : payment.service_code}</span><b>{money(payment.amount,payment.currency)}</b></span>
            </button>
          }) : <div className="payments-empty"><IcoCreditCard /><strong>No hay solicitudes</strong><span>{search ? 'Prueba otra búsqueda.' : admin ? 'Crea la primera solicitud de pago.' : 'Tus próximas solicitudes aparecerán aquí.'}</span></div>}
        </div>
      </aside>

      <article className="payment-detail">
        {selected ? <>
          <header className="payment-detail-head">
            <div><span className="payment-code">{selected.code}</span><h2>{selected.concept}</h2><p>{selected.service_code} · {selected.service_name}{admin ? ` · ${selected.client_name}` : ''}</p></div>
            <div className="payment-total"><small>Total solicitado</small><strong>{money(selected.amount,selected.currency)}</strong><span className={`payment-status ${STATUS[selected.status]?.tone}`}>{STATUS[selected.status]?.label}</span>{admin && <button type="button" className="payment-email-button" onClick={sendPaymentEmail} disabled={busy}><IcoMail /> {selected.payment_email_sent_at ? 'Reenviar correo' : 'Enviar correo'}</button>}{admin && selected.payment_email_sent_at && <small className="payment-email-date">Último envío: {date(selected.payment_email_sent_at,true)}</small>}</div>
          </header>

          <div className="payment-detail-grid">
            <section className="payment-main-column">
              <div className="payment-info-grid">
                <div><small>Documento</small><strong>{selected.document_type === 'factura' ? 'Factura' : 'Boleta'}</strong></div>
                <div><small>Fecha límite</small><strong>{date(selected.due_date)}</strong></div>
                <div><small>Comprobantes</small><strong>{selected.receipts?.length || 0} archivo{selected.receipts?.length === 1 ? '' : 's'}</strong></div>
              </div>

              {selected.notes && <div className="payment-note"><small>Nota de AS Labs</small><p>{selected.notes}</p></div>}
              {selected.review_notes && <div className={`payment-review-note ${selected.status}`}><strong>{selected.status === 'rejected' ? 'Observación del administrador' : 'Revisión completada'}</strong><p>{selected.review_notes}</p></div>}

              <section className="payment-receipts">
                <header><div><span className="eyebrow">Sustento</span><h3>Comprobantes adjuntos</h3></div><span>{selected.receipts?.length || 0}</span></header>
                {selected.receipts?.length ? <div className="payment-receipt-grid">{selected.receipts.map((receipt,index) => <a href={`/api/services?payments=1&receipt=${encodeURIComponent(receipt.id)}`} target="_blank" rel="noreferrer" key={receipt.id} className="payment-receipt-card">
                  <span className="payment-receipt-preview">{receipt.mime_type === 'application/pdf' ? <b>PDF</b> : <img src={`/api/services?payments=1&receipt=${encodeURIComponent(receipt.id)}`} alt={`Comprobante ${index + 1}`} />}</span>
                  <span><strong>{receipt.file_name}</strong><small>{receipt.uploaded_by_role === 'admin' ? 'Subido por AS Labs' : 'Subido por el cliente'} · {date(receipt.created_at,true)}</small>{receipt.payment_reference && <em>Op. {receipt.payment_reference}</em>}</span>
                </a>)}</div> : <div className="payment-receipts-empty"><IcoFile /><strong>Aún no hay comprobantes</strong><span>Puedes adjuntar varios archivos en una sola selección.</span></div>}
              </section>

              {!['approved','cancelled'].includes(selected.status) && <form className="payment-upload" onSubmit={uploadReceipts}>
                <header><div><span className="eyebrow">{admin ? 'Carga administrativa' : 'Confirmar pago'}</span><h3>{admin ? 'Subir comprobantes' : 'Adjunta tu pago'}</h3><p>PDF o imagen, hasta 3 MB por archivo.</p></div><IcoSend /></header>
                <label className={`payment-dropzone ${files.length ? 'ready' : ''}`}>
                  <input ref={fileInput} type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setFiles(Array.from(event.target.files || []).slice(0,8))} />
                  <IcoPlus /><span><strong>{files.length ? `${files.length} archivo${files.length === 1 ? '' : 's'} listo${files.length === 1 ? '' : 's'}` : 'Elegir comprobantes'}</strong><small>{files.length ? files.map((file) => file.name).join(' · ') : 'Puedes seleccionar varios a la vez'}</small></span>
                </label>
                <details className="payment-optional-details">
                  <summary>Agregar datos opcionales</summary>
                  <div className="payment-upload-fields">
                    <label><span>Número de operación</span><input value={upload.reference} onChange={(event) => setUpload({ ...upload,reference:event.target.value })} placeholder="Ej. 092174" /></label>
                    <label><span>Fecha del pago</span><input type="date" value={upload.paymentDate} onChange={(event) => setUpload({ ...upload,paymentDate:event.target.value })} /></label>
                    <label className="wide"><span>Nota</span><input value={upload.notes} onChange={(event) => setUpload({ ...upload,notes:event.target.value })} placeholder="Dato adicional para identificar el pago" /></label>
                  </div>
                </details>
                <button type="submit" className="payments-primary" disabled={busy || !files.length}>{busy ? 'Subiendo…' : <><IcoSend /> Enviar comprobantes</>}</button>
              </form>}

              {admin && selected.receipts?.length > 0 && !['approved','cancelled'].includes(selected.status) && <section className="payment-review-box">
                <div><span className="eyebrow">Validación administrativa</span><h3>Revisar pago</h3><p>Confirma que el importe, fecha y operación coincidan antes de aprobar.</p></div>
                <textarea value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} rows="3" placeholder="Observación para el cliente (obligatoria si rechazas)" />
                <div><button type="button" className="payment-reject" onClick={() => review('rejected')} disabled={busy}>Solicitar corrección</button><button type="button" className="payments-primary" onClick={() => review('approved')} disabled={busy}><IcoCheck /> Aprobar pago</button></div>
              </section>}
            </section>

            <aside className="payment-side-column">
              <section className="payment-methods">
                <span className="eyebrow">Datos de pago</span><h3>Elige tu método</h3>
                {config.yape?.qrUrl && <img className="payment-qr" src={config.yape.qrUrl} alt="Código QR de Yape AS Labs" />}
                {config.yape?.number && <div className="payment-method-row"><span>Yape{config.yape.name ? ` · ${config.yape.name}` : ''}</span><strong>{config.yape.number}</strong></div>}
                {(config.bank?.account || config.bank?.cci) && <div className="payment-bank"><strong>{config.bank.name || 'Cuenta bancaria'}</strong>{config.bank.holder && <span>{config.bank.holder}</span>}{config.bank.account && <span>Cuenta corriente: {config.bank.account}</span>}{config.bank.cci && <span>CCI: {config.bank.cci}</span>}</div>}
                {!hasPaymentData && <div className="payment-config-pending"><IcoShield /><span><strong>Datos pendientes de configuración</strong><small>AS Labs confirmará el medio de pago antes de la operación.</small></span></div>}
              </section>

              {admin && <section className="payment-fiscal-card">
                <span className="eyebrow">Facturación electrónica</span><h3>{selected.document_type === 'factura' ? 'Factura' : 'Boleta'} SUNAT</h3>
                <p>{selected.fiscal_status === 'issued' ? 'El documento electrónico ya fue emitido.' : 'La emisión solo se habilita después de aprobar el pago.'}</p>
                <button type="button" onClick={issueFiscal} disabled={busy || selected.status !== 'approved' || !config.fiscal?.enabled}>
                  <IcoFile /> {config.fiscal?.enabled ? 'Emitir comprobante' : 'Configuración pendiente'}
                </button>
                {!config.fiscal?.enabled && <small>{config.fiscal?.credentialsReady ? 'Credenciales guardadas. Falta definir las series de factura y boleta.' : 'Falta completar la configuración fiscal antes de emitir.'}</small>}
              </section>}

              <section className="payment-timeline">
                <span className="eyebrow">Seguimiento</span>
                <div className="done"><i /><span><strong>Solicitud creada</strong><small>{date(selected.created_at,true)}</small></span></div>
                <div className={selected.receipts?.length ? 'done' : ''}><i /><span><strong>Comprobante recibido</strong><small>{selected.receipts?.length ? `${selected.receipts.length} archivo(s)` : 'Pendiente'}</small></span></div>
                <div className={selected.status === 'approved' ? 'done' : selected.status === 'rejected' ? 'alert' : ''}><i /><span><strong>Validación de AS Labs</strong><small>{selected.status === 'approved' ? date(selected.reviewed_at,true) : selected.status === 'rejected' ? 'Requiere corrección' : 'Pendiente'}</small></span></div>
              </section>
              {admin && !['approved','cancelled'].includes(selected.status) && <button type="button" className="payment-cancel" onClick={cancel} disabled={busy}>Cancelar solicitud</button>}
            </aside>
          </div>
        </> : <div className="payment-detail-empty"><span><IcoCreditCard /></span><h2>{admin ? 'Selecciona una solicitud' : 'Aquí verás tus próximos pagos'}</h2><p>{admin ? 'Elige un pago para revisar sus comprobantes.' : 'Cuando AS Labs registre un pago, podrás consultar los datos y adjuntar el sustento aquí.'}</p></div>}
      </article>
    </section>

    {requestOpen && <div className="modal-overlay payment-modal-overlay" role="presentation" onClick={() => setRequestOpen(false)}>
      <form className="payment-request-modal" role="dialog" aria-modal="true" aria-labelledby="payment-request-title" onSubmit={createRequest} onClick={(event) => event.stopPropagation()}>
        <header><div><span className="eyebrow">Nueva cobranza</span><h2 id="payment-request-title">Solicitar pago</h2><p>Elige la orden, indica el concepto y el importe.</p></div><button type="button" className="modal-close" onClick={() => setRequestOpen(false)} aria-label="Cerrar">×</button></header>
        <div className="payment-request-scroll">
          <div className="payment-request-grid">
            <label className="wide"><span>Orden y cliente</span><select value={requestForm.serviceId} onChange={(event) => setRequestForm({ ...requestForm,serviceId:event.target.value })} required><option value="">Seleccionar orden…</option>{data.services.map((service) => <option value={service.id} key={service.id}>{service.code} · {service.client_name} · {service.name}</option>)}</select></label>
            <label className="wide"><span>Concepto</span><input value={requestForm.concept} onChange={(event) => setRequestForm({ ...requestForm,concept:event.target.value })} placeholder="Ej. Análisis microbiológico de 12 muestras" required maxLength="500" /></label>
            <label><span>Importe</span><input type="number" min="0.01" step="0.01" value={requestForm.amount} onChange={(event) => setRequestForm({ ...requestForm,amount:event.target.value })} placeholder="0.00" required /></label>
            <label><span>Moneda</span><select value={requestForm.currency} onChange={(event) => setRequestForm({ ...requestForm,currency:event.target.value })}><option value="PEN">Soles (PEN)</option><option value="USD">Dólares (USD)</option></select></label>
            <label className="wide"><span>Comprobante</span><select value={requestForm.documentType} onChange={(event) => setRequestForm({ ...requestForm,documentType:event.target.value })}><option value="boleta">Boleta</option><option value="factura">Factura</option></select></label>
          </div>
          <details className="payment-request-optional">
            <summary>Opciones adicionales</summary>
            <div className="payment-request-grid">
              <label><span>Fecha límite</span><input type="date" value={requestForm.dueDate} onChange={(event) => setRequestForm({ ...requestForm,dueDate:event.target.value })} /></label>
              <label className="wide"><span>Nota para el cliente</span><textarea rows="3" value={requestForm.notes} onChange={(event) => setRequestForm({ ...requestForm,notes:event.target.value })} placeholder="Indicaciones adicionales" /></label>
            </div>
          </details>
        </div>
        <footer><button type="button" className="btn btn-ghost" onClick={() => setRequestOpen(false)}>Cancelar</button><button type="submit" className="payments-primary" disabled={busy}>{busy ? 'Creando…' : <><IcoSend /> Crear solicitud</>}</button></footer>
      </form>
    </div>}
  </div>
}
