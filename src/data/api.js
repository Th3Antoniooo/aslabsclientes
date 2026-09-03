async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'No fue posible completar la solicitud.')
  return payload
}

export const api = {
  me: () => request('/api/auth/me'),
  login: (identifier, password) => request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  }),
  unlockWorker: (pin) => request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ action: 'unlock_worker', pin }),
  }),
  logout: () => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ action: 'logout' }) }),
  lockWorker: () => request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ action: 'lock_worker' }),
  }),
  notifications: () => request('/api/notifications'),
  readNotification: (id) => request('/api/notifications', {
    method: 'PATCH',
    body: JSON.stringify({ id }),
  }),
  readAllNotifications: () => request('/api/notifications', {
    method: 'PATCH',
    body: JSON.stringify({ all: true }),
  }),
  acknowledgeOperationalAlert: (alertKey) => request('/api/notifications', {
    method: 'PATCH',
    body: JSON.stringify({ alertKey }),
  }),
  emailDeliveries: (refreshId = '') => request(`/api/notifications?emailLog=1${refreshId ? `&refresh=${encodeURIComponent(refreshId)}` : ''}`),
  support: () => request('/api/support'),
  createSupportTicket: (payload) => request('/api/support', {
    method: 'POST',
    body: JSON.stringify({ action: 'create', ...payload }),
  }),
  replySupportTicket: (ticketId, message) => request('/api/support', {
    method: 'POST',
    body: JSON.stringify({ action: 'reply', ticketId, message }),
  }),
  updateSupportTicket: (ticketId, status) => request('/api/support', {
    method: 'PATCH',
    body: JSON.stringify({ ticketId, status }),
  }),
  users: () => request('/api/admin/users'),
  createUser: (payload) => request('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  updateUser: (payload) => request('/api/admin/users', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }),
  adminDocuments: () => request('/api/admin/users?documents=1'),
  analysts: () => request('/api/admin/analysts'),
  createAnalyst: (payload) => request('/api/admin/analysts', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  updateAnalyst: (payload) => request('/api/admin/analysts', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }),
  roles: () => request('/api/admin/roles'),
  tracking: () => request('/api/tracking'),
  updateTracking: (payload) => request('/api/tracking', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  dna: (serviceId = '') => request(`/api/dna${serviceId ? `?serviceId=${encodeURIComponent(serviceId)}` : ''}`),
  biotechnology: () => request('/api/dna?biotechnology=1'),
  createBiotechnology: (payload) => request('/api/dna?biotechnology=1', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  updateBiotechnology: (payload) => request('/api/dna?biotechnology=1', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }),
  services: () => request('/api/services'),
  trashedServices: () => request('/api/services?trash=1'),
  finalReports: () => request('/api/services?reports=1'),
  serviceCatalog: () => request('/api/services?catalog=1'),
  labOperations: () => request('/api/services?labOperations=2'),
  createLabOperation: (payload) => request('/api/services?labOperations=2', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  updateLabOperation: (payload) => request('/api/services?labOperations=2', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }),
  equipmentOperations: () => request('/api/services?labOperations=1'),
  createEquipmentOperation: (payload) => request('/api/services?labOperations=1', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  updateEquipmentOperation: (payload) => request('/api/services?labOperations=1', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }),
  createService: (payload) => request('/api/services', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  updateService: (id, status) => request('/api/services', {
    method: 'PATCH',
    body: JSON.stringify({ id, status }),
  }),
  renameService: (id, displayName) => request('/api/services', {
    method: 'PATCH',
    body: JSON.stringify({ action: 'rename', id, displayName }),
  }),
  editService: (id, payload) => request('/api/services', {
    method: 'PATCH',
    body: JSON.stringify({ action: 'edit_full', id, ...payload }),
  }),
  assignServiceAnalysts: (id, analystIds) => request('/api/services', {
    method: 'PATCH',
    body: JSON.stringify({ action: 'set_analysts', id, analystIds }),
  }),
  trashService: (id, reason = '') => request('/api/services', {
    method: 'PATCH',
    body: JSON.stringify({ action: 'trash', id, reason }),
  }),
  restoreService: (id) => request('/api/services', {
    method: 'PATCH',
    body: JSON.stringify({ action: 'restore', id }),
  }),
  zones: () => request('/api/zones'),
  createZone: (payload) => request('/api/zones', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  serviceWorkflow: (serviceId) => request(`/api/service-workflow?serviceId=${encodeURIComponent(serviceId)}`),
  moveServiceStage: (serviceId, direction, details = {}) => request(`/api/service-workflow?serviceId=${encodeURIComponent(serviceId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'move', direction, ...(typeof details === 'string' ? { note: details } : details) }),
  }),
  saveServiceStage: (serviceId, payload) => request(`/api/service-workflow?serviceId=${encodeURIComponent(serviceId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'save_stage', ...payload }),
  }),
  sampleIntakes: (serviceId) => request(`/api/service-workflow?sampleIntake=1&serviceId=${encodeURIComponent(serviceId)}`),
  createSampleIntake: (serviceId, payload) => request(`/api/service-workflow?sampleIntake=1&serviceId=${encodeURIComponent(serviceId)}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  updateSampleIntake: (serviceId, payload) => request(`/api/service-workflow?sampleIntake=1&serviceId=${encodeURIComponent(serviceId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }),
  uploadFinalReport: (serviceId, report, notes = '') => request(`/api/service-workflow?serviceId=${encodeURIComponent(serviceId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'upload_final_report', report, notes }),
  }),
  saveServiceResults: (serviceId, results, photos = []) => request(`/api/service-workflow?serviceId=${encodeURIComponent(serviceId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'save_results', results, photos }),
  }),
  generateFinalReport: (serviceId, report = {}) => request(`/api/service-workflow?serviceId=${encodeURIComponent(serviceId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'generate_final_report', ...report }),
  }),
  reviewFinalReport: (serviceId, reportId, decision, notes = '') => request(`/api/service-workflow?serviceId=${encodeURIComponent(serviceId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'review_final_report', reportId, decision, notes }),
  }),
  assignServiceCrew: (serviceId, payload) => request(`/api/service-workflow?serviceId=${encodeURIComponent(serviceId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'assign_crew', ...payload }),
  }),
  deleteStagePhoto: (serviceId, photoId) => request(`/api/service-workflow?serviceId=${encodeURIComponent(serviceId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ photoId }),
  }),
  saveRole: (payload) => request('/api/admin/roles', {
    method: payload.id ? 'PATCH' : 'POST',
    body: JSON.stringify(payload),
  }),
  procurement: () => request('/api/services?procurement=1'),
  createPurchaseOrder: (payload) => request('/api/services?procurement=1', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  submitSupplierQuote: (payload) => request('/api/services?procurement=1', {
    method: 'PATCH',
    body: JSON.stringify({ action: 'submit_quote', ...payload }),
  }),
  updatePurchaseOrderStatus: (payload) => request('/api/services?procurement=1', {
    method: 'PATCH',
    body: JSON.stringify({ action: 'set_status', ...payload }),
  }),
  uploadSupplierPayment: (payload) => request('/api/services?procurement=1', {
    method: 'PATCH',
    body: JSON.stringify({ action: 'upload_payment', ...payload }),
  }),
}
