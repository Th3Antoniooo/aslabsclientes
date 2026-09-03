import fs from 'node:fs/promises'
import { neon } from '@neondatabase/serverless'

async function loadLocalEnv() {
  const raw = await fs.readFile(new URL('../.env.local', import.meta.url), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!match || process.env[match[1]]) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    process.env[match[1]] = value.replace(/\\n/g, '\n')
  }
}

await loadLocalEnv()
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no está disponible')
const sql = neon(process.env.DATABASE_URL)

const admin = (await sql.query(
  `SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
   WHERE r.slug='admin' AND LOWER(u.email)='antoniog@aslaboratorios.com' LIMIT 1`,
))[0]
if (!admin) throw new Error('No se encontró el administrador responsable')

const operatorRows = await sql.query(
  `SELECT id,full_name FROM analysts
   WHERE LOWER(full_name) IN (
     'antonio guevara escobar','jurith aguilar pichen','madeleine isuiza flores','rosa cabanillas'
   )`,
)
const operators = new Map(operatorRows.map((item) => [item.full_name.split(' ')[0].toLowerCase(), item]))
for (const name of ['antonio', 'jurith', 'madeleine', 'rosa']) {
  if (!operators.get(name)) throw new Error(`No se encontró a ${name}`)
}

const dateCode = (code, date) => `${code} ${date.slice(8, 10)}-${date.slice(5, 7)}`
const stageRow = (stage, subculture) => ({
  currentStage: stage === 'introduction' ? 'multiplication' : 'multiplication',
  currentSubculture: Number(subculture) - 1,
})

async function source(code, stage, subculture = null) {
  const rows = await sql.query(
    `SELECT * FROM biotechnology_batches
     WHERE LOWER(code)=LOWER($1) AND current_stage=$2
       AND ($3::int IS NULL OR current_subculture+1=$3)
       AND archived_at IS NULL
     ORDER BY created_at ASC LIMIT 1`,
    [code, stage, subculture],
  )
  if (!rows[0]) throw new Error(`No se encontró el origen ${code}${subculture ? ` C${subculture}` : ''}`)
  return rows[0]
}

