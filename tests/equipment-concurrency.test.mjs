import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

async function source(path) {
  return readFile(new URL(path, root), 'utf8')
}

test('an active sample never reserves laboratory equipment exclusively', async () => {
  const handler = await source('api/_lib/lab-operations-handler.js')

  assert.doesNotMatch(
    handler,
    /SELECT id FROM laboratory_equipment_runs WHERE equipment_id=\$1 AND status='running'/,
    'A running sample must not block another order from using the same equipment.',
  )
  assert.doesNotMatch(
    handler,
    /Este equipo ya tiene un uso activo/,
    'The API must not report the equipment as exclusively occupied.',
  )
})

test('biotechnology assignments can share the same active equipment', async () => {
  const handler = await source('api/_lib/biotechnology-handler.js')

  assert.doesNotMatch(
    handler,
    /NOT EXISTS \(SELECT 1 FROM laboratory_equipment_runs r WHERE r\.equipment_id=e\.id AND r\.status='running'\)/,
    'Biotechnology samples must not reserve a flow cabinet exclusively.',
  )
})

test('the interface describes sample dwell time instead of equipment occupancy', async () => {
  const [warnings, operations] = await Promise.all([
    source('src/utils/orderWarnings.js'),
    source('src/pages/LabOperations.jsx'),
  ])

  assert.doesNotMatch(warnings, /sigue encendido/)
  assert.doesNotMatch(operations, /equipos en uso ahora/)
  assert.match(operations, /muestras en equipo ahora/)
})
