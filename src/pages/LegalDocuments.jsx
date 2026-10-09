import { useEffect, useMemo, useRef, useState } from 'react'
import { IcoFile, IcoFolder, IcoPlus, IcoSearch, IcoShield } from '../components/Icons.jsx'
import { api } from '../data/api.js'

const CATEGORIES = [
  ['contract','Contratos'],
  ['nda','Confidencialidad'],
  ['authorization','Autorizaciones'],
  ['tax','Tributarios'],
  ['certificate','Certificados'],
  ['other','Otros'],
]
const MIME_TYPES = [
  'application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg','image/png','image/webp',
]
const MAX_SIZE = 5 * 1024 * 1024
const CHUNK_SIZE = 700000

const date = (value) => new Intl.DateTimeFormat('es-PE',{ dateStyle:'medium',timeStyle:'short' }).format(new Date(value))
const size = (value) => `${(Number(value || 0) / 1024 / 1024).toFixed(Number(value) > 1024 * 1024 ? 1 : 2)} MB`
const categoryName = (id) => CATEGORIES.find(([value]) => value === id)?.[1] || 'Otros'
const baseName = (name = '') => name.replace(/\.[^.]+$/, '')

function readFile(file) {
  return new Promise((resolve,reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '')
    reader.onerror = () => reject(new Error(`No pudimos leer ${file.name}.`))
    reader.readAsDataURL(file)
  })
}