async function replaceRecord({ key, sourceBatch, codeBase = sourceBatch.code, date, targetSubculture, inputBags = 0, outputBags, operator, note = '' }) {
  const person = operators.get(operator)
  const plantsPerBag = Number(sourceBatch.plants_per_bag || 4)
  const inputPlants = Number(inputBags) * plantsPerBag
  const outputPlants = Number(outputBags) * plantsPerBag
  const target = Number(targetSubculture)
  const eventStage = sourceBatch.current_stage === 'introduction' ? 'introduction' : 'multiplication'
  const eventSubculture = eventStage === 'multiplication' ? target : null
  const expected = eventStage === 'multiplication'
    ? inputPlants * Number(sourceBatch.multiplication_factor || 1)
    : outputPlants
  const next = stageRow(eventStage, target)
  const code = dateCode(codeBase, date)

  const existing = (await sql.query(`SELECT id FROM biotechnology_batches WHERE source_external_key=$1 LIMIT 1`, [key]))[0]
  let branch
  if (existing) {
    await sql.query(`DELETE FROM biotechnology_events WHERE batch_id=$1`, [existing.id])
    branch = (await sql.query(
      `UPDATE biotechnology_batches SET code=$2,crop_name=$3,variety=$4,source_material=$5,initial_plants=$6,
         multiplication_factor=$7,target_subcultures=$8,plants_per_bag=$9,current_stage=$10,current_subculture=$11,
         current_viable_plants=$12,rooting_bags=0,status='active',created_by_user_id=$13,updated_by_user_id=$13,
         cultivar_id=$14,started_on=$15::date,current_stage_started_on=$15::date,source_note=$16,archived_at=NULL,
         archived_by_user_id=NULL,updated_at=NOW() WHERE id=$1 RETURNING id`,
      [existing.id,code,sourceBatch.crop_name,sourceBatch.variety,`Corrección histórica desde ${sourceBatch.code}`,
        Math.max(1, outputPlants),sourceBatch.multiplication_factor,Math.max(Number(sourceBatch.target_subcultures || target), target),
        plantsPerBag,next.currentStage,next.currentSubculture,outputPlants,admin.id,sourceBatch.cultivar_id,date,
        `Corrección histórica · ${date} · ${sourceBatch.code} → C${target}${note ? ` · ${note}` : ''}`],
    ))[0]
  } else {
    branch = (await sql.query(
      `INSERT INTO biotechnology_batches
       (code,crop_name,variety,source_material,initial_plants,multiplication_factor,target_subcultures,plants_per_bag,
        current_stage,current_subculture,current_viable_plants,rooting_bags,status,created_by_user_id,updated_by_user_id,
        cultivar_id,started_on,current_stage_started_on,source_external_key,source_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,'active',$12,$12,$13,$14::date,$14::date,$15,$16)
       RETURNING id`,
      [code,sourceBatch.crop_name,sourceBatch.variety,`Corrección histórica desde ${sourceBatch.code}`,
        Math.max(1, outputPlants),sourceBatch.multiplication_factor,Math.max(Number(sourceBatch.target_subcultures || target), target),
        plantsPerBag,next.currentStage,next.currentSubculture,outputPlants,admin.id,sourceBatch.cultivar_id,date,key,
        `Corrección histórica · ${date} · ${sourceBatch.code} → C${target}${note ? ` · ${note}` : ''}`],
    ))[0]
  }
  await sql.query(
    `INSERT INTO biotechnology_events
     (batch_id,stage,subculture_number,performed_at,input_plants,bags_processed,plants_per_bag,
      expected_output_plants,viable_output_plants,contaminated_plants,discarded_plants,
      worker_analyst_id,worker_name,recorded_by_user_id,observations)
     VALUES ($1,$2,$3,$4::date + TIME '12:00',$5,$6,$7,$8,$9,0,0,$10,$11,$12,$13)`,
    [branch.id,eventStage,eventSubculture,date,inputPlants,Number(outputBags),plantsPerBag,expected,outputPlants,
      person.id,person.full_name,admin.id,`Corrección histórica. Valores registrados en bolsas.${note ? ` ${note}` : ''}`],
  )
  return { id: branch.id, code, date, target, outputBags: Number(outputBags), operator: person.full_name }
}

async function archiveIncorrectGeneratedRecords() {
  const oldCodes = ['5VA 16-08', '57E 16-08', 'MER 16-08', 'I22 16-08', 'C5-E8 16-08']
  const rows = await sql.query(
    `SELECT id FROM biotechnology_batches WHERE LOWER(code)=ANY($1::text[]) AND archived_at IS NULL`,
    [oldCodes.map((code) => code.toLowerCase())],
  )
  for (const row of rows) {
    await sql.query(`DELETE FROM biotechnology_events WHERE batch_id=$1`, [row.id])
    await sql.query(`UPDATE biotechnology_batches SET archived_at=NOW(),archived_by_user_id=$2,updated_by_user_id=$2,updated_at=NOW() WHERE id=$1`, [row.id, admin.id])
  }
  for (const [code, date] of [['57E', '2026-08-14'], ['BC', '2026-08-15'], ['BBG', '2026-08-15'], ['COD58', '2026-08-15']]) {
    const batch = await source(code, code === 'BC' ? 'introduction' : 'multiplication', code === 'BC' ? null : code === '57E' ? 8 : code === 'BBG' ? 8 : 7)
    await sql.query(`DELETE FROM biotechnology_events WHERE batch_id=$1 AND performed_at::date=$2::date`, [batch.id, date])
  }
}

await archiveIncorrectGeneratedRecords()

