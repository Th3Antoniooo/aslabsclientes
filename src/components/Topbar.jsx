import { IcoLogout, IcoMenu } from './Icons.jsx'
import NotificationCenter from './NotificationCenter.jsx'

const TITLES = {
  dashboard: ['Vista general', 'Centro de trabajo'],
  ordenes: ['Servicios', 'Órdenes de análisis'],
  tracking: ['Operaciones de campo', 'Muestreo en tiempo real'],
  operaciones: ['Control interno', 'Operaciones de laboratorio'],
  biotecnologia: ['Producción in vitro', 'Biotecnología vegetal'],
  dna: ['Biotecnología', 'Trazabilidad de extracción de DNA'],
  zonas: ['Cartografía', 'Zonas de campo'],
  resultados: ['Laboratorio', 'Resultados e informes'],
  accesos: ['Administración', 'Usuarios y permisos'],
  analistas: ['Laboratorio', 'Directorio de analistas'],
  proveedores: ['Abastecimiento', 'Proveedores y compras'],
  correos: ['Comunicaciones', 'Correos enviados'],
  asistencia: ['Atención AS Labs', 'Asistencia'],
  cuenta: ['Configuración', 'Mi cuenta'],
  nueva: ['Solicitud', 'Nueva orden de análisis'],
}

export default function Topbar({ view, user, onMenu, onNavigate, onWorkerLock }) {
  const [crumb, title] = TITLES[view] || TITLES.dashboard
  const displayName = user.activeWorker?.fullName || user.nombre
  const displayInitials = user.activeWorker?.initials || user.iniciales
  return (
    <header className="topbar">
      <div className="topbar-heading">
        <button className="menu-button" onClick={onMenu} aria-label="Abrir menú"><IcoMenu /></button>
        <div>
          <div className="topbar-crumb">{crumb}</div>
          <div className="topbar-title">{title}</div>
        </div>
      </div>
      <div className="topbar-right">
        <div className="live-pill">
          <span className="live-dot" /> Operativo
        </div>
        {(user.role === 'admin' || user.permissions?.notifications?.view) && (
          <NotificationCenter onNavigate={onNavigate} />
        )}
        {onWorkerLock && <button className="worker-quick-lock" onClick={onWorkerLock}><IcoLogout /> Salida rápida</button>}
        <div className="topbar-user">
          <div className="avatar">{displayInitials}</div>
          <div>
            <strong>{displayName}</strong>
            <span>{user.activeWorker ? 'Operador activo' : user.role === 'admin' ? 'Administrador' : ['client', 'supplier'].includes(user.role) ? user.empresa : user.roleName}</span>
          </div>
        </div>
      </div>
    </header>
  )
}
