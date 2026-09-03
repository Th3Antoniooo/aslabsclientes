import { useEffect, useMemo, useState } from 'react'
import { IcoArrow, IcoChart, IcoFile, IcoShield } from '../components/Icons.jsx'
import { api } from '../data/api.js'

function fileSizeLabel(bytes = 0) {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

export default function Resultados({ user }) {
  const isAdmin = user.role === 'admin'
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.finalReports()
      .then((result) => {
        setServices(result.reports || [])
        setError('')
      })
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false))
  }, [])

  const reports = useMemo(
    () => services.filter((service) => service.final_report_id),
    [services],
  )

  if (loading) return <div className="card services-loading">Cargando informes…</div>

  if (!reports.length) {
    return (
      <section className="card services-empty results-empty anim-in d1">
        <span className="services-empty-icon"><IcoChart /></span>
        <span className="eyebrow">Resultados de laboratorio</span>
        <h2>No hay informes disponibles</h2>
        <p>
          {isAdmin
            ? 'Abre un servicio activo desde Órdenes y publica allí su informe final validado.'
            : 'Los resultados aparecerán únicamente cuando el laboratorio valide y publique el informe final.'}
        </p>
        <div className="empty-security-note"><IcoShield /> Sin archivos de demostración</div>
        {error && <div className="form-error">{error}</div>}
      </section>
    )
  }

  return (
    <div className="results-page">
      <section className="results-heading anim-in d1">
        <div>
          <span className="eyebrow">Documentos validados</span>
          <h1>{isAdmin ? 'Informes finales publicados' : 'Mis resultados'}</h1>
          <p>
            {isAdmin
              ? 'Consulta las versiones vigentes que ya están disponibles para cada cliente.'
              : 'Descarga los informes finales publicados por AS Laboratorios para tu organización.'}
          </p>
        </div>
        <div className="results-count"><strong>{reports.length}</strong><span>{reports.length === 1 ? 'informe' : 'informes'}</span></div>
      </section>

      {error && <div className="form-error">{error}</div>}

      <section className="results-grid anim-in d2">
        {reports.map((service) => (
          <article className="card result-report-card" key={service.final_report_id}>
            <header>
              <span className="result-file-icon"><IcoFile /></span>
              <span className="badge listo">Disponible</span>
            </header>
            <span className="result-code">{service.code}</span>
            <h2>{service.service_type_name}</h2>
            {isAdmin && <p className="result-client">{service.client_name} · {service.client_company}</p>}
            <div className="result-file-name">{service.final_report_name}</div>
            <div className="result-meta">
              <span>Versión {service.final_report_version}</span>
              <span>{fileSizeLabel(service.final_report_size)}</span>
              <span>{new Date(service.final_report_created_at).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
            </div>
            <a
              className="btn btn-primary"
              href={`/api/service-workflow?serviceId=${encodeURIComponent(service.id)}&format=final-report&reportId=${encodeURIComponent(service.final_report_id)}`}
            >
              Descargar informe <IcoArrow />
            </a>
          </article>
        ))}
      </section>
    </div>
  )
}
