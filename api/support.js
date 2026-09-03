import { randomBytes } from 'node:crypto'
import { getUser } from './_lib/auth.js'
import { body, json, methodNotAllowed } from './_lib/http.js'
import { query } from './_lib/db.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CATEGORIES = new Set(['general', 'order', 'sample', 'results', 'documents', 'technical'])
const STATUSES = new Set(['open', 'answered', 'closed'])

function clean(value, max = 4000) {
  return String(value || '').trim().slice(0, max)
}

async function listTickets(user) {
  const where = user.role === 'admin' ? '' : 'WHERE t.client_user_id=$1'
  const params = user.role === 'admin' ? [] : [user.id]
  const tickets = await query(
    `SELECT t.id,t.code,t.subject,t.category,t.priority,t.status,t.last_message_at,
            t.created_at,t.updated_at,t.client_user_id,t.service_id,
            u.full_name AS client_name,u.email AS client_email,u.company AS client_company,
            s.code AS service_code,COALESCE(NULLIF(s.display_name,''),s.service_type_name) AS service_name,
            COALESCE(
              JSONB_AGG(
                JSONB_BUILD_OBJECT(
                  'id',m.id,'message',m.message,'createdAt',m.created_at,
                  'authorId',m.author_user_id,'authorName',mu.full_name,'authorRole',mr.slug
                ) ORDER BY m.created_at
              ) FILTER (WHERE m.id IS NOT NULL),
              '[]'::jsonb
            ) AS messages
     FROM support_tickets t
     JOIN users u ON u.id=t.client_user_id
     LEFT JOIN service_requests s ON s.id=t.service_id
     LEFT JOIN support_messages m ON m.ticket_id=t.id
     LEFT JOIN users mu ON mu.id=m.author_user_id
     LEFT JOIN roles mr ON mr.id=mu.role_id
     ${where}
     GROUP BY t.id,u.full_name,u.email,u.company,s.code,s.display_name,s.service_type_name
     ORDER BY t.last_message_at DESC`,
    params,
  )
  const services = user.role === 'client' ? await query(
    `SELECT id,code,COALESCE(NULLIF(display_name,''),service_type_name) AS name
     FROM service_requests
     WHERE client_user_id=$1 AND archived_at IS NULL
     ORDER BY requested_at DESC LIMIT 100`,
    [user.id],
  ) : []
  const stats = tickets.reduce((acc, ticket) => {
    acc.total += 1
    acc[ticket.status] += 1
    return acc
  }, { total:0,open:0,answered:0,closed:0 })
  return { tickets, services, stats }
}

async function notifyAdmins(title, text) {
  await query(
    `INSERT INTO notifications (user_id,title,body,type,priority,audience,action_url)
     SELECT u.id,$1,$2,'support','normal','admin','asistencia'
     FROM users u JOIN roles r ON r.id=u.role_id
     WHERE r.slug='admin' AND u.status='active'`,
    [title, text],
  )
}

async function notifyClient(clientId, title, text) {
  await query(
    `INSERT INTO notifications (user_id,title,body,type,priority,audience,action_url)
     VALUES ($1,$2,$3,'support','normal','client','asistencia')`,
    [clientId, title, text],
  )
}

async function createTicket(user, payload) {
  if (user.role !== 'client') throw Object.assign(new Error('Solo los clientes pueden iniciar una consulta.'), { status:403 })
  const subject = clean(payload.subject, 160)
  const message = clean(payload.message)
  const category = CATEGORIES.has(payload.category) ? payload.category : 'general'
  const serviceId = payload.serviceId && UUID.test(payload.serviceId) ? payload.serviceId : null
  if (subject.length < 3) throw Object.assign(new Error('Escribe un asunto para tu consulta.'), { status:400 })
  if (message.length < 2) throw Object.assign(new Error('Escribe tu pregunta.'), { status:400 })
  if (serviceId) {
    const owned = await query('SELECT id FROM service_requests WHERE id=$1 AND client_user_id=$2', [serviceId, user.id])
    if (!owned.length) throw Object.assign(new Error('La orden seleccionada no está disponible.'), { status:400 })
  }
  const code = `AST-${new Date().getFullYear()}-${randomBytes(3).toString('hex').toUpperCase()}`
  const rows = await query(
    `WITH created AS (
       INSERT INTO support_tickets (code,client_user_id,service_id,subject,category,priority)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
     ), message AS (
       INSERT INTO support_messages (ticket_id,author_user_id,message)
       SELECT id,$2,$7 FROM created
     ) SELECT * FROM created`,
    [code,user.id,serviceId,subject,category,payload.priority === 'high' ? 'high' : 'normal',message],
  )
  await notifyAdmins(`Nueva consulta · ${code}`, `${user.nombre} escribió: ${subject}`)
  return rows[0]
}

