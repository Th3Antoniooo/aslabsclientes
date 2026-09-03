import { useEffect, useMemo, useState } from 'react'
import { api } from '../data/api.js'
import {
  IcoArrow, IcoCalendar, IcoChart, IcoFile, IcoFlask, IcoFolder,
  IcoOrders, IcoSearch, IcoShield,
} from './Icons.jsx'

const FOLDERS = [
  { id: 'all', label: 'Toda la documentación', short: 'Todos', description: 'Expediente documental completo', Ico: IcoFolder, tone: 'all' },
  { id: 'samples', label: 'Muestras y recepción', short: 'Muestras', description: 'Ingreso, firma y conformidad', Ico: IcoOrders, tone: 'sample' },
  { id: 'traceability', label: 'Trazabilidad por etapa', short: 'Trazabilidad', description: 'PDF de cada etapa del servicio', Ico: IcoChart, tone: 'trace' },
  { id: 'equipment', label: 'Equipos', short: 'Equipos', description: 'Uso, ciclos y liberaciones', Ico: IcoFlask, tone: 'equipment' },
  { id: 'microbiology', label: 'Operaciones microbiológicas', short: 'Microbiología', description: 'Flujos y formatos técnicos', Ico: IcoShield, tone: 'micro' },
  { id: 'reports', label: 'Informes y resultados', short: 'Informes', description: 'Versiones emitidas y aprobaciones', Ico: IcoFile, tone: 'report' },
  { id: 'nonconformities', label: 'No conformidades', short: 'No conformidades', description: 'Desviaciones y acciones registradas', Ico: IcoShield, tone: 'nc' },
]

const FUTURE_FOLDERS = [
  { label: 'Limpieza y sanitización', description: 'Preparado para los próximos formatos' },
  { label: 'Temperatura y ambiente', description: 'Preparado para los próximos formatos' },
]

const STATUS_FILTERS = [
  ['all', 'Todos los estados'],
  ['available', 'Disponibles'],
  ['active', 'En curso'],
  ['attention', 'Requieren atención'],
]

