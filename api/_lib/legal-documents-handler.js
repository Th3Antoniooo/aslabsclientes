import crypto from 'node:crypto'
import { getUser } from './auth.js'
import { query } from './db.js'
import { body, json, methodNotAllowed } from './http.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const allowedMime = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
])
const MAX_FILE_SIZE = 5 * 1024 * 1024
const MAX_CHUNKS = 16
let schemaPromise

const clean = (value, max = 500) => String(value || '').trim().slice(0, max)
const isAdmin = (user) => user?.role === 'admin'

function ensureSchema() {
  if (!schemaPromise) schemaPromise = (async () => {
    await query(`INSERT INTO modules (id,name,description,sort_order)
      VALUES ('legal_documents','Documentos legales','Archivo legal compartido con clientes',26)
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,sort_order=EXCLUDED.sort_order`)
    await query(`INSERT INTO role_permissions (role_id,module_id,can_view,can_create,can_edit,can_delete)
      SELECT id,'legal_documents',true,true,false,false FROM roles WHERE slug='client'
      ON CONFLICT (role_id,module_id) DO UPDATE SET can_view=true,can_create=true`)
    await query(`INSERT INTO role_permissions (role_id,module_id,can_view,can_create,can_edit,can_delete)
      SELECT id,'legal_documents',true,true,true,true FROM roles WHERE slug='admin'
      ON CONFLICT (role_id,module_id) DO UPDATE SET can_view=true,can_create=true,can_edit=true,can_delete=true`)
    await query(`CREATE TABLE IF NOT EXISTS client_legal_documents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      client_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      service_id uuid REFERENCES service_requests(id) ON DELETE SET NULL,
      category text NOT NULL DEFAULT 'other',
      title text NOT NULL,
      notes text,
      file_name text NOT NULL,
      mime_type text NOT NULL,
      file_size integer NOT NULL CHECK (file_size > 0 AND file_size <= ${MAX_FILE_SIZE}),
      data_url text NOT NULL,
      uploaded_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      uploaded_by_role text NOT NULL CHECK (uploaded_by_role IN ('admin','client')),
      created_at timestamptz NOT NULL DEFAULT now()
    )`)
    await query(`CREATE INDEX IF NOT EXISTS client_legal_documents_client_time_idx ON client_legal_documents(client_user_id,created_at DESC)`)
    await query(`CREATE TABLE IF NOT EXISTS legal_document_uploads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      client_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      service_id uuid REFERENCES service_requests(id) ON DELETE SET NULL,
      category text NOT NULL,
      title text NOT NULL,
      notes text,
      file_name text NOT NULL,
      mime_type text NOT NULL,
      file_size integer NOT NULL,
      total_chunks integer NOT NULL,
      uploaded_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      uploaded_by_role text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`)
    await query(`CREATE TABLE IF NOT EXISTS legal_document_upload_chunks (
      upload_id uuid NOT NULL REFERENCES legal_document_uploads(id) ON DELETE CASCADE,
      chunk_index integer NOT NULL,
      chunk_data text NOT NULL,
      PRIMARY KEY (upload_id,chunk_index)
    )`)
    await query(`DELETE FROM legal_document_uploads WHERE created_at < NOW() - INTERVAL '24 hours'`)
  })().catch((error) => {
    schemaPromise = null
    throw error
  })
  return schemaPromise
}

async function catalog(user) {
  const clients = isAdmin(user) ? await query(
    `SELECT u.id,u.full_name,u.company,u.email
     FROM users u JOIN roles r ON r.id=u.role_id
     WHERE r.slug='client' AND u.status='active' ORDER BY u.full_name`,
  ) : []
  const services = await query(
    `SELECT s.id,s.code,s.client_user_id,COALESCE(NULLIF(s.display_name,''),s.service_type_name) AS name
     FROM service_requests s
     WHERE s.archived_at IS NULL AND ($1::boolean OR s.client_user_id=$2)
     ORDER BY s.requested_at DESC LIMIT 400`,
    [isAdmin(user),user.id],
  )
  return { clients,services }
}

