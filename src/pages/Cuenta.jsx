import { useState } from 'react'
import { IcoCheck, IcoUser } from '../components/Icons.jsx'

export default function Cuenta({ notify, user, onLogout }) {
  const [form, setForm] = useState({ ...user })
  const [notif, setNotif] = useState({ correo: true, sms: false, whatsapp: true })

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const guardar = () => notify('Cambios de cuenta guardados correctamente.')

  return (
    <div className="grid-2" style={{ gridTemplateColumns: '300px 1fr', alignItems: 'start' }}>
      <div className="card anim-in d1" style={{ textAlign: 'center' }}>
        <div className="avatar" style={{ width: 88, height: 88, fontSize: 30, margin: '10px auto 16px', borderRadius: 24 }}>
          {user.iniciales}
        </div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{form.nombre}</div>
        <div className="muted">{form.empresa}</div>
        <div className="row mt-2" style={{ justifyContent: 'center', gap: 8 }}>
          <span className="badge listo">{form.plan}</span>
          <span className="badge analisis">Verificado</span>
        </div>
        <div className="card mt-2" style={{ background: 'rgba(0,255,157,0.04)', textAlign: 'left' }}>
          <div className="spread" style={{ padding: '5px 0' }}><span className="muted">Órdenes totales</span><b>28</b></div>
          <div className="spread" style={{ padding: '5px 0' }}><span className="muted">Zonas activas</span><b>3</b></div>
          <div className="spread" style={{ padding: '5px 0' }}><span className="muted">Cliente desde</span><b>2024</b></div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card anim-in d2">
          <div className="card-title" style={{ marginBottom: 18 }}><IcoUser /> Datos de la cuenta</div>
          <div className="grid-2">
            <Field label="Nombre completo" value={form.nombre} onChange={set('nombre')} />
            <Field label="Empresa" value={form.empresa} onChange={set('empresa')} />
            <Field label="Usuario de acceso" value={form.email || form.dni || ''} onChange={form.email ? set('email') : set('dni')} />
            <Field label="Teléfono" value={form.telefono} onChange={set('telefono')} />
            <Field label="RUC" value={form.ruc} onChange={set('ruc')} />
            <div className="field">
              <label>Plan</label>
              <select value={form.plan} onChange={set('plan')}>
                <option>Corporativo</option><option>Empresarial</option><option>Básico</option>
              </select>
            </div>
          </div>
        </div>

        <div className="card anim-in d3">
          <div className="card-title" style={{ marginBottom: 16 }}>Notificaciones</div>
          {[['correo', 'Correo electrónico'], ['whatsapp', 'WhatsApp'], ['sms', 'SMS']].map(([k, l]) => (
            <div key={k} className="spread" style={{ padding: '11px 0', borderBottom: '1px solid var(--stroke)' }}>
              <span style={{ fontSize: 13.5 }}>{l}</span>
              <button
                onClick={() => setNotif((n) => ({ ...n, [k]: !n[k] }))}
                style={{
                  width: 46, height: 26, borderRadius: 100, border: '1px solid var(--stroke)', cursor: 'pointer',
                  background: notif[k] ? 'linear-gradient(90deg,#00c9a0,#00ff9d)' : 'rgba(0,255,157,0.06)',
                  position: 'relative', transition: 'all 0.3s',
                }}
              >
                <span style={{
                  position: 'absolute', top: 2, left: notif[k] ? 22 : 2, width: 20, height: 20, borderRadius: '50%',
                  background: notif[k] ? '#03120b' : 'var(--text-2)', transition: 'left 0.3s',
                }} />
              </button>
            </div>
          ))}
        </div>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-danger" onClick={onLogout}>Cerrar sesión</button>
          <button className="btn btn-primary" onClick={guardar}><IcoCheck /> Guardar cambios</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input value={value} onChange={onChange} />
    </div>
  )
}
