import { IcoCheck, IcoFile, IcoFlask } from './Icons.jsx'

const LABELS = { pending: 'Pendiente', current: 'En proceso', completed: 'Conforme' }
const EQUIPMENT_STATUS = { completed: 'Finalizado', running: 'En uso', pending: 'Pendiente' }

function formatDate(value) {
  if (!value) return 'Sin hora registrada'
  return new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Lima',
  }).format(new Date(value))
}

export default function ClientLabTraceability({ serviceId, processes = [], equipmentRuns = [] }) {
  if (!processes.length && !equipmentRuns.length) return null
  return (
    <section className="client-lab-trace">
      <header>
        <span className="client-lab-trace-icon"><IcoFlask /></span>
        <div>
          <span className="card-kicker">Documentación del laboratorio</span>
          <h3>Trazabilidad del servicio</h3>
          <p>Consulta los formatos de proceso y los registros finalizados de los equipos vinculados a tu orden.</p>
        </div>
      </header>
      {processes.length > 0 && (
        <div className="client-lab-processes">
          {processes.map((process) => (
            <article key={process.id}>
              <div className="client-lab-process-head">
                <div><span>{process.process_code}</span><strong>{process.title}</strong></div>
                <span className={`lab-status ${process.status === 'completed' ? 'good' : 'pending'}`}><i />{process.status === 'completed' ? 'Completado' : 'En proceso'}</span>
              </div>
              <div className="client-lab-analyses">
                {(process.analysis_names || []).map((analysis) => <span key={analysis}>{analysis}</span>)}
              </div>
              <div className="client-lab-steps">
                {(process.steps || []).map((step, index) => (
                  <div className={`client-lab-step ${step.status}`} key={step.id}>
                    <span className="client-lab-step-number">{step.status === 'completed' ? <IcoCheck /> : index + 1}</span>
                    <div><strong>{step.title}</strong><small>{LABELS[step.status]}</small></div>
                    {step.status === 'completed' && (
                      <a href={`/api/service-workflow?serviceId=${encodeURIComponent(serviceId)}&processId=${encodeURIComponent(process.id)}&labStepId=${encodeURIComponent(step.id)}&format=lab-step`} target="_blank" rel="noreferrer">
                        <IcoFile /> PDF
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
      {equipmentRuns.length > 0 && (
        <div className="client-lab-equipment">
          <div className="client-lab-equipment-title">
            <div><span className="card-kicker">Uso de equipos</span><strong>Registros vinculados a esta orden</strong></div>
            <small>Los PDFs se habilitan al finalizar cada uso.</small>
          </div>
          <div className="client-lab-equipment-list">
            {equipmentRuns.map((run) => (
              <article key={run.id}>
                <span className="client-lab-equipment-icon"><IcoFlask /></span>
                <div className="client-lab-equipment-copy">
                  <strong>{run.equipment_name || 'Equipo de laboratorio'}</strong>
                  <small>{[run.equipment_code, run.stage_title || 'Registro del servicio', formatDate(run.started_at)].filter(Boolean).join(' · ')}</small>
                </div>
                <span className={`client-lab-equipment-status ${run.status === 'completed' ? 'completed' : 'running'}`}>
                  {EQUIPMENT_STATUS[run.status] || 'En proceso'}
                </span>
                {run.status === 'completed' ? (
                  <a href={`/api/service-workflow?serviceId=${encodeURIComponent(serviceId)}&runId=${encodeURIComponent(run.id)}&format=equipment-run`} target="_blank" rel="noreferrer">
                    <IcoFile /> PDF de equipo
                  </a>
                ) : <span className="client-lab-equipment-wait">Documento al finalizar</span>}
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
