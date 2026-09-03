import crypto from 'node:crypto'
import { query } from './db.js'

const APP_URL = String(
  process.env.PUBLIC_APP_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
    || 'https://clientesaslabs.vercel.app',
).replace(/\/$/, '')
const FROM = process.env.EMAIL_FROM || 'AS LABS - Trujillo <ventas@aslaboratorios.com>'
const LOGO_URL = process.env.EMAIL_LOGO_URL || `${APP_URL}/assets/aslabs-logo-D8AX0wID.png`
const BANNER_URL = process.env.EMAIL_BANNER_URL || `${APP_URL}/assets/aslabs-banner-CF1Vn5oW.webp`

const clean = (value = '') => String(value || '').trim()
const escapeHtml = (value = '') => clean(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
})[character])

export function formatEmailDate(value) {
  if (!value) return null
  return new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'full', timeStyle: 'short', timeZone: 'America/Lima',
  }).format(new Date(value))
}

async function contextForService(serviceId) {
  const rows = await query(
    `SELECT s.id,s.code,s.client_user_id,s.sample_intake_scheduled_at,
            s.sample_intake_mode,
            COALESCE(NULLIF(s.display_name,''),s.service_type_name) AS service_name,
            u.full_name AS client_name,u.email AS client_email,u.dni AS client_dni
     FROM service_requests s JOIN users u ON u.id=s.client_user_id
     WHERE s.id=$1`,
    [serviceId],
  )
  return rows[0] || null
}

