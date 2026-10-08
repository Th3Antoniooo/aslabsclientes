import crypto from 'node:crypto'
import { getUser } from './_lib/auth.js'
import { query } from './_lib/db.js'
import { body, json, methodNotAllowed } from './_lib/http.js'
import { sendPaymentRequestEmail } from './_lib/email.js'

const TEST_RECIPIENT = 'antonioavg041@gmail.com'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const allowedMime = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
let schemaPromise

const text = (value, max = 500) => String(value || '').trim().slice(0, max)
const isAdmin = (user) => user?.role === 'admin'

function paymentConfiguration() {
  return {
    yape: {
      number: text(process.env.PAYMENT_YAPE_NUMBER, 40),
      qrUrl: text(process.env.PAYMENT_YAPE_QR_URL, 1200),
    },
    bank: {
      name: text(process.env.PAYMENT_BANK_NAME, 120),
      account: text(process.env.PAYMENT_BANK_ACCOUNT, 120),
      cci: text(process.env.PAYMENT_BANK_CCI, 120),
    },
    email: { testMode:true, recipient:TEST_RECIPIENT },
    fiscal: {
      enabled:Boolean(process.env.APISUNAT_API_URL && process.env.APISUNAT_API_TOKEN),
      provider:'API SUNAT',
    },
  }
}

function ensureSchema() {
  if (!schemaPromise) schemaPromise = (async () => {
    await query(`INSERT INTO modules (id,name,description,sort_order)
      VALUES ('payments','Pagos','Solicitudes y comprobantes de pago de clientes',25)
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,sort_order=EXCLUDED.sort_order`)
    await query(`INSERT INTO role_permissions (role_id,module_id,can_view,can_create,can_edit,can_delete)
      SELECT id,'payments',true,true,true,false FROM roles WHERE slug='client'
      ON CONFLICT (role_id,module_id) DO UPDATE SET can_view=true,can_create=true,can_edit=true`)
    await query(`INSERT INTO role_permissions (role_id,module_id,can_view,can_create,can_edit,can_delete)
      SELECT id,'payments',true,true,true,true FROM roles WHERE slug='admin'
      ON CONFLICT (role_id,module_id) DO UPDATE SET can_view=true,can_create=true,can_edit=true,can_delete=true`)
    await query(`CREATE TABLE IF NOT EXISTS client_payment_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code text NOT NULL UNIQUE,
      service_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE RESTRICT,
      client_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      amount numeric(14,2) NOT NULL CHECK (amount > 0),
      currency text NOT NULL DEFAULT 'PEN' CHECK (currency IN ('PEN','USD')),
      concept text NOT NULL,
      document_type text NOT NULL DEFAULT 'boleta' CHECK (document_type IN ('boleta','factura')),
      due_date date,
      notes text,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','receipt_submitted','approved','rejected','cancelled')),
      review_notes text,
      created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      reviewed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at timestamptz,
      fiscal_status text NOT NULL DEFAULT 'not_issued' CHECK (fiscal_status IN ('not_issued','pending','issued','failed')),
      fiscal_document_id text,
      fiscal_document_url text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`)
    await query(`CREATE INDEX IF NOT EXISTS client_payment_requests_client_time_idx ON client_payment_requests(client_user_id,created_at DESC)`)
    await query(`CREATE INDEX IF NOT EXISTS client_payment_requests_status_time_idx ON client_payment_requests(status,created_at DESC)`)
    await query(`CREATE TABLE IF NOT EXISTS client_payment_receipts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      payment_request_id uuid NOT NULL REFERENCES client_payment_requests(id) ON DELETE CASCADE,
      file_name text NOT NULL,
      mime_type text NOT NULL,
      file_size integer NOT NULL CHECK (file_size > 0),
      data_url text NOT NULL,
      payment_reference text,
      payment_date date,
      notes text,
      uploaded_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      uploaded_by_role text NOT NULL CHECK (uploaded_by_role IN ('admin','client')),
      created_at timestamptz NOT NULL DEFAULT now()
    )`)
    await query(`CREATE INDEX IF NOT EXISTS client_payment_receipts_request_time_idx ON client_payment_receipts(payment_request_id,created_at DESC)`)
  })().catch((error) => {
    schemaPromise = null
    throw error
  })
  return schemaPromise
}

