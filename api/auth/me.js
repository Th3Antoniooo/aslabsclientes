import { getUser } from '../_lib/auth.js'
import { json, methodNotAllowed } from '../_lib/http.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  const user = await getUser(req)
  return user ? json(res, 200, { user }) : json(res, 401, { error: 'Sesión no válida' })
}