function clientRecipient(context) {
  const email = clean(context?.client_email).toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

export function renderEmailTemplate({ context, eyebrow = 'ACTUALIZACIÓN DE TU SERVICIO', headline, intro, details = [], buttonLabel, buttonUrl }) {
  const detailRows = details.filter((row) => row?.value).map((row) => `
    <tr>
      <td style="padding:13px 16px;color:#748078;width:155px;vertical-align:top;border-bottom:1px solid #e5ebe7;font-size:13px;text-transform:uppercase;letter-spacing:.5px">${escapeHtml(row.label)}</td>
      <td style="padding:13px 16px;color:#173c29;font-weight:700;vertical-align:top;border-bottom:1px solid #e5ebe7;font-size:15px;line-height:1.45">${escapeHtml(row.value)}</td>
    </tr>`).join('')
  const button = buttonUrl ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:26px"><tr><td style="border-radius:14px;background:#19583b"><a href="${escapeHtml(buttonUrl)}" style="display:inline-block;padding:16px 26px;color:#fff;text-decoration:none;font-size:15px;font-weight:700">${escapeHtml(buttonLabel || 'Abrir documento')} &nbsp;→</a></td></tr></table>` : ''
  return `<!doctype html>
<html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;background:#edf3ee;font-family:Arial,sans-serif;color:#173426">
<div style="display:none;max-height:0;overflow:hidden;color:transparent">${escapeHtml(headline)} · AS LABS - Trujillo</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#edf3ee;padding:30px 10px"><tr><td align="center">
  <table role="presentation" width="720" cellspacing="0" cellpadding="0" style="max-width:720px;width:100%;background:#fff;border:1px solid #d8e4dc;border-radius:24px;overflow:hidden;box-shadow:0 16px 40px rgba(16,63,40,.08)">
    <tr><td style="padding:11px 24px;background:#fff4d9;border-bottom:1px solid #f2d79e;color:#83500f;font-size:12px;line-height:1.5;text-align:center"><strong>COMUNICACIONES EN FASE DE PRUEBAS</strong> · Si encuentras algún error, comunícate con <a href="mailto:luisg@aslaboratorios.com" style="color:#19583b;font-weight:700">luisg@aslaboratorios.com</a>.</td></tr>
    <tr><td style="padding:22px 36px 18px;background:#fff"><img src="${escapeHtml(LOGO_URL)}" width="270" alt="AS Labs · Desde 1997" style="display:block;width:270px;max-width:76%;height:auto;border:0"></td></tr>
    <tr><td><img src="${escapeHtml(BANNER_URL)}" width="720" alt="Laboratorio AS Labs" style="display:block;width:100%;height:230px;object-fit:cover;border:0"></td></tr>
    <tr><td style="padding:38px 44px 42px">
      <table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="background:#fff1d8;border:1px solid #f3d195;border-radius:999px;padding:8px 13px;color:#a85b16;font-size:11px;font-weight:700;letter-spacing:1.5px">${escapeHtml(eyebrow)}</td></tr></table>
      <h1 style="margin:18px 0 12px;font-size:31px;line-height:1.16;color:#123a27;letter-spacing:-.6px">${escapeHtml(headline)}</h1>
      <p style="margin:0 0 26px;font-size:16px;line-height:1.75;color:#52645a">Hola <strong style="color:#183c2a">${escapeHtml(context.client_name || 'cliente')}</strong>, ${escapeHtml(intro)}</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7faf8;border:1px solid #dce7df;border-radius:16px;overflow:hidden">${detailRows}</table>
      ${button}
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:30px;border-top:1px solid #e2eae4"><tr><td style="padding-top:20px;font-size:12px;line-height:1.65;color:#7a8880">Este es un correo automático. Por favor, no respondas a este mensaje.<br>Para gestionar tu servicio, ingresa al portal de clientes de AS Labs.</td></tr></table>
    </td></tr>
    <tr><td style="padding:20px 36px;background:#123b28;color:#dce8df;font-size:12px;line-height:1.6"><strong style="color:#fff">AS LABS - Trujillo</strong><br>Laboratorios Control Biológico S.A.C. · Innovación agroindustrial desde 1997</td></tr>
  </table>
</td></tr></table></body></html>`
}

async function deliveryRecord({ eventKey, eventType, context, recipient, subject, status = 'pending', error = null }) {
  const rows = await query(
    `INSERT INTO email_deliveries
       (event_key,event_type,service_id,client_user_id,recipient_email,subject,status,error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (event_key) DO UPDATE SET
       recipient_email=EXCLUDED.recipient_email,
       subject=EXCLUDED.subject,
       status='pending',
       error_message=NULL,
       updated_at=NOW()
     WHERE email_deliveries.status='skipped'
     RETURNING id`,
    [eventKey,eventType,context?.id || null,context?.client_user_id || null,recipient,subject,status,error],
  )
  return rows[0]?.id || null
}

async function send({ serviceId, eventKey, eventType, subject, eyebrow, headline, intro, details, buttonLabel, buttonUrl, buttonUrlFactory }) {
  try {
    const context = await contextForService(serviceId)
    if (!context) return { status: 'skipped', reason: 'service_not_found' }
    const resolvedSubject = typeof subject === 'function' ? subject(context) : subject
    const resolvedEyebrow = typeof eyebrow === 'function' ? eyebrow(context) : eyebrow
    const resolvedHeadline = typeof headline === 'function' ? headline(context) : headline
    const resolvedIntro = typeof intro === 'function' ? intro(context) : intro
    const recipient = clientRecipient(context)
    if (!recipient) {
      await deliveryRecord({ eventKey,eventType,context,recipient:null,subject:resolvedSubject,status:'skipped',error:'El cliente no tiene un correo válido registrado.' })
      return { status: 'skipped', reason: 'missing_recipient_email' }
    }
    const deliveryId = await deliveryRecord({ eventKey,eventType,context,recipient,subject:resolvedSubject })
    if (!deliveryId) return { status: 'duplicate' }
    if (!process.env.RESEND_API_KEY) {
      await query(`UPDATE email_deliveries SET error_message='RESEND_API_KEY pendiente de configuración',updated_at=NOW() WHERE id=$1`, [deliveryId])
      return { status: 'pending_configuration' }
    }
    const resolvedDetails = typeof details === 'function' ? details(context) : details
    const resolvedButtonUrl = buttonUrlFactory ? await buttonUrlFactory(context) : buttonUrl
    const previewHtml = renderEmailTemplate({ context,eyebrow:resolvedEyebrow,headline:resolvedHeadline,intro:resolvedIntro,details:resolvedDetails,buttonLabel,buttonUrl:resolvedButtonUrl })
    await query(`UPDATE email_deliveries SET preview_html=$2,updated_at=NOW() WHERE id=$1`, [deliveryId,previewHtml])
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': eventKey,
      },
      body: JSON.stringify({
        from: FROM, to: [recipient], subject:resolvedSubject,
        html: previewHtml,
      }),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.message || `Resend respondió ${response.status}`)
    await query(
      `UPDATE email_deliveries SET status='sent',provider_message_id=$2,provider_last_event='sent',attempts=attempts+1,error_message=NULL,sent_at=NOW(),updated_at=NOW() WHERE id=$1`,
      [deliveryId,result.id || null],
    )
    return { status: 'sent', id: result.id }
  } catch (error) {
    console.error('No fue posible enviar el correo transaccional:', error)
    await query(
      `UPDATE email_deliveries SET status='failed',attempts=attempts+1,error_message=$2,updated_at=NOW() WHERE event_key=$1`,
      [eventKey,String(error.message || error).slice(0,500)],
    ).catch(() => {})
    return { status: 'failed', error: error.message }
  }
}

export async function publicDocumentUrl(documentType, serviceId, recordId) {
  const token = crypto.randomBytes(32).toString('base64url')
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  await query(
    `INSERT INTO public_document_links
       (token_hash,document_type,service_id,sample_intake_id,final_report_id)
     VALUES ($1,$2,$3,CASE WHEN $2='sample_intake' THEN $4::uuid ELSE NULL END,
            CASE WHEN $2='final_report' THEN $4::uuid ELSE NULL END)`,
    [tokenHash,documentType,serviceId,recordId],
  )
  return `${APP_URL}/api/service-workflow?publicDocument=1&token=${encodeURIComponent(token)}`
}