export default function LegalDocuments({ user,notify }) {
  const admin = user.role === 'admin'
  const inputRef = useRef(null)
  const [data,setData] = useState({ documents:[],clients:[],services:[] })
  const [search,setSearch] = useState('')
  const [category,setCategory] = useState('all')
  const [loading,setLoading] = useState(true)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [open,setOpen] = useState(false)
  const [files,setFiles] = useState([])
  const [form,setForm] = useState({ clientId:'',serviceId:'',category:'contract',title:'',notes:'' })

  const load = async () => {
    setLoading(true)
    try { setData(await api.legalDocuments()); setError('') }
    catch (requestError) { setError(requestError.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!open) return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  },[open])

  const visible = useMemo(() => data.documents.filter((document) => {
    const matchesCategory = category === 'all' || document.category === category
    const term = search.trim().toLowerCase()
    const haystack = `${document.title} ${document.file_name} ${document.client_name || ''} ${document.client_company || ''} ${document.service_code || ''}`.toLowerCase()
    return matchesCategory && (!term || haystack.includes(term))
  }),[data.documents,search,category])

  const clientServices = useMemo(() => data.services.filter((service) => !admin || !form.clientId || service.client_user_id === form.clientId),[data.services,form.clientId,admin])

  const chooseFiles = (event) => {
    const selected = Array.from(event.target.files || []).slice(0,10)
    const invalid = selected.find((file) => !MIME_TYPES.includes(file.type) || file.size > MAX_SIZE || file.size <= 0)
    if (invalid) {
      setError(`${invalid.name}: usa PDF, DOC, DOCX o imagen de hasta 5 MB.`)
      event.target.value = ''
      return
    }
    setError(''); setFiles(selected)
  }

  const upload = async (event) => {
    event.preventDefault()
    if (!files.length || (admin && !form.clientId)) return
    setBusy(true); setError('')
    try {
      for (const file of files) {
        const base64 = await readFile(file)
        const chunks = Array.from({ length:Math.ceil(base64.length / CHUNK_SIZE) },(_,index) => base64.slice(index * CHUNK_SIZE,(index + 1) * CHUNK_SIZE))
        const started = await api.beginLegalDocumentUpload({
          ...form,
          title:files.length === 1 && form.title.trim() ? form.title.trim() : baseName(file.name),
          fileName:file.name,mimeType:file.type,fileSize:file.size,totalChunks:chunks.length,
        })
        for (let index = 0; index < chunks.length; index += 1) {
          await api.uploadLegalDocumentChunk({ uploadId:started.uploadId,index,data:chunks[index] })
        }
        await api.completeLegalDocumentUpload(started.uploadId)
      }
      notify?.(`${files.length} documento${files.length === 1 ? '' : 's'} guardado${files.length === 1 ? '' : 's'}.`)
      setFiles([]); setForm({ clientId:'',serviceId:'',category:'contract',title:'',notes:'' }); setOpen(false)
      if (inputRef.current) inputRef.current.value = ''
      await load()
    } catch (requestError) { setError(requestError.message) }
    finally { setBusy(false) }
  }

  const remove = async (document) => {
    if (!window.confirm(`¿Eliminar “${document.title}”?`)) return
    setBusy(true)
    try { await api.deleteLegalDocument(document.id); notify?.('Documento eliminado.'); await load() }
    catch (requestError) { setError(requestError.message) }
    finally { setBusy(false) }
  }

  return <div className="legal-page">
    <section className="legal-head">
      <div><span><IcoShield /></span><div><h1>Documentos legales</h1><p>{admin ? 'Comparte y consulta la documentación legal de cada cliente.' : 'Consulta o adjunta documentos de forma segura.'}</p></div></div>
      <button type="button" onClick={() => setOpen(true)}><IcoPlus /> Adjuntar documentos</button>
    </section>

    {error && <div className="form-error">{error}</div>}

    <section className="legal-toolbar">
      <label><IcoSearch /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={admin ? 'Buscar cliente, documento o servicio…' : 'Buscar documento o servicio…'} /></label>
      <div>{[['all','Todos'],...CATEGORIES].map(([value,label]) => <button type="button" className={category === value ? 'active' : ''} onClick={() => setCategory(value)} key={value}>{label}</button>)}</div>
      <span>{visible.length} documento{visible.length === 1 ? '' : 's'}</span>
    </section>

    <section className="legal-list">
      {loading ? <div className="legal-empty">Cargando documentos…</div> : visible.length ? visible.map((document) => <article key={document.id} className="legal-document">
        <span className="legal-file-icon"><IcoFile /><small>{document.mime_type === 'application/pdf' ? 'PDF' : document.file_name.split('.').pop()?.toUpperCase()}</small></span>
        <div className="legal-document-copy">
          <span>{categoryName(document.category)}{document.service_code ? ` · ${document.service_code}` : ''}</span>
          <strong>{document.title}</strong>
          <small>{admin ? `${document.client_name}${document.client_company ? ` · ${document.client_company}` : ''} · ` : ''}{size(document.file_size)} · {date(document.created_at)}</small>
          {document.notes && <p>{document.notes}</p>}
        </div>
        <div className="legal-document-actions">
          <a href={`/api/services?legalDocuments=1&document=${encodeURIComponent(document.id)}`} target="_blank" rel="noreferrer">Abrir</a>
          {admin && <button type="button" onClick={() => remove(document)} disabled={busy}>Eliminar</button>}
        </div>
      </article>) : <div className="legal-empty"><IcoFolder /><strong>No hay documentos</strong><p>{search || category !== 'all' ? 'Prueba con otro filtro.' : 'Adjunta el primer documento legal.'}</p></div>}
    </section>

    {open && <div className="modal-overlay legal-modal-overlay" onMouseDown={() => !busy && setOpen(false)}>
      <form className="legal-modal" onSubmit={upload} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><h2>Adjuntar documentos</h2><p>Puedes seleccionar varios archivos. Máximo 5 MB por documento.</p></div><button type="button" onClick={() => setOpen(false)} disabled={busy}>×</button></header>
        <div className="legal-modal-scroll">
          {admin && <label><span>Cliente</span><select required value={form.clientId} onChange={(event) => setForm({ ...form,clientId:event.target.value,serviceId:'' })}><option value="">Seleccionar cliente…</option>{data.clients.map((client) => <option value={client.id} key={client.id}>{client.full_name}{client.company ? ` · ${client.company}` : ''}</option>)}</select></label>}
          <div className="legal-form-row">
            <label><span>Categoría</span><select value={form.category} onChange={(event) => setForm({ ...form,category:event.target.value })}>{CATEGORIES.map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label><span>Servicio <small>opcional</small></span><select value={form.serviceId} onChange={(event) => setForm({ ...form,serviceId:event.target.value })}><option value="">Sin vincular</option>{clientServices.map((service) => <option value={service.id} key={service.id}>{service.code} · {service.name}</option>)}</select></label>
          </div>
          <label><span>Título <small>opcional para un solo archivo</small></span><input value={form.title} onChange={(event) => setForm({ ...form,title:event.target.value })} placeholder="Se usará el nombre del archivo si lo dejas vacío" /></label>
          <label><span>Nota <small>opcional</small></span><textarea rows="3" value={form.notes} onChange={(event) => setForm({ ...form,notes:event.target.value })} placeholder="Información útil sobre estos documentos" /></label>
          <label className={`legal-dropzone ${files.length ? 'ready' : ''}`}><input ref={inputRef} type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp" onChange={chooseFiles} /><IcoPlus /><span><strong>{files.length ? `${files.length} archivo${files.length === 1 ? '' : 's'} seleccionado${files.length === 1 ? '' : 's'}` : 'Elegir documentos'}</strong><small>{files.length ? files.map((file) => file.name).join(' · ') : 'PDF, Word o imagen · hasta 5 MB cada uno'}</small></span></label>
        </div>
        <footer><button type="button" onClick={() => setOpen(false)} disabled={busy}>Cancelar</button><button type="submit" disabled={busy || !files.length || (admin && !form.clientId)}>{busy ? 'Guardando…' : 'Guardar documentos'}</button></footer>
      </form>
    </div>}
  </div>
}
