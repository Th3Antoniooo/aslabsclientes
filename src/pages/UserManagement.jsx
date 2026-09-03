import { useEffect, useMemo, useState } from 'react'
import { api } from '../data/api.js'
import DocumentationCenter from '../components/DocumentationCenter.jsx'
import { IcoCheck, IcoFile, IcoPlus, IcoShield, IcoUser } from '../components/Icons.jsx'

const actions = [
  ['view', 'Ver'],
  ['create', 'Crear'],
  ['edit', 'Editar'],
  ['delete', 'Eliminar'],
]

const blankUser = { fullName: '', email: '', dni: '', company: '', roleId: '', password: '', confirmPassword: '' }

export default function UserManagement({ notify }) {
  const [tab, setTab] = useState('users')
  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [modules, setModules] = useState([])
  const [loading, setLoading] = useState(true)
  const [showUser, setShowUser] = useState(false)
  const [userForm, setUserForm] = useState(blankUser)
  const [roleForm, setRoleForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [userData, roleData] = await Promise.all([api.users(), api.roles()])
      setUsers(userData.users)
      setRoles(roleData.roles)
      setModules(roleData.modules)
      if (!userForm.roleId) {
        const clientRole = roleData.roles.find((role) => role.slug === 'client')
        setUserForm((current) => ({ ...current, roleId: clientRole?.id || roleData.roles[0]?.id || '' }))
      }
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const activeUsers = useMemo(() => users.filter((user) => user.status === 'active').length, [users])
  const primaryIdentifier = userForm.email.trim() || userForm.dni.trim()

  const createUser = async (event) => {
    event.preventDefault()
    if (userForm.password !== userForm.confirmPassword) {
      setError('Las contraseñas no coinciden.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await api.createUser(userForm)
      setShowUser(false)
      setUserForm((current) => ({ ...blankUser, roleId: current.roleId }))
      await load()
      notify('Usuario creado y permisos asignados correctamente.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  const updateUser = async (id, changes) => {
    try {
      await api.updateUser({ id, ...changes })
      setUsers((current) => current.map((user) => user.id === id ? {
        ...user,
        ...changes,
        ...(changes.roleId ? {
          role_id: changes.roleId,
          role_name: roles.find((role) => role.id === changes.roleId)?.name,
        } : {}),
      } : user))
      notify('Acceso actualizado.')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  const editRole = (role) => {
    const permissions = {}
    modules.forEach((module) => {
      permissions[module.id] = {
        view: !!role?.permissions?.[module.id]?.view,
        create: !!role?.permissions?.[module.id]?.create,
        edit: !!role?.permissions?.[module.id]?.edit,
        delete: !!role?.permissions?.[module.id]?.delete,
      }
    })
    setRoleForm({
      id: role?.is_system ? undefined : role?.id,
      sourceId: role?.id,
      name: role?.is_system ? `${role.name} personalizado` : role?.name || '',
      description: role?.description || '',
      permissions,
    })
  }

  const togglePermission = (moduleId, action) => {
    setRoleForm((current) => {
      const next = {
        ...current,
        permissions: {
          ...current.permissions,
          [moduleId]: { ...current.permissions[moduleId], [action]: !current.permissions[moduleId][action] },
        },
      }
      if (action !== 'view' && next.permissions[moduleId][action]) next.permissions[moduleId].view = true
      if (action === 'view' && !next.permissions[moduleId].view) {
        next.permissions[moduleId] = { view: false, create: false, edit: false, delete: false }
      }
      return next
    })
  }

  const saveRole = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await api.saveRole(roleForm)
      setRoleForm(null)
      await load()
      notify('Rol y permisos guardados.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="access-page">
      <section className="access-overview anim-in d1">
        <div>
          <span className="eyebrow">Administración del portal</span>
          <h1>Accesos y sistema documental</h1>
          <p>Gestiona usuarios y permisos, y consulta la documentación que respalda cada operación del laboratorio.</p>
        </div>
        <div className="access-stats">
          <div><strong>{activeUsers}</strong><span>usuarios activos</span></div>
          <div><strong>{roles.length}</strong><span>roles configurados</span></div>
          <div><strong>{modules.length}</strong><span>módulos protegidos</span></div>
        </div>
      </section>

      <div className="access-toolbar anim-in d2">
        <div className="segmented">
          <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}><IcoUser /> Usuarios</button>
          <button className={tab === 'roles' ? 'active' : ''} onClick={() => setTab('roles')}><IcoShield /> Roles y permisos</button>
          <button className={tab === 'documents' ? 'active' : ''} onClick={() => setTab('documents')}><IcoFile /> Documentación ISO</button>
        </div>
        {tab === 'users' ? (
          <button className="btn btn-primary" onClick={() => { setError(''); setShowPassword(false); setShowUser(true) }}><IcoPlus /> Nuevo usuario</button>
        ) : tab === 'roles' ? (
          <button className="btn btn-primary" onClick={() => editRole(null)}><IcoPlus /> Nuevo rol</button>
        ) : null}
      </div>

      {error && !showUser && !roleForm && <div className="form-error access-error">{error}</div>}

      {tab === 'users' && (
        <section className="card access-table-card anim-in d3">
          <div className="access-table-head">
            <span>Usuario</span><span>Rol</span><span>Último acceso</span><span>Estado</span><span />
          </div>
          {loading ? <div className="access-loading">Cargando usuarios…</div> : users.map((user) => {
            const identifiers = [user.email, user.dni ? `DNI ${user.dni}` : ''].filter(Boolean).join(' · ')
            return <div className="access-user-row" key={user.id}>
              <div className="access-user">
                <span className="avatar">{user.initials}</span>
                <div><strong>{user.full_name}</strong><span>{identifiers} · {user.company}</span></div>
              </div>
              <select value={user.role_id} onChange={(event) => updateUser(user.id, { roleId: event.target.value })}>
                {roles.map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}
              </select>
              <span className="last-access">{user.last_login_at ? new Date(user.last_login_at).toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Aún no ingresó'}</span>
              <span className={`user-status ${user.status}`}><i /> {user.status === 'active' ? 'Activo' : 'Inactivo'}</span>
              <button
                className="table-action"
                onClick={() => updateUser(user.id, { status: user.status === 'active' ? 'inactive' : 'active' })}
              >
                {user.status === 'active' ? 'Desactivar' : 'Activar'}
              </button>
            </div>
          })}
        </section>
      )}

      {tab === 'roles' && (
        <div className="roles-grid anim-in d3">
          {roles.map((role) => (
            <article className="card role-card" key={role.id}>
              <header>
                <span className="role-icon"><IcoShield /></span>
                <span className={`role-kind ${role.is_system ? 'system' : ''}`}>{role.is_system ? 'Base' : 'Personalizado'}</span>
              </header>
              <h3>{role.name}</h3>
              <p>{role.description}</p>
              <div className="role-meta"><strong>{role.user_count}</strong> usuarios · <strong>{Object.values(role.permissions || {}).filter((permission) => permission.view).length}</strong> módulos</div>
              <div className="role-module-pills">
                {modules.filter((module) => role.permissions?.[module.id]?.view).slice(0, 4).map((module) => <span key={module.id}>{module.name}</span>)}
              </div>
              <button className="btn btn-ghost" onClick={() => editRole(role)}>
                {role.is_system ? 'Duplicar y personalizar' : 'Editar permisos'}
              </button>
            </article>
          ))}
        </div>
      )}

      {tab === 'documents' && <DocumentationCenter />}

      {showUser && (
        <div className="modal-overlay" onClick={() => setShowUser(false)}>
          <form className="modal access-modal" onSubmit={createUser} onClick={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <span className="modal-icon"><IcoUser /></span>
              <div><span className="eyebrow">Nuevo acceso</span><h2>Crear usuario</h2><p>La persona podrá ingresar inmediatamente con la contraseña asignada.</p></div>
            </div>
            <div className="form-grid">
              <label className="field"><span>Nombre completo</span><input value={userForm.fullName} onChange={(e) => setUserForm({ ...userForm, fullName: e.target.value })} required /></label>
              <label className="field"><span>Empresa</span><input value={userForm.company} onChange={(e) => setUserForm({ ...userForm, company: e.target.value })} required /></label>
              <label className="field"><span>Correo electrónico</span><input type="email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} placeholder="Opcional si ingresas DNI" /></label>
              <label className="field"><span>DNI</span><input inputMode="numeric" maxLength="8" pattern="[0-9]{8}" value={userForm.dni} onChange={(e) => setUserForm({ ...userForm, dni: e.target.value.replace(/\D/g, '').slice(0, 8) })} placeholder="Opcional si ingresas correo" /></label>
              <div className={`access-identifier-guide field-wide ${primaryIdentifier ? 'ready' : ''}`}>
                <IcoUser />
                <div><strong>{primaryIdentifier ? `Usuario principal: ${userForm.email.trim() ? userForm.email.trim() : userForm.dni.trim()}` : 'Ingresa un correo, un DNI o ambos'}</strong><span>{userForm.email.trim() && userForm.dni.trim() ? 'El correo será el usuario principal; también podrá ingresar con su DNI.' : 'El dato que completes será su usuario para iniciar sesión.'}</span></div>
              </div>
              <label className="field"><span>Rol</span><select value={userForm.roleId} onChange={(e) => setUserForm({ ...userForm, roleId: e.target.value })}>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
              <label className="field password-create-field">
                <span>Contraseña de acceso</span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={userForm.password}
                  onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                  placeholder="Escribe una contraseña"
                  required
                />
                <button type="button" onClick={() => setShowPassword((current) => !current)}>
                  {showPassword ? 'Ocultar' : 'Mostrar'}
                </button>
              </label>
              <label className="field">
                <span>Confirmar contraseña</span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={userForm.confirmPassword}
                  onChange={(e) => setUserForm({ ...userForm, confirmPassword: e.target.value })}
                  placeholder="Repite la contraseña"
                  required
                />
              </label>
              <div className="password-create-note field-wide">
                <IcoShield />
                <span>Esta será la contraseña con la que el cliente ingresará desde su primer acceso. No se mostrará nuevamente después de crear la cuenta.</span>
              </div>
            </div>
            {error && <div className="form-error">{error}</div>}
            <div className="modal-actions"><button className="btn btn-ghost" type="button" onClick={() => setShowUser(false)}>Cancelar</button><button className="btn btn-primary" disabled={saving}>{saving ? 'Creando…' : 'Crear usuario'}</button></div>
          </form>
        </div>
      )}

      {roleForm && (
        <div className="modal-overlay" onClick={() => setRoleForm(null)}>
          <form className="modal role-modal" onSubmit={saveRole} onClick={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <span className="modal-icon"><IcoShield /></span>
              <div><span className="eyebrow">Permisos por módulo</span><h2>{roleForm.id ? 'Editar rol' : 'Crear rol'}</h2><p>Marca solo las acciones necesarias para este grupo de usuarios.</p></div>
            </div>
            <div className="form-grid role-name-fields">
              <label className="field"><span>Nombre del rol</span><input value={roleForm.name} onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })} required /></label>
              <label className="field"><span>Descripción</span><input value={roleForm.description} onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })} /></label>
            </div>
            <div className="permission-matrix">
              <div className="permission-head"><span>Módulo</span>{actions.map(([, label]) => <span key={label}>{label}</span>)}</div>
              {modules.map((module) => (
                <div className="permission-row" key={module.id}>
                  <span><strong>{module.name}</strong><small>{module.description}</small></span>
                  {actions.map(([action, label]) => (
                    <button
                      type="button"
                      aria-label={`${label} ${module.name}`}
                      className={roleForm.permissions[module.id]?.[action] ? 'checked' : ''}
                      onClick={() => togglePermission(module.id, action)}
                      key={action}
                    >
                      {roleForm.permissions[module.id]?.[action] && <IcoCheck />}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            {error && <div className="form-error">{error}</div>}
            <div className="modal-actions"><button className="btn btn-ghost" type="button" onClick={() => setRoleForm(null)}>Cancelar</button><button className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar rol'}</button></div>
          </form>
        </div>
      )}
    </div>
  )
}
