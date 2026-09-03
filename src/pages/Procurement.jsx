import { useEffect, useMemo, useState } from 'react'
import { api } from '../data/api.js'
import { IcoArrow, IcoBox, IcoCalendar, IcoCheck, IcoFile, IcoPlus, IcoShield } from '../components/Icons.jsx'

const STATUS = {
  pending_quote: { label: 'Pendiente de cotizar', step: 0, tone: 'pending' },
  submitted: { label: 'Cotización enviada', step: 1, tone: 'sent' },
  reviewed: { label: 'Revisada', step: 2, tone: 'review' },
  in_process: { label: 'En proceso', step: 2, tone: 'review' },
  accepted: { label: 'Aceptada', step: 3, tone: 'accepted' },
  rejected: { label: 'No aceptada', step: 3, tone: 'rejected' },
}

const blankItem = () => ({ product: '', description: '', quantity: 1, unit: 'unidad', unitPrice: '' })
const blankOrder = () => ({ supplierUserId: '', title: '', description: '', requiredAt: '', deliveryAddress: 'AS Laboratorios · Trujillo', deliveryInstructions: '', items: [blankItem()] })

function money(value, currency = 'PEN') {
  return new Intl.NumberFormat('es-PE', { style: 'currency', currency }).format(Number(value || 0))
}

