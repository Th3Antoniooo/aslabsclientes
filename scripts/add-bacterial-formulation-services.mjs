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
  ['bacterial-formulation-bacillus-subtilis', 'Formulación bacteriana de Bacillus subtilis', 'Producción de biomasa, control de pureza y viabilidad, estandarización de concentración, formulación, acondicionamiento y liberación del producto. No incluye aplicación en campo.', 'Según formulación', 'Bacillus subtilis', 910],
  ['bacterial-formulation-bacillus-cereus', 'Formulación bacteriana de Bacillus cereus', 'Producción y formulación controlada de Bacillus cereus, con verificación microbiológica, acondicionamiento y liberación. No incluye aplicación en campo.', 'Según formulación', 'Bacillus cereus', 920],
  ['bacterial-formulation-bacillus-thuringiensis', 'Formulación bacteriana de Bacillus thuringiensis', 'Producción, estandarización y formulación de Bacillus thuringiensis con control de calidad microbiológico. No incluye aplicación en campo.', 'Según formulación', 'Bacillus thuringiensis', 930],
  ['bacterial-formulation-bacillus-megaterium', 'Formulación bacteriana de Bacillus megaterium', 'Producción de biomasa y formulación de Bacillus megaterium, con control de concentración, pureza y acondicionamiento final. No incluye aplicación en campo.', 'Según formulación', 'Bacillus megaterium', 940],
  ['bacterial-formulation-bacillus-amyloliquefaciens', 'Formulación bacteriana de Bacillus amyloliquefaciens', 'Producción y formulación de Bacillus amyloliquefaciens con estandarización microbiológica y liberación del formulado. No incluye aplicación en campo.', 'Según formulación', 'Bacillus amyloliquefaciens', 950],
  ['bacterial-formulation-bacillus-velezensis', 'Formulación bacteriana de Bacillus velezensis', 'Producción y formulación de Bacillus velezensis con control de pureza, viabilidad y concentración. No incluye aplicación en campo.', 'Según formulación', 'Bacillus velezensis', 960],
  ['bacterial-formulation-pseudomonas-putida', 'Formulación bacteriana de Pseudomonas putida', 'Producción, estandarización y formulación de Pseudomonas putida con control de calidad y acondicionamiento final. No incluye aplicación en campo.', 'Según formulación', 'Pseudomonas putida', 970],
  ['bacterial-formulation-pseudomonas-fluorescens', 'Formulación bacteriana de Pseudomonas fluorescens', 'Producción, estandarización y formulación de Pseudomonas fluorescens con control microbiológico. No incluye aplicación en campo.', 'Según formulación', 'Pseudomonas fluorescens', 980],
  ['bacterial-formulation-azotobacter-chroococcum', 'Formulación bacteriana de Azotobacter chroococcum', 'Producción y formulación de Azotobacter chroococcum con control de concentración, pureza y viabilidad. No incluye aplicación en campo.', 'Según formulación', 'Azotobacter chroococcum', 990],
  ['bacterial-formulation-azospirillum-brasilense', 'Formulación bacteriana de Azospirillum brasilense', 'Producción y formulación de Azospirillum brasilense con estandarización y control microbiológico. No incluye aplicación en campo.', 'Según formulación', 'Azospirillum brasilense', 1000],
  ['bacterial-formulation-consortium', 'Formulación de consorcio bacteriano', 'Desarrollo de una formulación con dos o más cepas compatibles, incluyendo producción, estandarización, control de calidad y acondicionamiento. No incluye aplicación en campo.', 'Según alcance', 'Consorcios bacterianos compatibles', 1010],
  ['bacterial-formulation-custom', 'Formulación bacteriana personalizada', 'Formulación de una especie o cepa bacteriana definida en la cotización, con alcance, concentración y presentación acordados. No incluye aplicación en campo.', 'Según alcance', 'Cepas bacterianas compatibles con el alcance', 1020],
]

for (const [id, name, description, duration, matrix, sortOrder] of services) {
  await sql.query(
    `INSERT INTO service_catalog
     (id,category_id,category_name,name,description,estimated_duration,icon,group_name,matrix_scope,sort_order,active)
     VALUES ($1,'research','Investigación y desarrollo',$2,$3,$4,'🧫','Formulación bacteriana',$5,$6,true)
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
       active=true,
       updated_at=NOW()`,
    [id, name, description, duration, matrix, sortOrder],
  )
}

const saved = await sql.query(
  `SELECT id,name,group_name,active FROM service_catalog
   WHERE id = ANY($1::text[])
   ORDER BY sort_order`,
  [services.map(([id]) => id)],
)

console.log(JSON.stringify(saved, null, 2))