async function ticketForUser(user, ticketId) {
  if (!UUID.test(ticketId || '')) throw Object.assign(new Error('Consulta no válida.'), { status:400 })
  const rows = await query('SELECT * FROM support_tickets WHERE id=$1', [ticketId])
  const ticket = rows[0]
  if (!ticket || (user.role !== 'admin' && ticket.client_user_id !== user.id)) {
    throw Object.assign(new Error('No tienes acceso a esta consulta.'), { status:404 })
  }
  return ticket
}

async function replyTicket(user, payload) {
  const ticket = await ticketForUser(user, payload.ticketId)
  const message = clean(payload.message)
  if (message.length < 2) throw Object.assign(new Error('Escribe una respuesta.'), { status:400 })
  if (ticket.status === 'closed') throw Object.assign(new Error('Esta consulta está cerrada. Reábrela para responder.'), { status:400 })
  const nextStatus = user.role === 'admin' ? 'answered' : 'open'
  await query(
    `WITH inserted AS (
       INSERT INTO support_messages (ticket_id,author_user_id,message)
       VALUES ($1,$2,$3) RETURNING id
     ) UPDATE support_tickets SET status=$4,last_message_at=NOW(),updated_at=NOW() WHERE id=$1`,
    [ticket.id,user.id,message,nextStatus],
  )
  if (user.role === 'admin') {
    await notifyClient(ticket.client_user_id, `AS Labs respondió · ${ticket.code}`, ticket.subject)
  } else {
    await notifyAdmins(`Nueva respuesta · ${ticket.code}`, `${user.nombre} respondió en “${ticket.subject}”.`)
  }
}

async function updateTicket(user, payload) {
  if (user.role !== 'admin') throw Object.assign(new Error('Solo un administrador puede cambiar el estado.'), { status:403 })
  const ticket = await ticketForUser(user, payload.ticketId)
  const status = clean(payload.status, 20)
  if (!STATUSES.has(status)) throw Object.assign(new Error('Estado no válido.'), { status:400 })
  await query('UPDATE support_tickets SET status=$2,updated_at=NOW() WHERE id=$1', [ticket.id,status])
  if (status === 'closed') await notifyClient(ticket.client_user_id, `Consulta resuelta · ${ticket.code}`, ticket.subject)
}

export default async function handler(req, res) {
  const user = await getUser(req)
  if (!user) return json(res, 401, { error:'Sesión no válida' })
  if (!['admin','client'].includes(user.role)) return json(res, 403, { error:'No tienes acceso a Asistencia.' })
  try {
    if (req.method === 'GET') return json(res, 200, await listTickets(user))
    if (req.method === 'POST') {
      const payload = await body(req)
      if (payload.action === 'create') {
        const ticket = await createTicket(user, payload)
        return json(res, 201, { ok:true,ticket })
      }
      if (payload.action === 'reply') {
        await replyTicket(user, payload)
        return json(res, 200, { ok:true })
      }
      return json(res, 400, { error:'Acción no válida.' })
    }
    if (req.method === 'PATCH') {
      const payload = await body(req)
      await updateTicket(user, payload)
      return json(res, 200, { ok:true })
    }
    return methodNotAllowed(res, ['GET','POST','PATCH'])
  } catch (error) {
    console.error('No fue posible completar la solicitud de asistencia:', error)
    return json(res, error.status || 500, { error:error.status ? error.message : 'No fue posible completar la solicitud de asistencia.' })
  }
}
