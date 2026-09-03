import crypto from 'node:crypto'
import { requireUser } from './auth.js'
import { body, json, methodNotAllowed } from './http.js'
import { query } from './db.js'

const MAX_FILE_SIZE = 3 * 1024 * 1024
const ORDER_STATUSES = new Set(['reviewed', 'in_process', 'accepted', 'rejected'])

function clean(value, fallback = '') {
  return String(value ?? fallback).trim()
}

function positiveNumber(value, fallback = 0) {
  const result = Number(value)
  return Number.isFinite(result) && result >= 0 ? result : fallback
}

function validateFile(file, allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']) {
  if (!file) return null
  const size = Number(file.size || 0)
  const mimeType = clean(file.mimeType)
  if (!file.name || !file.dataUrl || !allowed.includes(mimeType)) {
    throw Object.assign(new Error('Adjunta un PDF o una imagen válida.'), { status: 400 })
  }
  if (!size || size > MAX_FILE_SIZE) {
    throw Object.assign(new Error('El archivo debe pesar como máximo 3 MB.'), { status: 400 })
  }
  return { name: clean(file.name), mimeType, size, dataUrl: file.dataUrl }
}

async function assertOrderAccess(id, current) {
  const params = [id]
  let access = ''
  if (current.role !== 'admin') {
    params.push(current.id)
    access = ' AND po.supplier_user_id=$2'
  }
  const rows = await query(
    `SELECT po.*,u.full_name AS supplier_name,u.email AS supplier_email,u.company AS supplier_company
     FROM purchase_orders po JOIN users u ON u.id=po.supplier_user_id
     WHERE po.id=$1${access} LIMIT 1`,
    params,
  )
  if (!rows[0]) throw Object.assign(new Error('Orden de compra no encontrada.'), { status: 404 })
  return rows[0]
}

async function listOrders(current) {
  const params = []
  let access = ''
  if (current.role !== 'admin') {
    params.push(current.id)
    access = 'WHERE po.supplier_user_id=$1'
  }
  return query(
    `SELECT po.*,u.full_name AS supplier_name,u.email AS supplier_email,u.company AS supplier_company,
            COALESCE(items.items,'[]'::jsonb) AS items,
            CASE WHEN q.id IS NULL THEN NULL ELSE jsonb_build_object(
              'id',q.id,'deliveryMode',q.delivery_mode,'deliveryTerm',q.delivery_term,
              'validityDays',q.validity_days,'currency',q.currency,'subtotal',q.subtotal,
              'igvRate',q.igv_rate,'igvAmount',q.igv_amount,'total',q.total,'notes',q.notes,
              'fileName',q.file_name,'fileMimeType',q.file_mime_type,'fileSize',q.file_size,
              'submittedAt',q.submitted_at,'updatedAt',q.updated_at,
              'items',COALESCE(qitems.items,'[]'::jsonb)
            ) END AS quote,
            COALESCE(receipts.receipts,'[]'::jsonb) AS payment_receipts
     FROM purchase_orders po
     JOIN users u ON u.id=po.supplier_user_id
     LEFT JOIN supplier_quotes q ON q.purchase_order_id=po.id
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object(
         'id',i.id,'product',i.product,'description',i.description,
         'quantity',i.quantity,'unit',i.unit
       ) ORDER BY i.sort_order,i.created_at) AS items
       FROM purchase_order_items i WHERE i.purchase_order_id=po.id
     ) items ON true
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object(
         'id',qi.id,'product',qi.product,'description',qi.description,
         'quantity',qi.quantity,'unit',qi.unit,'unitPrice',qi.unit_price,'lineTotal',qi.line_total
       ) ORDER BY qi.sort_order,qi.created_at) AS items
       FROM supplier_quote_items qi WHERE qi.quote_id=q.id
     ) qitems ON true
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object(
         'id',r.id,'fileName',r.file_name,'mimeType',r.mime_type,'fileSize',r.file_size,
         'paymentReference',r.payment_reference,'paymentDate',r.payment_date,'notes',r.notes,
         'createdAt',r.created_at
       ) ORDER BY r.created_at DESC) AS receipts
       FROM supplier_payment_receipts r WHERE r.purchase_order_id=po.id
     ) receipts ON true
     ${access}
     ORDER BY CASE po.status
       WHEN 'pending_quote' THEN 1 WHEN 'submitted' THEN 2 WHEN 'reviewed' THEN 3
       WHEN 'in_process' THEN 4 WHEN 'accepted' THEN 5 ELSE 6 END,po.created_at DESC`,
    params,
  )
}