function paymentCode() {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  return `PAG-${date}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
}

function validateFile(file) {
  if (!file || typeof file !== 'object') throw Object.assign(new Error('Selecciona un comprobante válido.'), { status:400 })
  const fileName = text(file.name, 180)
  const mimeType = text(file.type, 80).toLowerCase()
  const fileSize = Number(file.size || 0)
  const dataUrl = String(file.dataUrl || '')
  if (!fileName || !allowedMime.has(mimeType)) throw Object.assign(new Error('El comprobante debe ser PDF, JPG, PNG o WEBP.'), { status:400 })
  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > 3 * 1024 * 1024) throw Object.assign(new Error('Cada comprobante puede pesar hasta 3 MB.'), { status:400 })
  const match = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/)
  if (!match || match[1].toLowerCase() !== mimeType) throw Object.assign(new Error('No pudimos validar el archivo adjunto.'), { status:400 })
  return { fileName,mimeType,fileSize,dataUrl }
}

async function paymentForUser(id, user) {
  if (!uuidPattern.test(String(id || ''))) return null
  const rows = await query(
    `SELECT p.*,s.code AS service_code,COALESCE(NULLIF(s.display_name,''),s.service_type_name) AS service_name,
            u.full_name AS client_name,u.email AS client_email,u.company AS client_company,u.dni AS client_dni
     FROM client_payment_requests p
     JOIN service_requests s ON s.id=p.service_id
     JOIN users u ON u.id=p.client_user_id
     WHERE p.id=$1 AND ($2::boolean OR p.client_user_id=$3)`,
    [id,isAdmin(user),user.id],
  )
  return rows[0] || null
}

async function listPayments(user) {
  const params = isAdmin(user) ? [] : [user.id]
  const where = isAdmin(user) ? '' : 'WHERE p.client_user_id=$1'
  const payments = await query(
    `SELECT p.*,s.code AS service_code,COALESCE(NULLIF(s.display_name,''),s.service_type_name) AS service_name,
            u.full_name AS client_name,u.email AS client_email,u.company AS client_company,u.dni AS client_dni,
            creator.full_name AS created_by_name,reviewer.full_name AS reviewed_by_name
     FROM client_payment_requests p
     JOIN service_requests s ON s.id=p.service_id
     JOIN users u ON u.id=p.client_user_id
     JOIN users creator ON creator.id=p.created_by_user_id
     LEFT JOIN users reviewer ON reviewer.id=p.reviewed_by_user_id
     ${where}
     ORDER BY CASE p.status WHEN 'receipt_submitted' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,p.created_at DESC`,
    params,
  )
  const ids = payments.map((item) => item.id)
  const receipts = ids.length ? await query(
    `SELECT r.id,r.payment_request_id,r.file_name,r.mime_type,r.file_size,r.payment_reference,r.payment_date,r.notes,
            r.uploaded_by_role,r.created_at,u.full_name AS uploaded_by_name
     FROM client_payment_receipts r JOIN users u ON u.id=r.uploaded_by_user_id
     WHERE r.payment_request_id=ANY($1::uuid[]) ORDER BY r.created_at DESC`,
    [ids],
  ) : []
  const byPayment = receipts.reduce((map, receipt) => {
    ;(map[receipt.payment_request_id] ||= []).push(receipt)
    return map
  }, {})
  return payments.map((payment) => ({ ...payment,receipts:byPayment[payment.id] || [] }))
}

async function listServices(user) {
  if (!isAdmin(user)) return []
  return query(
    `SELECT s.id,s.code,s.client_user_id,COALESCE(NULLIF(s.display_name,''),s.service_type_name) AS name,
            u.full_name AS client_name,u.email AS client_email,u.company AS client_company
     FROM service_requests s JOIN users u ON u.id=s.client_user_id
     WHERE s.archived_at IS NULL ORDER BY s.requested_at DESC LIMIT 300`,
  )
}

async function notifyAdmins(title, message) {
  await query(
    `INSERT INTO notifications (user_id,title,body,type,priority,audience,action_url)
     SELECT u.id,$1,$2,'payment','high','admin','payments'
     FROM users u JOIN roles r ON r.id=u.role_id WHERE r.slug='admin' AND u.status='active'`,
    [title,message],
  )
}

async function serveReceipt(req, res, user) {
  const id = req.query?.receipt
  if (!uuidPattern.test(String(id || ''))) return json(res, 400, { error:'Comprobante no válido.' })
  const rows = await query(
    `SELECT r.file_name,r.mime_type,r.data_url,p.client_user_id
     FROM client_payment_receipts r JOIN client_payment_requests p ON p.id=r.payment_request_id
     WHERE r.id=$1`,
    [id],
  )
  const receipt = rows[0]
  if (!receipt || (!isAdmin(user) && receipt.client_user_id !== user.id)) return json(res, 404, { error:'Comprobante no encontrado.' })
  const match = String(receipt.data_url || '').match(/^data:([^;,]+);base64,(.+)$/)
  if (!match || !allowedMime.has(match[1].toLowerCase())) return json(res, 422, { error:'El archivo guardado no es válido.' })
  const safeName = String(receipt.file_name || 'comprobante').replace(/[\r\n"]/g, '')
  res.status(200)
  res.setHeader('Content-Type', receipt.mime_type)
  res.setHeader('Content-Disposition', `inline; filename="${safeName}"`)
  res.setHeader('Cache-Control', 'private, no-store')
  return res.end(Buffer.from(match[2], 'base64'))
}

export default async function handler(req, res) {
  const user = await getUser(req)
  if (!user) return json(res, 401, { error:'Sesión no válida' })
  if (!['admin','client'].includes(user.role)) return json(res, 403, { error:'No tienes acceso al módulo de pagos.' })
  try {
    await ensureSchema()
    if (req.method === 'GET' && req.query?.receipt) return serveReceipt(req,res,user)

    if (req.method === 'GET') {
      const [payments,services] = await Promise.all([listPayments(user),listServices(user)])
      const stats = payments.reduce((summary, payment) => {
        summary.total += 1
        summary[payment.status] = (summary[payment.status] || 0) + 1
        if (payment.status === 'approved') summary.approvedAmount += Number(payment.amount || 0)
        if (['pending','receipt_submitted'].includes(payment.status)) summary.pendingAmount += Number(payment.amount || 0)
        return summary
      }, { total:0,pending:0,receipt_submitted:0,approved:0,rejected:0,cancelled:0,approvedAmount:0,pendingAmount:0 })
      return json(res, 200, { payments,services,stats,configuration:paymentConfiguration() })
    }

    if (req.method === 'POST') {
      if (!isAdmin(user)) return json(res, 403, { error:'Solo un administrador puede solicitar pagos.' })
      const payload = await body(req)
      const serviceId = text(payload.serviceId, 80)
      const amount = Number(payload.amount)
      const currency = payload.currency === 'USD' ? 'USD' : 'PEN'
      const concept = text(payload.concept, 500)
      const documentType = payload.documentType === 'factura' ? 'factura' : 'boleta'
      const dueDate = text(payload.dueDate, 10) || null
      const notes = text(payload.notes, 2000) || null
      if (!uuidPattern.test(serviceId) || !Number.isFinite(amount) || amount <= 0 || !concept) return json(res, 400, { error:'Selecciona una orden e indica un concepto e importe válidos.' })
      const services = await query(`SELECT id,client_user_id,code FROM service_requests WHERE id=$1 AND archived_at IS NULL`, [serviceId])
      const service = services[0]
      if (!service) return json(res, 404, { error:'La orden seleccionada no existe.' })
      const rows = await query(
        `INSERT INTO client_payment_requests
          (code,service_id,client_user_id,amount,currency,concept,document_type,due_date,notes,created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [paymentCode(),service.id,service.client_user_id,amount,currency,concept,documentType,dueDate,notes,user.id],
      )
      const payment = rows[0]
      await query(
        `INSERT INTO notifications (user_id,title,body,type,priority,audience,action_url)
         VALUES ($1,$2,$3,'payment','high','client','payments')`,
        [service.client_user_id,'Nueva solicitud de pago',`${payment.code} · ${concept} · ${currency === 'USD' ? 'US$' : 'S/'} ${amount.toFixed(2)}`],
      )
      const email = await sendPaymentRequestEmail(service.id, { ...payment,documentType })
      return json(res, 201, { payment,email })
    }

    if (req.method === 'PATCH') {
      const payload = await body(req)
      const payment = await paymentForUser(payload.paymentId, user)
      if (!payment) return json(res, 404, { error:'Solicitud de pago no encontrada.' })

      if (payload.action === 'upload_receipt') {
        if (['approved','cancelled'].includes(payment.status)) return json(res, 409, { error:'Esta solicitud ya no admite nuevos comprobantes.' })
        const file = validateFile(payload.file)
        const wasSubmitted = payment.status === 'receipt_submitted'
        const rows = await query(
          `INSERT INTO client_payment_receipts
            (payment_request_id,file_name,mime_type,file_size,data_url,payment_reference,payment_date,notes,uploaded_by_user_id,uploaded_by_role)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [payment.id,file.fileName,file.mimeType,file.fileSize,file.dataUrl,text(payload.reference,120) || null,text(payload.paymentDate,10) || null,text(payload.notes,1000) || null,user.id,user.role],
        )
        await query(`UPDATE client_payment_requests SET status='receipt_submitted',review_notes=NULL,updated_at=NOW() WHERE id=$1`, [payment.id])
        if (!wasSubmitted && !isAdmin(user)) await notifyAdmins('Comprobante de pago recibido', `${payment.client_name} adjuntó comprobantes para ${payment.code}.`)
        if (isAdmin(user)) {
          await query(`INSERT INTO notifications (user_id,title,body,type,priority,audience,action_url) VALUES ($1,$2,$3,'payment','normal','client','payments')`, [payment.client_user_id,'Comprobante registrado',`AS Labs registró un comprobante para ${payment.code}.`])
        }
        return json(res, 200, { ok:true,receiptId:rows[0]?.id })
      }

      if (payload.action === 'review') {
        if (!isAdmin(user)) return json(res, 403, { error:'Solo un administrador puede revisar pagos.' })
        const decision = payload.decision === 'approved' ? 'approved' : payload.decision === 'rejected' ? 'rejected' : null
        if (!decision) return json(res, 400, { error:'Decisión no válida.' })
        const count = await query(`SELECT COUNT(*)::int AS total FROM client_payment_receipts WHERE payment_request_id=$1`, [payment.id])
        if (!count[0]?.total) return json(res, 409, { error:'Adjunta al menos un comprobante antes de revisar el pago.' })
        const reviewNotes = text(payload.notes, 1500) || null
        if (decision === 'rejected' && !reviewNotes) return json(res, 400, { error:'Indica al cliente qué debe corregir.' })
        await query(
          `UPDATE client_payment_requests SET status=$2,review_notes=$3,reviewed_by_user_id=$4,reviewed_at=NOW(),updated_at=NOW() WHERE id=$1`,
          [payment.id,decision,reviewNotes,user.id],
        )
        await query(
          `INSERT INTO notifications (user_id,title,body,type,priority,audience,action_url)
           VALUES ($1,$2,$3,'payment',$4,'client','payments')`,
          [payment.client_user_id,decision === 'approved' ? 'Pago confirmado' : 'Comprobante observado',decision === 'approved' ? `${payment.code} fue aprobado por AS Labs.` : `${payment.code} requiere una corrección. ${reviewNotes || ''}`.trim(),decision === 'approved' ? 'normal' : 'high'],
        )
        return json(res, 200, { ok:true,status:decision })
      }

      if (payload.action === 'cancel') {
        if (!isAdmin(user)) return json(res, 403, { error:'Solo un administrador puede cancelar solicitudes.' })
        await query(`UPDATE client_payment_requests SET status='cancelled',updated_at=NOW() WHERE id=$1`, [payment.id])
        return json(res, 200, { ok:true })
      }

      if (payload.action === 'issue_fiscal_document') {
        if (!isAdmin(user)) return json(res, 403, { error:'Solo un administrador puede emitir comprobantes electrónicos.' })
        if (payment.status !== 'approved') return json(res, 409, { error:'Primero debes aprobar el pago.' })
        return json(res, 501, { error:'La emisión está preparada, pero falta configurar y validar el contrato de API SUNAT antes de emitir documentos reales.' })
      }

      return json(res, 400, { error:'Acción no reconocida.' })
    }
    return methodNotAllowed(res, ['GET','POST','PATCH'])
  } catch (error) {
    console.error('No fue posible procesar pagos:', error)
    return json(res, error.status || 500, { error:error.status ? error.message : 'No fue posible procesar el módulo de pagos.' })
  }
}