const fiveVA = await source('5VA', 'multiplication', 5)
const i22 = await source('I22', 'multiplication', 15)
const mzn = await source('MZN', 'multiplication', 7)
const c5e8 = await source('C5-E8', 'multiplication', 7)
const fiftySevenE = await source('57E', 'multiplication', 8)
const mer = await source('MER', 'introduction')
const bc = await source('BC', 'introduction')
const br = await source('BR', 'multiplication', 1)
const cod58 = await source('COD58', 'multiplication', 7)
const bbg = await source('BBG', 'multiplication', 8)
const mal = await source('MAL', 'multiplication', 1)
const bcrTemplate = await source('BCR', 'multiplication', 1)

const corrected = []
corrected.push(await replaceRecord({ key: 'BIO-CORRECTION-2026-08-12-5VA-C6', sourceBatch: fiveVA, date: '2026-08-12', targetSubculture: 6, inputBags: 1, outputBags: 3, operator: 'antonio' }))
// I22 aparece originalmente en C15; por eso el destino coherente de ambas ramas es C16.
corrected.push(await replaceRecord({ key: 'BIO-CORRECTION-2026-08-12-I22-C16', sourceBatch: i22, date: '2026-08-12', targetSubculture: 16, inputBags: 77, outputBags: 13, operator: 'antonio', note: 'Destino C16 según el estado del código de origen.' }))
corrected.push(await replaceRecord({ key: 'BIO-CORRECTION-2026-08-12-MZN-C8', sourceBatch: mzn, date: '2026-08-12', targetSubculture: 8, inputBags: 19, outputBags: 19, operator: 'antonio' }))
corrected.push(await replaceRecord({ key: 'BIO-CORRECTION-2026-08-12-C5E8-C8', sourceBatch: c5e8, date: '2026-08-12', targetSubculture: 8, inputBags: 22, outputBags: 58, operator: 'madeleine' }))
corrected.push(await replaceRecord({ key: 'BIO-CORRECTION-2026-08-12-57E-C9-A', sourceBatch: fiftySevenE, date: '2026-08-12', targetSubculture: 9, inputBags: 14, outputBags: 48, operator: 'madeleine' }))
corrected.push(await replaceRecord({ key: 'BIO-CORRECTION-2026-08-12-MER-C1', sourceBatch: mer, date: '2026-08-12', targetSubculture: 1, outputBags: 38, operator: 'rosa', note: 'No se indicó el número de bolsas iniciales.' }))
const bcC1 = await replaceRecord({ key: 'BIO-CORRECTION-2026-08-12-BC-C1', sourceBatch: bc, date: '2026-08-12', targetSubculture: 1, outputBags: 36, operator: 'rosa', note: 'No se indicó el número de bolsas iniciales.' })
corrected.push(bcC1)
corrected.push(await replaceRecord({ key: 'BIO-CORRECTION-2026-08-12-BR-C2', sourceBatch: br, date: '2026-08-12', targetSubculture: 2, outputBags: 25, operator: 'rosa', note: 'No se indicó el número de bolsas iniciales.' }))

corrected.push(await replaceRecord({ key: 'BIO-CORRECTION-2026-08-13-I22-C16', sourceBatch: i22, date: '2026-08-13', targetSubculture: 16, inputBags: 87, outputBags: 12, operator: 'jurith' }))
corrected.push(await replaceRecord({ key: 'BIO-CORRECTION-2026-08-13-57E-C9-B', sourceBatch: fiftySevenE, date: '2026-08-13', targetSubculture: 9, inputBags: 39, outputBags: 134, operator: 'madeleine' }))
const bcC1Branch = (await sql.query(`SELECT * FROM biotechnology_batches WHERE id=$1`, [bcC1.id]))[0]
corrected.push(await replaceRecord({ key: 'BIO-CORRECTION-2026-08-13-BC-C2', sourceBatch: bcC1Branch, codeBase: 'BC', date: '2026-08-13', targetSubculture: 2, outputBags: 197, operator: 'rosa', note: 'No se indicó el número de bolsas iniciales.' }))