async function sendStoredFile(res, table, id, current) {
  const config = table === 'quote'
    ? { sql: `SELECT q.file_name,q.file_mime_type AS mime_type,q.file_data_url AS data_url
              FROM supplier_quotes q JOIN purchase_orders po ON po.id=q.purchase_order_id
              WHERE q.purchase_order_id=$1`, owner: 'po' }
    : { sql: `SELECT r.file_name,r.mime_type,r.data_url
              FROM supplier_payment_receipts r JOIN purchase_orders po ON po.id=r.purchase_order_id
              WHERE r.id=$1`, owner: 'po' }
  const params = [id]
  let sql = config.sql
  if (current.role !== 'admin') {
    params.push(current.id)
    sql += ' AND po.supplier_user_id=$2'
  }
  const rows = await query(sql, params)
  const file = rows[0]
  if (!file?.data_url) return json(res, 404, { error: 'Archivo no disponible.' })
  const match = file.data_url.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return json(res, 500, { error: 'El archivo almacenado no es válido.' })
  res.setHeader('Content-Type', file.mime_type || match[1])
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.file_name)}`)
  res.setHeader('Cache-Control', 'private, max-age=60')
  return res.status(200).send(Buffer.from(match[2], 'base64'))
}

export default async function handler(req, res) {
  const action = req.method === 'GET' ? 'view' : req.method === 'POST' ? 'create' : 'edit'
  const current = await requireUser(req, res, 'procurement', action)
  if (!current) return

  try {
    if (req.method === 'GET' && req.query?.file) {
      return sendStoredFile(res, req.query.file, req.query.id, current)
    }
    if (req.method === 'GET') {
      const orders = await listOrders(current)
      let suppliers = []
      if (current.role === 'admin') {
        suppliers = await query(
          `SELECT u.id,u.full_name,u.email,u.company
           FROM users u JOIN roles r ON r.id=u.role_id
           WHERE r.slug='supplier' AND u.status='active' ORDER BY u.company,u.full_name`,
        )
      }
      return json(res, 200, { orders, suppliers })
    }

    const payload = await body(req)
    if (req.method === 'POST') {
      if (current.role !== 'admin') return json(res, 403, { error: 'Solo un administrador puede emitir órdenes de compra.' })
      const items = Array.isArray(payload.items) ? payload.items.filter((item) => clean(item.product) && positiveNumber(item.quantity) > 0) : []
      let supplierUserId = clean(payload.supplierUserId)
      if (!supplierUserId) {
        const availableSuppliers = await query(
          `SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
           WHERE r.slug='supplier' AND u.status='active' ORDER BY u.created_at LIMIT 2`,
        )
        if (availableSuppliers.length === 1) supplierUserId = availableSuppliers[0].id
      }
      const title = clean(payload.title) || clean(payload.description) || clean(items[0]?.product)
      if (!supplierUserId) return json(res, 400, { error: 'Selecciona el proveedor que recibirá la orden.' })
      if (!title) return json(res, 400, { error: 'Escribe el motivo de la compra.' })
      if (!items.length) return json(res, 400, { error: 'Agrega al menos un producto con una cantidad mayor que cero.' })
      const supplier = await query(
        `SELECT u.id,u.full_name FROM users u JOIN roles r ON r.id=u.role_id
         WHERE u.id=$1 AND r.slug='supplier' AND u.status='active'`,
        [supplierUserId],
      )
      if (!supplier[0]) return json(res, 400, { error: 'Selecciona un proveedor activo.' })
      const code = `OC-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
      const created = await query(
        `INSERT INTO purchase_orders
         (code,supplier_user_id,title,description,required_at,delivery_address,delivery_instructions,created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [code,supplierUserId,title,clean(payload.description)||null,payload.requiredAt||null,
          clean(payload.deliveryAddress)||null,clean(payload.deliveryInstructions)||null,current.id],
      )
      for (const [index, item] of items.entries()) {
        await query(
          `INSERT INTO purchase_order_items
           (purchase_order_id,product,description,quantity,unit,sort_order)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [created[0].id,clean(item.product),clean(item.description)||null,positiveNumber(item.quantity),clean(item.unit,'unidad')||'unidad',index],
        )
      }
      await query(
        `INSERT INTO notifications (user_id,title,body,type,priority,audience,action_url)
         VALUES ($1,'Nueva orden de compra',$2,'procurement','high','all','procurement')`,
        [supplierUserId,`${code}: ${title}. Ya puedes enviar tu cotización.`],
      )
      return json(res, 201, { order: created[0] })
    }

    if (req.method !== 'PATCH') return methodNotAllowed(res, ['GET', 'POST', 'PATCH'])
    const order = await assertOrderAccess(payload.id, current)

    if (payload.action === 'submit_quote') {
      if (current.role !== 'supplier') return json(res, 403, { error: 'Esta acción corresponde al proveedor.' })
      if (['accepted', 'rejected'].includes(order.status)) return json(res, 409, { error: 'Esta orden ya fue cerrada por AS Labs.' })
      const items = Array.isArray(payload.items) ? payload.items.filter((item) => clean(item.product) && positiveNumber(item.quantity) > 0) : []
      if (!items.length || !clean(payload.deliveryMode)) return json(res, 400, { error: 'Completa los productos y el modo de entrega.' })
      const subtotal = items.reduce((sum, item) => sum + positiveNumber(item.quantity) * positiveNumber(item.unitPrice), 0)
      const igvRate = positiveNumber(payload.igvRate, 18)
      const igvAmount = subtotal * igvRate / 100
      const total = subtotal + igvAmount
      const file = validateFile(payload.file)
      const quoteRows = await query(
        `INSERT INTO supplier_quotes
         (purchase_order_id,supplier_user_id,delivery_mode,delivery_term,validity_days,currency,
          subtotal,igv_rate,igv_amount,total,notes,file_name,file_mime_type,file_size,file_data_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (purchase_order_id) DO UPDATE SET
          delivery_mode=EXCLUDED.delivery_mode,delivery_term=EXCLUDED.delivery_term,
          validity_days=EXCLUDED.validity_days,currency=EXCLUDED.currency,subtotal=EXCLUDED.subtotal,
          igv_rate=EXCLUDED.igv_rate,igv_amount=EXCLUDED.igv_amount,total=EXCLUDED.total,
          notes=EXCLUDED.notes,file_name=COALESCE(EXCLUDED.file_name,supplier_quotes.file_name),
          file_mime_type=COALESCE(EXCLUDED.file_mime_type,supplier_quotes.file_mime_type),
          file_size=COALESCE(EXCLUDED.file_size,supplier_quotes.file_size),
          file_data_url=COALESCE(EXCLUDED.file_data_url,supplier_quotes.file_data_url),
          submitted_at=NOW(),updated_at=NOW()
         RETURNING id`,
        [order.id,current.id,clean(payload.deliveryMode),clean(payload.deliveryTerm)||null,
          payload.validityDays?Math.round(positiveNumber(payload.validityDays)):null,
          payload.currency==='USD'?'USD':'PEN',subtotal,igvRate,igvAmount,total,clean(payload.notes)||null,
          file?.name||null,file?.mimeType||null,file?.size||null,file?.dataUrl||null],
      )
      await query('DELETE FROM supplier_quote_items WHERE quote_id=$1',[quoteRows[0].id])
      for (const [index,item] of items.entries()) {
        const quantity = positiveNumber(item.quantity)
        const unitPrice = positiveNumber(item.unitPrice)
        await query(
          `INSERT INTO supplier_quote_items
           (quote_id,product,description,quantity,unit,unit_price,line_total,sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [quoteRows[0].id,clean(item.product),clean(item.description)||null,quantity,clean(item.unit,'unidad')||'unidad',unitPrice,quantity*unitPrice,index],
        )
      }
      await query(`UPDATE purchase_orders SET status='submitted',updated_at=NOW() WHERE id=$1`,[order.id])
      const admins = await query(`SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.slug='admin' AND u.status='active'`)
      for (const admin of admins) {
        await query(
          `INSERT INTO notifications (user_id,title,body,type,priority,audience,action_url)
           VALUES ($1,'Cotización recibida',$2,'procurement','high','admin','procurement')`,
          [admin.id,`${order.code}: ${order.supplier_company || order.supplier_name} envió su cotización.`],
        )
      }
      return json(res, 200, { ok: true })
    }

    if (current.role !== 'admin') return json(res, 403, { error: 'Solo un administrador puede actualizar este estado.' })
    if (payload.action === 'set_status') {
      if (!ORDER_STATUSES.has(payload.status)) return json(res, 400, { error: 'Estado no válido.' })
      if (!order.status || order.status === 'pending_quote') return json(res, 409, { error: 'El proveedor todavía no ha enviado una cotización.' })
      await query(
        `UPDATE purchase_orders SET status=$2,admin_notes=$3,reviewed_by_user_id=$4,
         reviewed_at=CASE WHEN $2 IN ('reviewed','in_process','accepted','rejected') THEN NOW() ELSE reviewed_at END,
         accepted_at=CASE WHEN $2='accepted' THEN NOW() ELSE accepted_at END,updated_at=NOW() WHERE id=$1`,
        [order.id,payload.status,clean(payload.adminNotes)||null,current.id],
      )
      const statusText = { reviewed:'revisada',in_process:'en proceso',accepted:'aceptada',rejected:'no aceptada' }[payload.status]
      await query(
        `INSERT INTO notifications (user_id,title,body,type,priority,audience,action_url)
         VALUES ($1,'Cotización actualizada',$2,'procurement',$3,'all','procurement')`,
        [order.supplier_user_id,`${order.code}: tu cotización fue marcada como ${statusText}.`,payload.status==='accepted'?'high':'normal'],
      )
      return json(res, 200, { ok: true })
    }

    if (payload.action === 'upload_payment') {
      if (order.status !== 'accepted') return json(res, 409, { error: 'Primero acepta la cotización.' })
      const file = validateFile(payload.file)
      if (!file) return json(res, 400, { error: 'Adjunta el comprobante de pago.' })
      await query(
        `INSERT INTO supplier_payment_receipts
         (purchase_order_id,file_name,mime_type,file_size,data_url,payment_reference,payment_date,notes,uploaded_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [order.id,file.name,file.mimeType,file.size,file.dataUrl,clean(payload.paymentReference)||null,
          payload.paymentDate||null,clean(payload.notes)||null,current.id],
      )
      await query(
        `INSERT INTO notifications (user_id,title,body,type,priority,audience,action_url)
         VALUES ($1,'Comprobante de pago disponible',$2,'procurement','high','all','procurement')`,
        [order.supplier_user_id,`${order.code}: AS Labs adjuntó el comprobante de pago.`],
      )
      return json(res, 200, { ok: true })
    }

    return json(res, 400, { error: 'Acción no reconocida.' })
  } catch (error) {
    console.error('Procurement error', error)
    return json(res, error.status || 500, { error: error.status ? error.message : 'No fue posible completar la operación de compras.' })
  }
}
