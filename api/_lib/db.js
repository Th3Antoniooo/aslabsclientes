import { neon } from '@neondatabase/serverless'

let client

export function db() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL no está configurada')
  }
  if (!client) client = neon(process.env.DATABASE_URL)
  return client
}

export async function query(text, params = []) {
  return db().query(text, params)
}