corrected.push(await replaceRecord({ key: 'BIO-CORRECTION-2026-08-14-COD58-C8', sourceBatch: cod58, date: '2026-08-14', targetSubculture: 8, inputBags: 9, outputBags: 17, operator: 'jurith' }))
corrected.push(await replaceRecord({ key: 'BIO-CORRECTION-2026-08-14-BBG-C9', sourceBatch: bbg, date: '2026-08-14', targetSubculture: 9, inputBags: 3, outputBags: 3, operator: 'jurith' }))
corrected.push(await replaceRecord({ key: 'BIO-CORRECTION-2026-08-14-57E-C9-C', sourceBatch: fiftySevenE, date: '2026-08-14', targetSubculture: 9, inputBags: 134, outputBags: 33, operator: 'madeleine' }))
corrected.push(await replaceRecord({ key: 'BIO-CORRECTION-2026-08-14-BC-C2', sourceBatch: bcC1Branch, codeBase: 'BC', date: '2026-08-14', targetSubculture: 2, outputBags: 117, operator: 'rosa', note: 'No se indicó el número de bolsas iniciales.' }))
corrected.push(await replaceRecord({ key: 'BIO-CORRECTION-2026-08-14-MAL-C2', sourceBatch: mal, date: '2026-08-14', targetSubculture: 2, outputBags: 51, operator: 'rosa', note: 'No se indicó el número de bolsas iniciales.' }))
corrected.push(await replaceRecord({ key: 'BIO-CORRECTION-2026-08-14-BCR-C1', sourceBatch: { ...bcrTemplate, current_stage: 'introduction' }, codeBase: 'BCR', date: '2026-08-14', targetSubculture: 1, outputBags: 21, operator: 'rosa', note: 'Registro de introducción a C1; no se indicó el número de bolsas iniciales.' }))

const legacyFiveG = (await sql.query(
  `SELECT b.* FROM biotechnology_batches b JOIN biotechnology_events e ON e.batch_id=b.id
   WHERE LOWER(b.code)='5g' AND e.worker_name='Jurith Aguilar Pichen' AND e.bags_processed=29
   ORDER BY e.created_at DESC LIMIT 1`,
))[0]
if (!legacyFiveG) throw new Error('No se encontró el registro anterior de 5G para corregirlo')
const jurith = operators.get('jurith')
const fiveGInput = 29 * Number(legacyFiveG.plants_per_bag || 4)
const fiveGOutput = 61 * Number(legacyFiveG.plants_per_bag || 4)
await sql.query(
  `UPDATE biotechnology_batches SET code='5G 14-08',current_stage='multiplication',current_subculture=11,
     current_viable_plants=$2,status='active',started_on='2026-08-14',current_stage_started_on='2026-08-14',
     source_note='Corrección histórica · 2026-08-14 · 5G → C12',updated_by_user_id=$3,updated_at=NOW() WHERE id=$1`,
  [legacyFiveG.id,fiveGOutput,admin.id],
)
await sql.query(
  `UPDATE biotechnology_events SET stage='multiplication',subculture_number=12,performed_at='2026-08-14 12:00:00+00',
     input_plants=$2,bags_processed=61,expected_output_plants=$3,viable_output_plants=$4,worker_analyst_id=$5,
     worker_name=$6,recorded_by_user_id=$7,observations='Corrección histórica. Valores registrados en bolsas.' WHERE batch_id=$1`,
  [legacyFiveG.id,fiveGInput,fiveGInput * Number(legacyFiveG.multiplication_factor || 1),fiveGOutput,jurith.id,jurith.full_name,admin.id],
)
corrected.push({ id: legacyFiveG.id, code: '5G 14-08', date: '2026-08-14', target: 12, outputBags: 61, operator: jurith.full_name })

console.log(JSON.stringify({ corrected: corrected.length, records: corrected }, null, 2))
