import { useEffect, useMemo, useState } from 'react'
import { api } from '../data/api.js'
import { IcoFlask, IcoPlus, IcoShield, IcoUser } from '../components/Icons.jsx'

const blankForm = {
  id: '',
  fullName: '',
  email: '',
  specialty: '',
  licenseNumber: '',
  pin: '',
}

export default function Analysts({ notify }) {
  const [analysts, setAnalysts] = useState([])
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const result = await api.analysts()
      setAnalysts(result.analysts)
      setError('')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const activeCount = useMemo(
    () => analysts.filter((analyst) => analyst.status === 'active').length,
    [analysts],
  )

  const edit = (analyst) => {
    setForm(analyst ? {
      id: analyst.id,
      fullName: analyst.full_name || '',
      email: analyst.email || '',
      specialty: analyst.specialty || '',
      licenseNumber: analyst.license_number || '',
      pin: '',
    } : { ...blankForm })
    setError('')
  }

  const save = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (form.id) await api.updateAnalyst(form)
      else await api.createAnalyst(form)
      setForm(null)
      await load()
      notify(form.id ? 'Ficha del analista actualizada sin alterar los análisis existentes.' : 'Analista añadido al directorio.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (analyst) => {
    try {
      await api.updateAnalyst({
        id: analyst.id,
        status: analyst.status === 'active' ? 'inactive' : 'active',
      })
      await load()
      notify('Disponibilidad del analista actualizada.')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  return (
    <div className="analysts-page">
      <section className="analysts-hero anim-in d1">
        <div className="analysts-hero-icon"><IcoFlask /></div>
        <div>
          <span className="eyebrow">Equipo de laboratorio</span>
          <h1>Directorio de analistas</h1>
          <p>Añade profesionales y configura su PIN. La asignación operativa se realiza desde cada servicio.</p>
        </div>
        <div className="analysts-hero-stats">
          <div><strong>{activeCount}</strong><span>disponibles</span></div>
          <div><strong>{analysts.length}</strong><span>registrados</span></div>
        </div>
        <button className="btn btn-accent" onClick={() => edit(null)}><IcoPlus /> Añadir analista</button>
      </section>

      {error && !form && <div className="form-error">{error}</div>}

      <section className="card analysts-table anim-in d2">
        <div className="analysts-table-head">
          <span>Trabajador</span><span>Especialidad</span><span>Colegiatura / registro</span><span>Acceso</span><span />
        </div>
        {loading ? (
          <div className="access-loading">Cargando analistas…</div>
        ) : analysts.length === 0 ? (
          <div className="analysts-empty">
            <span><IcoFlask /></span>
            <h2>Aún no hay analistas</h2>
            <p>Crea el primer perfil para poder asignarlo desde las etapas de los servicios.</p>
            <button className="btn btn-primary" onClick={() => edit(null)}><IcoPlus /> Añadir primer analista</button>
          </div>
        ) : analysts.map((analyst) => (
          <div className="analyst-row" key={analyst.id}>
            <div className="analyst-person">
              <span className="analyst-avatar"><IcoUser /></span>
              <div><strong>{analyst.full_name}</strong><span>{analyst.email || 'Sin correo registrado'}</span></div>
            </div>
            <span>{analyst.specialty || 'General'}</span>
            <span>{analyst.license_number || 'Sin registrar'}</span>
            <div className="analyst-access-state">
              <span className={`user-status ${analyst.status}`}><i /> {analyst.status === 'active' ? 'Disponible' : 'Inactivo'}</span>
              <small className={analyst.has_pin ? 'ready' : 'missing'}>{analyst.has_pin ? 'PIN configurado' : 'Sin PIN'}</small>
              {analyst.biotechnology_access && <small className="ready">Acceso a Biotecnología</small>}
            </div>
            <div className="analyst-actions">
              <button className="table-action" onClick={() => edit(analyst)}>Editar</button>
              <button className="table-action muted" onClick={() => toggle(analyst)}>
                {analyst.status === 'active' ? 'Desactivar' : 'Activar'}
              </button>
            </div>
          </div>
        ))}
      </section>

      {form && (
        <div className="modal-overlay" onClick={() => setForm(null)}>
          <form className="modal analyst-modal" onSubmit={save} onClick={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <span className="modal-icon"><IcoShield /></span>
              <div>
                <span className="eyebrow">Directorio técnico</span>
                <h2>{form.id ? 'Editar analista' : 'Añadir analista'}</h2>
                <p>Los cambios del perfil no eliminan etapas, servicios ni evidencias ya registradas.</p>
              </div>
            </div>
            <div className="form-grid">
              <label className="field"><span>Nombre completo</span><input value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} required /></label>
              <label className="field"><span>Correo electrónico</span><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
              <label className="field"><span>Especialidad</span><input value={form.specialty} onChange={(event) => setForm({ ...form, specialty: event.target.value })} placeholder="Ej. Biología molecular" /></label>
              <label className="field"><span>Colegiatura o registro</span><input value={form.licenseNumber} onChange={(event) => setForm({ ...form, licenseNumber: event.target.value })} placeholder="Opcional" /></label>
              <label className="field field-wide worker-pin-admin-field">
                <span>{form.id ? 'Cambiar PIN de acceso' : 'PIN de acceso'}</span>
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  value={form.pin}
                  onChange={(event) => setForm({ ...form, pin: event.target.value.replace(/\D/g, '').slice(0, 4) })}
                  placeholder={form.id ? 'Déjalo vacío para conservar el PIN actual' : '4 dígitos'}
                  pattern="\d{4}"
                  required={!form.id}
                />
                <small>Debe contener 4 dígitos y no puede repetirse entre trabajadores. El PIN nunca se muestra después de guardarlo.</small>
              </label>
            </div>
            {error && <div className="form-error">{error}</div>}
            <div className="modal-actions">
              <button className="btn btn-ghost" type="button" onClick={() => setForm(null)}>Cancelar</button>
              <button className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar analista'}</button>
            </div>
          </form>
        </div>
      )}

    </div>
  )
}