function dateLabel(value) {
  if (!value) return 'Sin fecha'
  return new Date(value).toLocaleString('es-PE', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function monthKey(value) {
  const date = new Date(value)
  const now = new Date()
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
}

function statusClass(status) {
  return status === 'attention' ? 'attention' : status === 'active' ? 'active' : 'available'
}

export default function DocumentationCenter() {
  const [documents, setDocuments] = useState([])
  const [summary, setSummary] = useState({ total: 0, available: 0, active: 0, attention: 0, byFolder: {} })
  const [folder, setFolder] = useState('all')
  const [status, setStatus] = useState('all')
  const [year, setYear] = useState('all')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const result = await api.adminDocuments()
      setDocuments(result.documents || [])
      setSummary(result.summary || { total: 0, available: 0, active: 0, attention: 0, byFolder: {} })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const years = useMemo(() => (
    [...new Set(documents.map((item) => item.date ? new Date(item.date).getFullYear() : null).filter(Boolean))]
      .sort((a, b) => b - a)
  ), [documents])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('es')
    return documents.filter((item) => {
      if (folder !== 'all' && item.folder !== folder) return false
      if (status !== 'all' && item.status !== status) return false
      if (year !== 'all' && new Date(item.date).getFullYear() !== Number(year)) return false
      if (!needle) return true
      return [
        item.title, item.fileName, item.documentCode, item.serviceCode, item.serviceName,
        item.clientName, item.clientCompany, item.responsible, item.equipment, item.meta,
      ].some((value) => String(value || '').toLocaleLowerCase('es').includes(needle))
    })
  }, [documents, folder, status, year, query])

  const selectedFolder = FOLDERS.find((item) => item.id === folder) || FOLDERS[0]
  const thisMonth = useMemo(() => documents.filter((item) => item.date && monthKey(item.date)).length, [documents])

  return (
    <div className="iso-docs-page">
      <section className="iso-docs-hero">
        <div>
          <span className="eyebrow">Sistema documental · Implementación ISO</span>
          <h2>Centro de documentación</h2>
          <p>Consulta desde un solo lugar los PDF emitidos por muestras, etapas, equipos, microbiología e informes. Cada archivo conserva su vínculo con la orden original.</p>
          <div className="iso-docs-hero-badges">
            <span><IcoShield /> Acceso administrativo</span>
            <span><IcoFolder /> Carpetas virtuales</span>
          </div>
        </div>
        <div className="iso-docs-hero-stats">
          <article><small>Documentos</small><strong>{summary.total}</strong><span>registrados</span></article>
          <article><small>Este mes</small><strong>{thisMonth}</strong><span>nuevos PDF</span></article>
          <article className={summary.attention ? 'attention' : ''}><small>Por revisar</small><strong>{summary.attention}</strong><span>requieren atención</span></article>
        </div>
      </section>

      <section className="iso-folder-section">
        <header>
          <div><span className="eyebrow">Archivo por categorías</span><h3>Carpetas documentales</h3></div>
          <p>No se duplican archivos: esta vista los ordena automáticamente según el registro que los generó.</p>
        </header>
        <div className="iso-folder-grid">
          {FOLDERS.map(({ id, label, description, Ico, tone }) => {
            const count = id === 'all' ? summary.total : summary.byFolder?.[id] || 0
            return (
              <button key={id} className={`iso-folder-card ${tone} ${folder === id ? 'selected' : ''}`} onClick={() => setFolder(id)}>
                <span className="iso-folder-icon"><Ico /></span>
                <span><strong>{label}</strong><small>{description}</small></span>
                <b>{count}</b>
              </button>
            )
          })}
          {FUTURE_FOLDERS.map((item) => (
            <div className="iso-folder-card future" key={item.label}>
              <span className="iso-folder-icon"><IcoFolder /></span>
              <span><strong>{item.label}</strong><small>{item.description}</small></span>
              <b>Próximo</b>
            </div>
          ))}
        </div>
      </section>

      <section className="iso-doc-browser">
        <header className="iso-doc-browser-head">
          <div>
            <span className="eyebrow">{selectedFolder.short}</span>
            <h3>{selectedFolder.label}</h3>
            <p>{filtered.length} {filtered.length === 1 ? 'archivo encontrado' : 'archivos encontrados'}</p>
          </div>
          <button className="btn btn-ghost" type="button" onClick={load} disabled={loading}>Actualizar</button>
        </header>

        <div className="iso-doc-toolbar">
          <label className="iso-doc-search">
            <IcoSearch />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por código, orden, cliente, equipo o archivo…" />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="Limpiar búsqueda">×</button>}
          </label>
          <label className="iso-doc-select"><span>Estado</span><select value={status} onChange={(event) => setStatus(event.target.value)}>{STATUS_FILTERS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label className="iso-doc-select"><span>Año</span><select value={year} onChange={(event) => setYear(event.target.value)}><option value="all">Todos</option>{years.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
        </div>

        {error && <div className="form-error iso-doc-error"><IcoShield /> {error} <button type="button" onClick={load}>Reintentar</button></div>}
        {loading ? (
          <div className="iso-doc-empty loading"><span /><strong>Organizando documentación…</strong></div>
        ) : filtered.length ? (
          <div className="iso-doc-list">
            {filtered.map((item) => (
              <article key={item.id}>
                <span className={`iso-document-icon ${item.folder}`}><IcoFile /></span>
                <div className="iso-document-main">
                  <div className="iso-document-topline">
                    <span>{FOLDERS.find((entry) => entry.id === item.folder)?.short || 'Documento'}</span>
                    <span className={`iso-document-status ${statusClass(item.status)}`}>{item.statusLabel}</span>
                  </div>
                  <strong>{item.title}</strong>
                  <small>{item.fileName}</small>
                  <div className="iso-document-tags">
                    {item.serviceCode && <span>{item.serviceCode}</span>}
                    {item.documentCode && <span>{item.documentCode}</span>}
                    {item.meta && <span>{item.meta}</span>}
                  </div>
                </div>
                <div className="iso-document-context">
                  <strong>{item.clientCompany || item.clientName || 'Documento interno'}</strong>
                  {item.clientCompany && item.clientName && <span>{item.clientName}</span>}
                  <small>{item.serviceName || item.equipment || 'Registro del laboratorio'}</small>
                </div>
                <div className="iso-document-date"><IcoCalendar /><span>{dateLabel(item.date)}</span>{item.responsible && <small>{item.responsible}</small>}</div>
                <a href={item.href} target="_blank" rel="noreferrer" className="iso-document-open">Abrir PDF <IcoArrow /></a>
              </article>
            ))}
          </div>
        ) : (
          <div className="iso-doc-empty">
            <IcoFolder />
            <strong>No hay documentos con estos filtros</strong>
            <p>Cambia la carpeta, el estado, el año o limpia la búsqueda.</p>
            <button type="button" className="btn btn-ghost" onClick={() => { setQuery(''); setStatus('all'); setYear('all') }}>Limpiar filtros</button>
          </div>
        )}
      </section>
    </div>
  )
}
