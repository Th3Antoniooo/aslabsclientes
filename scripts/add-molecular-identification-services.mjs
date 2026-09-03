import fs from 'node:fs/promises'
import { neon } from '@neondatabase/serverless'

async function loadLocalEnv() {
  const raw = await fs.readFile(new URL('../.env.local', import.meta.url), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!match || process.env[match[1]]) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[match[1]] = value.replace(/\\n/g, '\n')
  }
}

await loadLocalEnv()
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no está disponible')

const sql = neon(process.env.DATABASE_URL)
const services = [
  {
    id: 'research-molecular-identification-genome',
    name: 'Identificación molecular de microorganismos — secuenciamiento del genoma',
    description: 'Extracción y control de calidad del DNA, preparación documental y logística internacional. La etapa operativa final corresponde al envío a China para secuenciamiento del genoma.',
    duration: 'Según logística internacional',
    icon: '🧬',
    matrix: 'Aislados bacterianos, fúngicos u otros microorganismos',
    sortOrder: 60,
  },
  {
    id: 'research-molecular-identification-16s',
    name: 'Identificación molecular de microorganismos — 16S rRNA',
    description: 'Extracción de DNA, amplificación de la región 16S rRNA, control de calidad, secuenciamiento, análisis bioinformático e informe de identificación.',
    duration: '12–20 días',
    icon: '🧬',
    matrix: 'Aislados bacterianos y arqueanos',
    sortOrder: 70,
  },
  {
    id: 'research-molecular-identification-its',
    name: 'Identificación molecular de microorganismos — región ITS',
    description: 'Extracción de DNA, amplificación de la región ITS, control de calidad, secuenciamiento, análisis bioinformático e informe de identificación.',
    duration: '12–20 días',
    icon: '🍄',
    matrix: 'Aislados fúngicos y levaduras',
    sortOrder: 80,
  },
]

for (const service of services) {
  await sql.query(
    `INSERT INTO service_catalog
     (id,category_id,category_name,name,description,estimated_duration,icon,group_name,matrix_scope,sort_order,active)
     VALUES ($1,'research','Investigación y desarrollo',$2,$3,$4,$5,'Biología molecular',$6,$7,true)
     ON CONFLICT (id) DO UPDATE SET
       category_id=EXCLUDED.category_id,
       category_name=EXCLUDED.category_name,
       name=EXCLUDED.name,
       description=EXCLUDED.description,
       estimated_duration=EXCLUDED.estimated_duration,
       icon=EXCLUDED.icon,
       group_name=EXCLUDED.group_name,
       matrix_scope=EXCLUDED.matrix_scope,
       sort_order=EXCLUDED.sort_order,
       active=true`,
    [service.id, service.name, service.description, service.duration, service.icon, service.matrix, service.sortOrder],
  )
}

const saved = await sql.query(
  `SELECT id,name,active FROM service_catalog
   WHERE id = ANY($1::text[])
   ORDER BY sort_order`,
  [services.map((service) => service.id)],
)

console.log(JSON.stringify(saved, null, 2))
