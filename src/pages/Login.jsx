import { useEffect, useState } from 'react'
import { api } from '../data/api.js'
import { IcoArrow, IcoFile, IcoLocation, IcoOrders, IcoPlus, IcoShield, IcoUser } from '../components/Icons.jsx'
import logo from '../assets/aslabs-logo.png'
import banner from '../assets/aslabs-banner.webp'

export default function Login({ onLogin }) {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [installPrompt, setInstallPrompt] = useState(null)

  useEffect(() => {
    const captureInstall = (event) => {
      event.preventDefault()
      setInstallPrompt(event)
    }
    const installed = () => setInstallPrompt(null)
    window.addEventListener('beforeinstallprompt', captureInstall)
    window.addEventListener('appinstalled', installed)
    return () => {
      window.removeEventListener('beforeinstallprompt', captureInstall)
      window.removeEventListener('appinstalled', installed)
    }
  }, [])

  const installApp = async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    if (choice.outcome === 'accepted') setInstallPrompt(null)
  }

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await api.login(identifier, password)
      await onLogin(result.user)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-visual" style={{ backgroundImage: `linear-gradient(145deg, rgba(17,66,46,.94), rgba(35,91,64,.68)), url(${banner})` }}>
        <div className="login-orb login-orb-one" />
        <div className="login-orb login-orb-two" />
        <div className="login-visual-content">
          <div className="login-brand-note"><span /> AS Laboratorios · desde 1997</div>
          <div className="login-eyebrow">Portal de operaciones y clientes</div>
          <h1>Todo el recorrido de una muestra, en un solo lugar.</h1>
          <p>Un espacio privado para solicitar servicios, seguir cada etapa y consultar la documentación emitida por el laboratorio.</p>
          <div className="login-capabilities">
            <article>
              <span><IcoOrders /></span>
              <div><strong>Solicita</strong><p>Crea órdenes vinculadas a tus muestras.</p></div>
            </article>
            <article>
              <span><IcoLocation /></span>
              <div><strong>Sigue</strong><p>Consulta el avance autorizado de cada servicio.</p></div>
            </article>
            <article>
              <span><IcoFile /></span>
              <div><strong>Recibe</strong><p>Accede a formatos e informes publicados.</p></div>
            </article>
          </div>
          <div className="login-proof">
            <span><IcoShield /> Entorno privado y protegido</span>
            <span>Información separada por organización</span>
          </div>
        </div>
      </section>

      <section className="login-form-wrap">
        <form className="login-card" onSubmit={submit}>
          <div className="login-logo-wrap"><img className="login-logo" src={logo} alt="AS Labs" /><span><i /> Portal privado</span></div>
          <div className="login-heading">
            <span>Bienvenido</span>
            <h2>Ingresa a tu cuenta</h2>
            <p>Accede con las credenciales asignadas por AS Laboratorios.</p>
          </div>

          <div className="login-access-fields">
            <div className="field login-field">
              <label htmlFor="login-identifier">Usuario</label>
              <span className="login-input-icon"><IcoUser /></span>
              <input
                id="login-identifier"
                type="text"
                autoComplete="username"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="Correo electrónico o DNI"
                required
              />
            </div>
            <div className="field login-field">
              <div className="spread">
                <label htmlFor="login-password">Contraseña</label>
                <a className="text-link" href="mailto:info@aslaboratorios.com?subject=Recuperar%20acceso%20al%20portal">¿Necesitas ayuda?</a>
              </div>
              <span className="login-input-icon"><IcoShield /></span>
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••••••"
                required
              />
              <button type="button" className="password-toggle" onClick={() => setShowPassword((current) => !current)}>{showPassword ? 'Ocultar' : 'Mostrar'}</button>
            </div>
          </div>

          {error && <div className="form-error" role="alert">{error}</div>}

          <button className="btn btn-primary login-submit" type="submit" disabled={loading}>
            {loading ? 'Validando acceso…' : <>Ingresar al portal <IcoArrow /></>}
          </button>

          {installPrompt && <button className="login-install-app" type="button" onClick={installApp}><IcoPlus /> Instalar AS Labs como aplicación</button>}

          <div className="login-security"><span><IcoShield /></span><div><strong>Conexión protegida</strong><small>Tus credenciales y servicios permanecen privados.</small></div></div>
          <div className="login-help">
            ¿Tienes problemas para ingresar? <a href="mailto:info@aslaboratorios.com">Contacta con AS Laboratorios</a>
          </div>
        </form>
      </section>
    </main>
  )
}
