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

const rows = [
  [1,'Wa',6,'2026-07-26','C6'],[2,'Wgc',7,'2026-05-11','C7'],[3,'Wbc (?)',5,'2026-06-08','Código dudoso · C5'],
  [4,'WgT',6,'2026-06-09','C6'],[5,'THW',12,'2026-04-23','C12'],[6,'BCO',10,'2026-07-15','C10'],
  [7,'PE42',4,'2026-06-28','C4'],[8,'M2N',8,'2026-08-12','C8'],[9,'I22',16,'2026-08-12','C16'],
  [10,'V56',8,'2026-08-10','C8'],[11,'SVA',6,'2026-08-11','C6 · también figura 12-08'],[12,'M2',13,'2026-08-11','C13'],
  [13,'WgL',7,'2026-08-11','C7'],[14,'A2R',10,'2026-08-10','C10'],[15,'GR',8,'2026-08-04','C8'],
  [16,'WP',15,'2026-07-24','C15'],[17,'5gg',6,'2026-08-05','C6'],[18,'C5',7,'2026-08-06','C7'],
  [19,'SVE-T',7,'2026-08-06','C7'],[20,'C5T',5,'2026-07-03','C5'],[21,'Wg-5g',2,'2026-07-15','C2'],
  [22,'C5-E9',7,'2026-07-15','C7'],[23,'5g',12,'2026-07-16','C12'],[24,'5gT',6,'2026-07-16','C6'],
  [25,'5gT',2,'2026-07-30','Subcultivo C2 dudoso'],[26,'VS4',8,'2026-08-10','C8'],[27,'VSS',7,'2026-08-06','C7'],
  [28,'CSL',6,'2026-08-06','C6'],[29,'Wg',12,'2026-07-20','C12'],[30,'C5-E8',8,'2026-08-12','C8'],
  [31,'C5E',7,'2026-02-10','Fecha 10-02 dudosa · C7'],[32,'5g',12,'2026-05-18','C12'],[33,'5g',8,'2026-05-28','C8'],
  [34,'5g',10,'2026-05-20','C10'],[35,'56-Wg',5,'2026-05-12','C5'],[36,'Sin código',null,'2026-06-22','Sin código y sin subcultivo'],
  [37,'M1',12,'2026-06-22','C12'],[38,'Código 58',null,'2026-06-15','Subcultivo C?'],[39,'B8g',9,'2026-06-20','C9'],
  [40,'5AS',7,'2026-07-21','C7'],[41,'BC2',7,'2026-07-23','C7'],[42,'BCT',5,'2026-07-16','C5'],
  [43,'58g',7,'2026-07-21','C7'],[44,'Wg',2,'2026-07-24','C2'],[45,'5gT',2,'2026-07-21','C2'],
  [46,'A55',7,'2026-08-08','C7'],[47,'455',6,'2026-07-15','C6'],[48,'CST',5,'2026-07-21','C5'],
  [49,'CSL',7,'2026-07-22','C7'],[50,'57E',9,'2026-06-08','C9'],[51,'I9',1,'2026-07-21','C1'],
  [52,'FBC',1,'2026-07-21','C1'],[53,'CS',2,'2026-07-20','C2'],[54,'MAL',1,'2026-07-21','C1'],
  [55,'LDO (2) (?)',null,null,'Cultivo anotado como Indio (?) · fecha 30-?'],[56,'BC',1,'2026-07-17','C1'],
  [57,'BCR',1,'2026-07-10','C1'],[58,'MGR',1,'2026-08-12','C1'],[59,'BCR',1,'2026-08-11','C1'],
  [60,'BCO',3,'2026-07-22','C3'],[61,'B12 (?)',2,'2026-08-12','Código dudoso · C2'],
]

const admin = (await sql.query(
  `SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
   WHERE r.slug='admin' AND LOWER(u.email)='antoniog@aslaboratorios.com' LIMIT 1`,
))[0]
if (!admin) throw new Error('No se encontró al administrador principal')

let cultivar = (await sql.query(
  `SELECT id,multiplication_factor,target_subcultures,plants_per_bag
   FROM biotechnology_cultivars WHERE LOWER(crop_name)=LOWER($1) AND LOWER(variety)=LOWER($2) LIMIT 1`,
  ['Importado · por definir',''],
))[0]
if (!cultivar) {
  cultivar = (await sql.query(
    `INSERT INTO biotechnology_cultivars
     (crop_name,variety,multiplication_factor,target_subcultures,plants_per_bag,created_by_user_id,updated_by_user_id)
     VALUES ($1,$2,2.5,20,4,$3,$3)
     RETURNING id,multiplication_factor,target_subcultures,plants_per_bag`,
    ['Importado · por definir','',admin.id],
  ))[0]
}

let inserted = 0
for (const [number,code,subculture,startedOn,note] of rows) {
  const uncertain = /\?|Sin código|dudos|30-/.test(`${code} ${note}`)
  const result = await sql.query(
    `INSERT INTO biotechnology_batches
     (code,crop_name,variety,initial_plants,multiplication_factor,target_subcultures,plants_per_bag,
      current_stage,current_subculture,current_viable_plants,status,created_by_user_id,updated_by_user_id,
      cultivar_id,started_on,source_external_key,source_note,needs_review)
     VALUES ($1,'Importado · por definir','',1,$2,$3,$4,'multiplication',$5,1,$12,$6,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (source_external_key) WHERE source_external_key IS NOT NULL DO NOTHING RETURNING id`,
    [code,cultivar.multiplication_factor,Math.max(Number(cultivar.target_subcultures || 20),Number(subculture || 1)),
      cultivar.plants_per_bag,Math.max(0,Number(subculture || 1)-1),admin.id,cultivar.id,startedOn,
      `BIO-IMPORT-2026-08-${String(number).padStart(2,'0')}`,`Importación 13-08-2026 · ${note}`,uncertain,
      subculture ? 'active' : 'paused'],
  )
  if (result[0]) inserted += 1
}

const total = await sql.query(`SELECT COUNT(*)::int AS count FROM biotechnology_batches WHERE source_external_key LIKE 'BIO-IMPORT-2026-08-%'`)
console.log(JSON.stringify({ inserted, importedTotal: total[0].count }))
