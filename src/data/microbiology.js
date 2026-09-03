export const MICROBIOLOGY_ANALYSES = [
  { code: 'coliformes-totales', name: 'Recuento de coliformes totales', keywords: ['coliformes totales'] },
  { code: 'coliformes-termotolerantes', name: 'Recuento de coliformes termotolerantes', keywords: ['termotolerantes', 'fecales'] },
  { code: 'bacterias-heterotrofas', name: 'Recuento de bacterias heterótrofas', keywords: ['heterótrof', 'heterotrof'] },
  { code: 'aerobios-mesofilos', name: 'Recuento de aerobios mesófilos', keywords: ['aerobios mesófilos', 'aerobios mesofilos'] },
  { code: 'escherichia-coli', name: 'Detección y recuento de Escherichia coli', keywords: ['escherichia', 'e. coli', 'e coli'] },
  { code: 'enterobacterias', name: 'Recuento de enterobacterias', keywords: ['enterobacter'] },
  { code: 'pseudomonas', name: 'Recuento de Pseudomonas spp.', keywords: ['pseudomonas'] },
  { code: 'staphylococcus-aureus', name: 'Recuento de Staphylococcus aureus', keywords: ['staphylococcus', 'estafilococ'] },
  { code: 'mohos-levaduras', name: 'Recuento de mohos y levaduras', keywords: ['mohos', 'levaduras'] },
  { code: 'listeria-spp', name: 'Detección de Listeria spp.', keywords: ['listeria spp'] },
  { code: 'listeria-monocytogenes', name: 'Detección de Listeria monocytogenes', keywords: ['listeria monocytogenes'] },
  { code: 'salmonella', name: 'Detección de Salmonella spp.', keywords: ['salmonella'] },
  { code: 'bacillus-cereus', name: 'Recuento de Bacillus cereus', keywords: ['bacillus cereus'] },
  { code: 'clostridium-perfringens', name: 'Recuento de Clostridium perfringens', keywords: ['clostridium perfringens', 'sulfito reductores'] },
  { code: 'enterococos', name: 'Recuento de enterococos', keywords: ['enterococos', 'enterococcus'] },
  { code: 'vibrio', name: 'Detección de Vibrio spp.', keywords: ['vibrio'] },
  { code: 'bacterias-acido-lacticas', name: 'Recuento de bacterias ácido-lácticas', keywords: ['ácido-lácticas', 'acido-lacticas'] },
  { code: 'bacillus-spp', name: 'Recuento de Bacillus spp.', keywords: ['bacillus spp'] },
  { code: 'azotobacter', name: 'Recuento de Azotobacter spp.', keywords: ['azotobacter'] },
  { code: 'solubilizadores-fosforo', name: 'Microorganismos solubilizadores de fósforo', keywords: ['solubilizadores de fósforo', 'solubilizadores de fosforo'] },
  { code: 'suspension-microbiana', name: 'Concentración de suspensión microbiana', keywords: ['suspensión microbiana', 'suspension microbiana'] },
  { code: 'esterilidad', name: 'Prueba de esterilidad', keywords: ['esterilidad'] },
  { code: 'pureza-cultivo', name: 'Control de pureza de cultivo', keywords: ['pureza de cultivo'] },
  { code: 'personalizado', name: 'Recuento microbiológico personalizado', keywords: ['microbiología', 'microbiologico', 'microbiológico'] },
]

export const MICROBIOLOGY_STEPS = [
  { key: 'autoclave', position: 0, title: 'Autoclavado y liberación', documentCode: 'FO-MIC-01' },
  { key: 'plating', position: 1, title: 'Servido e inoculación', documentCode: 'FO-MIC-02' },
  { key: 'incubation', position: 2, title: 'Incubación', documentCode: 'FO-MIC-03' },
  { key: 'reading', position: 3, title: 'Lectura e interpretación', documentCode: 'FO-MIC-04' },
  { key: 'report', position: 4, title: 'Emisión del informe', documentCode: 'FO-MIC-05' },
]

export function suggestedMicrobiologyAnalyses(serviceItems = []) {
  const text = serviceItems.map((item) => item.name || item.service_name || '').join(' ').toLowerCase()
  const matches = MICROBIOLOGY_ANALYSES.filter((analysis) => analysis.keywords.some((keyword) => text.includes(keyword)))
  return matches.length ? matches.map((analysis) => analysis.code) : []
}