async function listDocuments(user) {
  return query(
    `SELECT d.id,d.client_user_id,d.service_id,d.category,d.title,d.notes,d.file_name,d.mime_type,d.file_size,d.uploaded_by_role,d.created_at,
            client.full_name AS client_name,client.company AS client_company,uploader.full_name AS uploaded_by_name,s.code AS service_code
     FROM client_legal_documents d
     JOIN users client ON client.id=d.client_user_id
     JOIN users uploader ON uploader.id=d.uploaded_by_user_id
     LEFT JOIN service_requests s ON s.id=d.service_id
     WHERE ($1::boolean OR d.client_user_id=$2)
     ORDER BY d.created_at DESC`,
    [isAdmin(user),user.id],
  )
}

async function documentForUser(id, user) {
  if (!uuidPattern.test(String(id || ''))) return null
  const rows = await query(
    `SELECT * FROM client_legal_documents WHERE id=$1 AND ($2::boolean OR client_user_id=$3)`,
    [id,isAdmin(user),user.id],
  )
  return rows[0] || null
}

async function serveDocument(req, res, user) {
  const document = await documentForUser(req.query?.document, user)
  if (!document) return json(res, 404, { error:'Documento no encontrado.' })
  const match = String(document.data_url || '').match(/^data:([^;,]+);base64,(.+)$/)
  if (!match || !allowedMime.has(match[1].toLowerCase())) return json(res, 422, { error:'El archivo guardado no es válido.' })
  const safeName = String(document.file_name || 'documento').replace(/[\r\n"]/g, '')
  res.status(200)
  res.setHeader('Content-Type', document.mime_type)
  res.setHeader('Content-Disposition', `inline; filename="${safeName}"`)
  res.setHeader('Cache-Control', 'private, no-store')
  return res.end(Buffer.from(match[2], 'base64'))
}

async function beginUpload(payload, user) {
  const fileName = clean(payload.fileName, 180)
  const mimeType = clean(payload.mimeType, 120).toLowerCase()
  const fileSize = Number(payload.fileSize || 0)
  const totalChunks = Number(payload.totalChunks || 0)
  const category = clean(payload.category, 60) || 'other'
  const title = clean(payload.title, 240) || fileName.replace(/\.[^.]+$/, '')
  const notes = clean(payload.notes, 1500) || null
  const clientId = isAdmin(user) ? clean(payload.clientId, 80) : user.id
  const serviceId = clean(payload.serviceId, 80) || null
  if (!uuidPattern.test(clientId)) throw Object.assign(new Error('Selecciona un cliente válido.'), { status:400 })
  if (!fileName || !allowedMime.has(mimeType)) throw Object.assign(new Error('Usa PDF, DOC, DOCX, JPG, PNG o WEBP.'), { status:400 })
  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_FILE_SIZE) throw Object.assign(new Error('Cada documento puede pesar hasta 5 MB.'), { status:400 })
  if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > MAX_CHUNKS) throw Object.assign(new Error('La carga del archivo no es válida.'), { status:400 })
  const clients = await query(`SELECT id FROM users WHERE id=$1 AND status='active'`, [clientId])
  if (!clients[0]) throw Object.assign(new Error('El cliente seleccionado no está disponible.'), { status:404 })
  if (serviceId) {
    if (!uuidPattern.test(serviceId)) throw Object.assign(new Error('El servicio no es válido.'), { status:400 })
    const services = await query(`SELECT id FROM service_requests WHERE id=$1 AND client_user_id=$2 AND archived_at IS NULL`, [serviceId,clientId])
    if (!services[0]) throw Object.assign(new Error('El servicio no corresponde al cliente seleccionado.'), { status:400 })
  }
  const rows = await query(
    `INSERT INTO legal_document_uploads
      (client_user_id,service_id,category,title,notes,file_name,mime_type,file_size,total_chunks,uploaded_by_user_id,uploaded_by_role)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [clientId,serviceId,category,title,notes,fileName,mimeType,fileSize,totalChunks,user.id,user.role],
  )
  return rows[0].id
}

async function uploadForUser(uploadId, user) {
  if (!uuidPattern.test(String(uploadId || ''))) return null
  const rows = await query(
    `SELECT * FROM legal_document_uploads WHERE id=$1 AND (uploaded_by_user_id=$2 OR $3::boolean)`,
    [uploadId,user.id,isAdmin(user)],
  )
  return rows[0] || null
}

export default async function legalDocumentsHandler(req, res) {
  const user = await getUser(req)
  if (!user) return json(res, 401, { error:'Sesión no válida' })
  if (!['admin','client'].includes(user.role)) return json(res, 403, { error:'No tienes acceso a documentos legales.' })
  try {
    await ensureSchema()
    if (req.method === 'GET' && req.query?.document) return serveDocument(req,res,user)
    if (req.method === 'GET') {
      const [documents,options] = await Promise.all([listDocuments(user),catalog(user)])
      return json(res, 200, { documents,...options,maxFileSize:MAX_FILE_SIZE })
    }
    const payload = await body(req)
    if (req.method === 'POST' && payload.action === 'begin_upload') {
      const uploadId = await beginUpload(payload,user)
      return json(res, 201, { uploadId })
    }
    if (req.method === 'PATCH' && payload.action === 'upload_chunk') {
      const upload = await uploadForUser(payload.uploadId,user)
      if (!upload) return json(res, 404, { error:'Carga no encontrada.' })
      const index = Number(payload.index)
      const data = String(payload.data || '')
      if (!Number.isInteger(index) || index < 0 || index >= upload.total_chunks || !/^[A-Za-z0-9+/=]+$/.test(data) || data.length > 900000) return json(res, 400, { error:'Fragmento no válido.' })
      await query(
        `INSERT INTO legal_document_upload_chunks (upload_id,chunk_index,chunk_data) VALUES ($1,$2,$3)
         ON CONFLICT (upload_id,chunk_index) DO UPDATE SET chunk_data=EXCLUDED.chunk_data`,
        [upload.id,index,data],
      )
      return json(res, 200, { ok:true })
    }
    if (req.method === 'PATCH' && payload.action === 'complete_upload') {
      const upload = await uploadForUser(payload.uploadId,user)
      if (!upload) return json(res, 404, { error:'Carga no encontrada.' })
      const chunks = await query(
        `SELECT COUNT(*)::int AS count,string_agg(chunk_data,'' ORDER BY chunk_index) AS data
         FROM legal_document_upload_chunks WHERE upload_id=$1`,
        [upload.id],
      )
      if (chunks[0]?.count !== upload.total_chunks) return json(res, 409, { error:'Faltan partes del archivo. Vuelve a intentarlo.' })
      const binary = Buffer.from(chunks[0].data || '', 'base64')
      if (binary.length !== upload.file_size || binary.length > MAX_FILE_SIZE) return json(res, 400, { error:'El tamaño del archivo no coincide con la carga.' })
      const rows = await query(
        `INSERT INTO client_legal_documents
          (client_user_id,service_id,category,title,notes,file_name,mime_type,file_size,data_url,uploaded_by_user_id,uploaded_by_role)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [upload.client_user_id,upload.service_id,upload.category,upload.title,upload.notes,upload.file_name,upload.mime_type,upload.file_size,`data:${upload.mime_type};base64,${chunks[0].data}`,upload.uploaded_by_user_id,upload.uploaded_by_role],
      )
      await query(`DELETE FROM legal_document_uploads WHERE id=$1`, [upload.id])
      return json(res, 201, { documentId:rows[0].id })
    }
    if (req.method === 'DELETE') {
      if (!isAdmin(user)) return json(res, 403, { error:'Solo un administrador puede eliminar documentos.' })
      if (!uuidPattern.test(String(payload.documentId || ''))) return json(res, 400, { error:'Documento no válido.' })
      await query(`DELETE FROM client_legal_documents WHERE id=$1`, [payload.documentId])
      return json(res, 200, { ok:true })
    }
    return methodNotAllowed(res, ['GET','POST','PATCH','DELETE'])
  } catch (error) {
    console.error('No fue posible procesar documentos legales:', error)
    return json(res,error.status || 500,{ error:error.status ? error.message : 'No fue posible procesar los documentos legales.' })
  }
}