function date(value, withTime = false) {
  if (!value) return 'Por coordinar'
  return new Date(withTime ? value : `${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString('es-PE', {
    day: '2-digit', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}

async function filePayload(file) {
  if (!file) return null
  if (file.size > 3 * 1024 * 1024) throw new Error('El archivo debe pesar como máximo 3 MB.')
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('No fue posible leer el archivo.'))
    reader.readAsDataURL(file)
  })
  return { name: file.name, mimeType: file.type, size: file.size, dataUrl }
}

function StatusFlow({ status }) {
  const current = STATUS[status] || STATUS.pending_quote
  const labels = ['Orden recibida', 'Cotización enviada', 'Revisión AS Labs', status === 'rejected' ? 'No aceptada' : 'Aceptada']
  return (
    <div className="proc-status-flow">
      {labels.map((label, index) => (
        <div className={`${index <= current.step ? 'done' : ''} ${index === current.step ? 'current' : ''}`} key={label}>
          <span>{index < current.step ? <IcoCheck /> : index + 1}</span><small>{label}</small>
        </div>
      ))}
    </div>
  )
}

function EthicsNotice({ compact = false }) {
  return (
    <section className={`supplier-ethics ${compact ? 'compact' : ''}`}>
      <span><IcoShield /></span>
      <div>
        <strong>Compras transparentes · Cero tolerancia a la corrupción</strong>
        <p>AS Laboratorios no solicita ni acepta comisiones, regalos, favores o pagos para influir en una compra. Toda cotización se evalúa con criterios técnicos, comerciales y trazables.</p>
      </div>
    </section>
  )
}

function OrderCard({ order, selected, onClick, admin }) {
  const state = STATUS[order.status] || STATUS.pending_quote
  return (
    <button className={`proc-order-card ${selected ? 'selected' : ''}`} onClick={onClick}>
      <div className="proc-card-top"><span>{order.code}</span><i className={state.tone}>{state.label}</i></div>
      <strong>{order.title}</strong>
      <p>{admin ? `${order.supplier_company || order.supplier_name} · ` : ''}{order.items?.length || 0} productos</p>
      <footer><span><IcoCalendar /> {date(order.required_at)}</span><IcoArrow /></footer>
    </button>
  )
}

function QuoteForm({ order, onSaved, notify }) {
  const quote = order.quote
  const [form, setForm] = useState(() => ({
    deliveryMode: quote?.deliveryMode || 'Entrega en sede de AS Laboratorios',
    deliveryTerm: quote?.deliveryTerm || '',
    validityDays: quote?.validityDays || 15,
    currency: quote?.currency || 'PEN',
    igvRate: quote?.igvRate ?? 18,
    notes: quote?.notes || '',
    items: (quote?.items?.length ? quote.items : order.items).map((item) => ({
      product: item.product, description: item.description || '', quantity: Number(item.quantity), unit: item.unit || 'unidad', unitPrice: item.unitPrice ?? '',
    })),
  }))
  const [file, setFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const subtotal = useMemo(() => form.items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0), [form.items])
  const total = subtotal * (1 + Number(form.igvRate || 0) / 100)
  const updateItem = (index, changes) => setForm((current) => ({ ...current, items: current.items.map((item, position) => position === index ? { ...item, ...changes } : item) }))
  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError('')
    try {
      await api.submitSupplierQuote({ id: order.id, ...form, file: await filePayload(file) })
      notify(quote ? 'Cotización actualizada.' : 'Cotización enviada a AS Labs.')
      onSaved()
    } catch (requestError) { setError(requestError.message) } finally { setSaving(false) }
  }
  return (
    <form className="supplier-quote-form" onSubmit={submit}>
      <header><div><span className="eyebrow">Tu propuesta</span><h3>{quote ? 'Actualizar cotización' : 'Cotizar esta orden'}</h3><p>Completa precios y entrega. El total se calcula automáticamente.</p></div><span className="quote-auto-total">Total <strong>{money(total, form.currency)}</strong></span></header>
      <div className="quote-items-editor">
        <div className="quote-item-head"><span>Producto y descripción</span><span>Cantidad</span><span>Precio unitario</span><span>Total</span></div>
        {form.items.map((item, index) => (
          <div className="quote-item-row" key={index}>
            <div><input aria-label="Producto" value={item.product} onChange={(e) => updateItem(index, { product: e.target.value })} required /><input aria-label="Descripción" placeholder="Descripción o especificación" value={item.description} onChange={(e) => updateItem(index, { description: e.target.value })} /></div>
            <div className="quote-quantity"><input type="number" min="0.001" step="0.001" value={item.quantity} onChange={(e) => updateItem(index, { quantity: e.target.value })} required /><input value={item.unit} onChange={(e) => updateItem(index, { unit: e.target.value })} /></div>
            <input type="number" aria-label="Precio unitario" min="0" step="0.01" placeholder="0.00" value={item.unitPrice} onChange={(e) => updateItem(index, { unitPrice: e.target.value })} required />
            <strong>{money(Number(item.quantity || 0) * Number(item.unitPrice || 0), form.currency)}</strong>
            {form.items.length > 1 && <button type="button" className="quote-remove" onClick={() => setForm((current) => ({ ...current, items: current.items.filter((_, position) => position !== index) }))}>×</button>}
          </div>
        ))}
        <button className="quote-add-line" type="button" onClick={() => setForm((current) => ({ ...current, items: [...current.items, blankItem()] }))}><IcoPlus /> Agregar otro producto</button>
      </div>
      <div className="quote-fields">
        <label><span>Modo de entrega</span><select value={form.deliveryMode} onChange={(e) => setForm({ ...form, deliveryMode: e.target.value })}><option>Entrega en sede de AS Laboratorios</option><option>Recojo en almacén del proveedor</option><option>Envío por courier</option><option>Entrega digital</option><option>Por coordinar</option></select></label>
        <label><span>Plazo de entrega</span><input placeholder="Ej. 3 días hábiles" value={form.deliveryTerm} onChange={(e) => setForm({ ...form, deliveryTerm: e.target.value })} /></label>
        <label><span>Moneda</span><select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}><option value="PEN">Soles (PEN)</option><option value="USD">Dólares (USD)</option></select></label>
        <label><span>IGV</span><select value={form.igvRate} onChange={(e) => setForm({ ...form, igvRate: e.target.value })}><option value="18">Incluye IGV (18%)</option><option value="0">No aplica IGV</option></select></label>
        <label><span>Vigencia</span><input type="number" min="1" max="365" value={form.validityDays} onChange={(e) => setForm({ ...form, validityDays: e.target.value })} /><small>días</small></label>
        <label className="quote-file"><span>Cotización PDF (opcional)</span><input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] || null)} /><small>{file?.name || quote?.fileName || 'Puedes enviarla solo con los datos del formulario.'}</small></label>
        <label className="quote-notes"><span>Condiciones u observaciones</span><textarea rows="3" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Garantía, marca, condiciones de pago u otra información relevante." /></label>
      </div>
      <div className="quote-totals"><span>Subtotal <strong>{money(subtotal, form.currency)}</strong></span><span>IGV ({form.igvRate}%) <strong>{money(total - subtotal, form.currency)}</strong></span><span className="grand">Total <strong>{money(total, form.currency)}</strong></span></div>
      {error && <div className="form-error">{error}</div>}
      <footer><span><IcoShield /> Al enviar confirmas que la propuesta fue preparada sin pagos, favores ni conflictos de interés.</span><button className="btn btn-primary" disabled={saving}>{saving ? 'Enviando…' : quote ? 'Actualizar cotización' : 'Enviar cotización'} <IcoArrow /></button></footer>
    </form>
  )
}

function QuoteSummary({ order }) {
  const quote = order.quote
  if (!quote) return <div className="proc-empty-detail"><IcoFile /><strong>Aún no hay cotización</strong><p>El proveedor recibirá esta orden automáticamente en su panel.</p></div>
  return (
    <section className="quote-summary">
      <header><div><span className="eyebrow">Propuesta recibida</span><h3>Cotización del proveedor</h3><p>Enviada {date(quote.submittedAt, true)}</p></div><strong>{money(quote.total, quote.currency)}</strong></header>
      <div className="quote-summary-table">
        {quote.items.map((item) => <div key={item.id}><span><strong>{item.product}</strong><small>{item.description || `${item.quantity} ${item.unit}`}</small></span><span>{item.quantity} {item.unit}</span><span>{money(item.unitPrice, quote.currency)}</span><strong>{money(item.lineTotal, quote.currency)}</strong></div>)}
      </div>
      <div className="quote-summary-meta"><span>Entrega<strong>{quote.deliveryMode}</strong><small>{quote.deliveryTerm || 'Sin plazo indicado'}</small></span><span>Vigencia<strong>{quote.validityDays ? `${quote.validityDays} días` : 'No indicada'}</strong></span><span>IGV<strong>{quote.igvRate}% · {money(quote.igvAmount, quote.currency)}</strong></span></div>
      {quote.notes && <p className="quote-summary-notes">{quote.notes}</p>}
      {quote.fileName && <a className="btn btn-ghost" href={`/api/services?procurement=1&file=quote&id=${order.id}`} target="_blank" rel="noreferrer"><IcoFile /> Ver archivo adjunto</a>}
    </section>
  )
}

function OrderDetail({ order, admin, reload, notify }) {
  const [adminNotes, setAdminNotes] = useState(order.admin_notes || '')
  const [saving, setSaving] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [payment, setPayment] = useState({ file: null, paymentReference: '', paymentDate: new Date().toISOString().slice(0, 10), notes: '' })
  const [error, setError] = useState('')
  const setStatus = async (status) => {
    setSaving(true); setError('')
    try { await api.updatePurchaseOrderStatus({ id: order.id, status, adminNotes }); notify('Estado actualizado y proveedor notificado.'); await reload() }
    catch (requestError) { setError(requestError.message) } finally { setSaving(false) }
  }
  const uploadPayment = async (event) => {
    event.preventDefault(); setSaving(true); setError('')
    try { await api.uploadSupplierPayment({ id: order.id, ...payment, file: await filePayload(payment.file) }); notify('Comprobante publicado para el proveedor.'); setPaymentOpen(false); await reload() }
    catch (requestError) { setError(requestError.message) } finally { setSaving(false) }
  }
  return (
    <article className="proc-detail">
      <header className="proc-detail-head">
        <div><span className="service-code">{order.code}</span><h2>{order.title}</h2><p>{admin ? `${order.supplier_name} · ${order.supplier_company} · ${order.supplier_email}` : order.description || 'Solicitud de abastecimiento de AS Laboratorios'}</p></div>
        <span className={`proc-status-pill ${STATUS[order.status]?.tone}`}>{STATUS[order.status]?.label}</span>
      </header>
      <StatusFlow status={order.status} />
      <section className="purchase-brief">
        <div className="purchase-brief-meta"><span><small>Entrega requerida</small><strong>{date(order.required_at)}</strong></span><span><small>Lugar</small><strong>{order.delivery_address || 'Por coordinar'}</strong></span><span><small>Indicaciones</small><strong>{order.delivery_instructions || 'Sin indicaciones adicionales'}</strong></span></div>
        {order.description && <p>{order.description}</p>}
        <div className="purchase-request-items">{order.items.map((item) => <div key={item.id}><span><strong>{item.product}</strong><small>{item.description || 'Según especificación de la orden'}</small></span><b>{item.quantity} {item.unit}</b></div>)}</div>
      </section>
      {admin ? <QuoteSummary order={order} /> : ['pending_quote', 'submitted', 'reviewed', 'in_process'].includes(order.status) && <QuoteForm key={`${order.id}-${order.quote?.updatedAt || ''}`} order={order} onSaved={reload} notify={notify} />}
      {!admin && ['accepted', 'rejected'].includes(order.status) && <QuoteSummary order={order} />}
      {admin && order.quote && (
        <section className="admin-quote-actions">
          <div><span className="eyebrow">Decisión administrativa</span><h3>Revisión de la cotización</h3><textarea rows="2" value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} placeholder="Nota visible en el seguimiento interno" /></div>
          <div>{order.status !== 'reviewed' && <button className="btn btn-ghost" disabled={saving} onClick={() => setStatus('reviewed')}>Marcar revisada</button>}{order.status !== 'in_process' && <button className="btn btn-ghost" disabled={saving} onClick={() => setStatus('in_process')}>Poner en proceso</button>}<button className="btn btn-danger-soft" disabled={saving} onClick={() => setStatus('rejected')}>No aceptar</button><button className="btn btn-primary" disabled={saving} onClick={() => setStatus('accepted')}><IcoCheck /> Aceptar cotización</button></div>
        </section>
      )}
      {order.status === 'accepted' && (
        <section className="payment-section">
          <header><div><span className="eyebrow">Pago</span><h3>Comprobantes de pago</h3><p>{admin ? 'Publica la evidencia para que el proveedor pueda consultarla.' : 'Consulta la evidencia de los pagos publicados por AS Labs.'}</p></div>{admin && <button className="btn btn-accent" onClick={() => setPaymentOpen((value) => !value)}><IcoPlus /> Adjuntar pago</button>}</header>
          {paymentOpen && <form className="payment-form" onSubmit={uploadPayment}><label><span>Archivo</span><input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required onChange={(e) => setPayment({ ...payment, file: e.target.files?.[0] || null })} /></label><label><span>Fecha</span><input type="date" value={payment.paymentDate} onChange={(e) => setPayment({ ...payment, paymentDate: e.target.value })} /></label><label><span>Referencia</span><input value={payment.paymentReference} onChange={(e) => setPayment({ ...payment, paymentReference: e.target.value })} placeholder="N.º operación" /></label><label><span>Nota</span><input value={payment.notes} onChange={(e) => setPayment({ ...payment, notes: e.target.value })} /></label><button className="btn btn-primary" disabled={saving}>Publicar comprobante</button></form>}
          <div className="payment-list">{order.payment_receipts?.length ? order.payment_receipts.map((receipt) => <a key={receipt.id} href={`/api/services?procurement=1&file=payment&id=${receipt.id}`} target="_blank" rel="noreferrer"><span><IcoFile /></span><div><strong>{receipt.fileName}</strong><small>{receipt.paymentReference || 'Comprobante'} · {date(receipt.paymentDate)}</small></div><IcoArrow /></a>) : <p>Aún no se ha publicado un comprobante.</p>}</div>
        </section>
      )}
      {error && <div className="form-error">{error}</div>}
      <EthicsNotice compact />
    </article>
  )
}

function CreateOrderModal({ suppliers, onClose, onSaved, notify }) {
  const [form, setForm] = useState(() => ({ ...blankOrder(), supplierUserId: suppliers[0]?.id || '' }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const updateItem = (index, changes) => setForm((current) => ({ ...current, items: current.items.map((item, position) => position === index ? { ...item, ...changes } : item) }))
  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError('')
    try {
      const normalizedItems = form.items.map((item) => ({
        ...item,
        product: String(item.product || '').trim(),
        description: String(item.description || '').trim(),
        quantity: Number(item.quantity || 0),
        unit: String(item.unit || 'unidad').trim() || 'unidad',
      }))
      const supplierUserId = form.supplierUserId || suppliers[0]?.id || ''
      const title = String(form.title || form.description || normalizedItems[0]?.product || '').trim()
      if (!supplierUserId) throw new Error('Selecciona el proveedor que recibirá la orden.')
      if (!normalizedItems.some((item) => item.product && item.quantity > 0)) throw new Error('Agrega al menos un producto con una cantidad mayor que cero.')
      await api.createPurchaseOrder({ ...form, supplierUserId, title, items: normalizedItems })
      notify('Orden emitida y enviada al proveedor.'); await onSaved(); onClose()
    }
    catch (requestError) { setError(requestError.message) } finally { setSaving(false) }
  }
  return <div className="modal-overlay" onClick={onClose}><form className="modal procurement-create-modal" onSubmit={submit} onClick={(e) => e.stopPropagation()}><div className="modal-heading"><span className="modal-icon"><IcoBox /></span><div><span className="eyebrow">Nueva compra</span><h2>Emitir orden al proveedor</h2><p>Aparecerá inmediatamente en su panel.</p></div></div>{!suppliers.length ? <div className="proc-no-suppliers"><IcoShield /><strong>Primero crea un usuario con rol Proveedor</strong><p>Hazlo desde Administración → Usuarios y selecciona “Proveedor”.</p></div> : <><div className="form-grid"><label className="field"><span>Proveedor</span><select value={form.supplierUserId} onChange={(e) => setForm({ ...form, supplierUserId: e.target.value })}>{suppliers.map((supplier) => <option value={supplier.id} key={supplier.id}>{supplier.company} · {supplier.full_name}</option>)}</select></label><label className="field"><span>Fecha requerida</span><input type="date" value={form.requiredAt} onChange={(e) => setForm({ ...form, requiredAt: e.target.value })} /></label><label className="field field-wide"><span>Motivo de la compra</span><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ej. Insumos para microbiología" required /></label><label className="field field-wide"><span>Descripción general</span><textarea rows="2" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label></div><div className="purchase-items-builder"><header><strong>Productos solicitados</strong><small>Solo pide lo necesario; el proveedor añadirá precios.</small></header>{form.items.map((item, index) => <div key={index}><input placeholder="Producto" value={item.product} onChange={(e) => updateItem(index, { product: e.target.value })} required /><input placeholder="Descripción / especificación" value={item.description} onChange={(e) => updateItem(index, { description: e.target.value })} /><input type="number" min="0.001" step="0.001" value={item.quantity} onChange={(e) => updateItem(index, { quantity: e.target.value })} /><input placeholder="Unidad" value={item.unit} onChange={(e) => updateItem(index, { unit: e.target.value })} />{form.items.length > 1 && <button type="button" onClick={() => setForm((current) => ({ ...current, items: current.items.filter((_, p) => p !== index) }))}>×</button>}</div>)}<button type="button" onClick={() => setForm((current) => ({ ...current, items: [...current.items, blankItem()] }))}><IcoPlus /> Agregar producto</button></div><div className="form-grid"><label className="field"><span>Lugar de entrega</span><input value={form.deliveryAddress} onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })} /></label><label className="field"><span>Indicaciones</span><input value={form.deliveryInstructions} onChange={(e) => setForm({ ...form, deliveryInstructions: e.target.value })} placeholder="Horario, contacto, etc." /></label></div></>}{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button className="btn btn-ghost" type="button" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={saving || !suppliers.length}>{saving ? 'Emitiendo…' : 'Emitir orden'} <IcoArrow /></button></div></form></div>
}

export default function Procurement({ user, notify }) {
  const admin = user.role === 'admin'
  const [orders, setOrders] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [filter, setFilter] = useState('active')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const load = async () => { setLoading(true); try { const data = await api.procurement(); setOrders(data.orders); setSuppliers(data.suppliers || []); setSelectedId((current) => data.orders.some((order) => order.id === current) ? current : data.orders[0]?.id || null); setError('') } catch (requestError) { setError(requestError.message) } finally { setLoading(false) } }
  useEffect(() => { load() }, [])
  const filtered = orders.filter((order) => filter === 'all' || (filter === 'active' ? !['accepted', 'rejected'].includes(order.status) : order.status === filter))
  const selected = orders.find((order) => order.id === selectedId)
  const pendingCount = orders.filter((order) => order.status === 'pending_quote').length
  const reviewCount = orders.filter((order) => ['submitted', 'reviewed', 'in_process'].includes(order.status)).length
  const acceptedCount = orders.filter((order) => order.status === 'accepted').length
  return <div className="procurement-page"><section className="procurement-hero anim-in d1"><div><span className="eyebrow">{admin ? 'Abastecimiento AS Labs' : 'Portal seguro de proveedores'}</span><h1>{admin ? 'Compras claras, cotizaciones trazables.' : `Bienvenido, ${(user.nombre || 'proveedor').split(' ')[0]}.`}</h1><p>{admin ? 'Emite órdenes, recibe propuestas y publica pagos en un solo flujo.' : 'Revisa tus solicitudes, cotiza en pocos pasos y sigue cada decisión con transparencia.'}</p>{admin && <button className="btn btn-accent" onClick={() => setCreating(true)}><IcoPlus /> Nueva orden de compra</button>}</div><div className="procurement-stats"><span><small>Pendientes de cotizar</small><strong>{loading ? '—' : pendingCount}</strong></span><span><small>En revisión</small><strong>{loading ? '—' : reviewCount}</strong></span><span><small>Aceptadas</small><strong>{loading ? '—' : acceptedCount}</strong></span></div></section><EthicsNotice /><div className="proc-filter-bar"><div className="segmented"><button className={filter === 'active' ? 'active' : ''} onClick={() => setFilter('active')}>En curso</button><button className={filter === 'pending_quote' ? 'active' : ''} onClick={() => setFilter('pending_quote')}>Por cotizar</button><button className={filter === 'accepted' ? 'active' : ''} onClick={() => setFilter('accepted')}>Aceptadas</button><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todas</button></div><span>{filtered.length} órdenes</span></div>{error && <div className="form-error">{error}</div>}<div className="procurement-workspace"><aside className="proc-order-list">{loading ? <div className="proc-list-loading">Cargando órdenes…</div> : filtered.length ? filtered.map((order) => <OrderCard order={order} admin={admin} selected={order.id === selectedId} onClick={() => setSelectedId(order.id)} key={order.id} />) : <div className="proc-list-empty"><IcoBox /><strong>No hay órdenes aquí</strong><p>{admin ? 'Emite una nueva orden cuando necesites cotizaciones.' : 'Las nuevas solicitudes aparecerán automáticamente.'}</p></div>}</aside><main>{selected ? <OrderDetail key={`${selected.id}-${selected.updated_at}-${selected.quote?.updatedAt || ''}`} order={selected} admin={admin} reload={load} notify={notify} /> : <div className="proc-select-empty"><IcoArrow /><strong>Selecciona una orden</strong><p>Verás todos sus detalles en este espacio.</p></div>}</main></div>{creating && <CreateOrderModal suppliers={suppliers} onClose={() => setCreating(false)} onSaved={load} notify={notify} />}</div>
}