const modeCopy = (mode) => ({
  client_delivery: { noun: 'entrega de muestra', label: 'Entrega de muestra', verb: 'entregar la muestra' },
  aslabs_collection: { noun: 'recojo de muestra', label: 'Recojo de muestra', verb: 'recoger la muestra' },
  aslabs_sampling: { noun: 'muestreo', label: 'Muestreo', verb: 'realizar el muestreo' },
  none: { noun: 'orden', label: 'Muestra', verb: null },
}[mode] || { noun: 'entrega de muestra', label: 'Entrega de muestra', verb: 'entregar la muestra' })

export function sendOrderCreatedEmail(serviceId, scheduledAt, mode = 'client_delivery') {
  const scheduled = formatEmailDate(scheduledAt)
  const copy = modeCopy(mode)
  return send({
    serviceId,eventType:'order_created',eventKey:`order_created:${serviceId}`,
    subject:(context) => `Orden ${context.code} registrada · AS LABS`,eyebrow:'ORDEN REGISTRADA',headline:'Tu servicio ya está en marcha',
    intro:mode === 'none'
      ? 'registramos tu orden. Este servicio no requiere recojo, entrega ni toma de muestra.'
      : scheduled
        ? `registramos tu orden y confirmamos cuándo se realizará la ${copy.noun}.`
        : `registramos tu orden. La ${copy.noun} está pendiente de coordinación.`,
    details:(context) => [
      {label:'Orden',value:context.code},
      {label:'Servicio',value:context.service_name},
      mode === 'none' ? {label:'Muestra',value:'No requerida'} : {label:copy.label,value:scheduled || 'Pendiente de coordinación'},
    ],
    buttonLabel:'Ingresar al portal',buttonUrl:APP_URL,
  })
}

export function sendScheduleEmail(serviceId, scheduledAt, { previousAt = null, mode = 'client_delivery', eventKey } = {}) {
  const scheduled = formatEmailDate(scheduledAt)
  const previous = formatEmailDate(previousAt)
  const copy = modeCopy(mode)
  return send({
    serviceId,eventType:'sample_rescheduled',eventKey,
    subject:(context) => `Nueva fecha de ${copy.noun} · ${context.code}`,
    eyebrow:'PROGRAMACIÓN ACTUALIZADA',headline:`Actualizamos la fecha de ${copy.noun}`,
    intro:scheduledAt ? `tenemos una nueva fecha confirmada para ${copy.verb}.` : `retiramos la programación anterior de ${copy.noun} y coordinaremos contigo una nueva fecha.`,
    details:(context) => [{label:'Orden',value:context.code},{label:'Actividad',value:copy.label},{label:'Fecha anterior',value:previous},{label:'Nueva fecha',value:scheduled || 'Pendiente de coordinación'}],
    buttonLabel:'Revisar mi orden',buttonUrl:APP_URL,
  })
}

export async function sendSampleReceivedEmail(serviceId, intakeId, intakeType, receivedAt) {
  return send({
    serviceId,eventType:'sample_received',eventKey:`sample_received:${intakeId}`,
    subject:(context) => `Conformidad de muestra disponible · ${context.code}`,
    eyebrow:'MUESTRA REGISTRADA',headline:(context) => context.sample_intake_mode === 'aslabs_sampling'
      ? 'Realizamos el muestreo correctamente'
      : intakeType === 'aslabs_collection' ? 'Recolectamos tu muestra correctamente' : 'Recibimos tu muestra correctamente',
    intro:'la conformidad quedó registrada. Puedes consultar y descargar el PDF firmado desde el siguiente enlace seguro.',
    details:(context) => [{label:'Orden',value:context.code},{label:'Servicio',value:context.service_name},{label:'Fecha y hora',value:formatEmailDate(receivedAt)}],
    buttonLabel:'Ver constancia en PDF',buttonUrlFactory:() => publicDocumentUrl('sample_intake',serviceId,intakeId),
  })
}

export async function sendResultsReadyEmail(serviceId, reportId) {
  return send({
    serviceId,eventType:'results_ready',eventKey:`results_ready:${reportId}`,
    subject:(context) => `Resultados listos · ${context.code} · AS LABS`,eyebrow:'INFORME FINAL APROBADO',headline:'Tus resultados ya están disponibles',
    intro:'el informe final fue revisado, aprobado y publicado. Puedes abrirlo directamente desde el siguiente enlace.',
    details:(context) => [{label:'Orden',value:context.code},{label:'Servicio',value:context.service_name},{label:'Estado',value:'Informe aprobado'}],
    buttonLabel:'Ver informe final',buttonUrlFactory:() => publicDocumentUrl('final_report',serviceId,reportId),
  })
}
