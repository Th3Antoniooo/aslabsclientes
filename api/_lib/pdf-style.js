import fs from 'node:fs'

const FONT_URLS = {
  Arial: new URL('../assets/fonts/Arial.ttf', import.meta.url),
  'Arial-Bold': new URL('../assets/fonts/Arial-Bold.ttf', import.meta.url),
  'Arial-Italic': new URL('../assets/fonts/Arial-Italic.ttf', import.meta.url),
  'Arial-BoldItalic': new URL('../assets/fonts/Arial-BoldItalic.ttf', import.meta.url),
}

const SIGNATURE_URLS = {
  renzo: new URL('../assets/signatures/renzo.png', import.meta.url),
  antonio: new URL('../assets/signatures/antonio.png', import.meta.url),
  nancy: new URL('../assets/signatures/nancy.png', import.meta.url),
  natasha: new URL('../assets/signatures/natasha.png', import.meta.url),
  luis: new URL('../assets/signatures/luis.png', import.meta.url),
}

const fonts = Object.fromEntries(Object.entries(FONT_URLS).map(([name,url]) => [name,fs.readFileSync(url)]))
const signatures = Object.fromEntries(Object.entries(SIGNATURE_URLS).map(([name,url]) => [name,fs.readFileSync(url)]))

export function setupPdfStyle(doc) {
  for (const [name,buffer] of Object.entries(fonts)) doc.registerFont(name,buffer)
  const setFontSize = doc.fontSize.bind(doc)
  doc.fontSize = () => setFontSize(8)
  doc.font('Arial').fontSize(8)
  return doc
}

export function signatureForName(name) {
  const value = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  if (value.includes('natasha') || value.includes('escobar arana')) return signatures.natasha
  if (value.includes('antonio') || value.includes('guevara escobar')) return signatures.antonio
  if (value.includes('nancy') || value.includes('mejia ruedell')) return signatures.nancy
  if (value.includes('renzo')) return signatures.renzo
  if (value.includes('luis') || value.includes('guevara cabrera')) return signatures.luis
  return null
}

export function natashaSignature() { return signatures.natasha }

export function signatureBuffer(dataUrl) {
  if (!dataUrl || !/^data:image\/(?:png|jpe?g|webp);base64,/i.test(String(dataUrl))) return null
  try {
    const buffer = Buffer.from(String(dataUrl).split(',')[1] || '', 'base64')
    return buffer.length ? buffer : null
  } catch {
    return null
  }
}

export function officialSignatureItems() {
  return [
    { name: 'Antonio Guevara Escobar', role: 'Administrador', image: signatures.antonio },
    { name: 'Blga. Natasha Escobar Arana', role: 'Gerente General', credential: 'CBP: 3102', image: signatures.natasha },
    { name: 'Ing. Luis Guevara Cabrera', role: 'Asistente de Gerencia', credential: 'CIP: 339730', image: signatures.luis },
  ]
}

export function drawSignatureGrid(doc,{
  y,
  signers=[],
  includeOfficials=true,
  left=46,
  width=503,
  line='#d7ded9',
  ink='#17221b',
  muted='#66756c',
  pageBottom=782,
  heading='Firmas',
}) {
  const items = [
    ...(includeOfficials ? officialSignatureItems() : []),
    ...signers.map((signer) => ({
      ...signer,
      image: signer.image || signatureBuffer(signer.dataUrl) || signatureForName(signer.name),
    })),
  ].filter((item) => item.name)
  if (!items.length) return y
  const gap=8, columns=Math.min(3,items.length), boxW=(width-gap*(columns-1))/columns, boxH=78
  const headingH=heading ? 18 : 0
  const rows=Math.ceil(items.length/columns)
  const needed=headingH+rows*(boxH+gap)-gap
  if (y + needed > pageBottom) { doc.addPage(); y = 42 }
  if (heading) {
    doc.fillColor(ink).font('Arial-Bold').fontSize(8).text(heading.toUpperCase(),left,y,{width,align:'left'})
    doc.moveTo(left,y+12).lineTo(left+width,y+12).strokeColor(line).lineWidth(.7).stroke()
    y += headingH
  }
  items.forEach((item,index) => {
    const row=Math.floor(index/columns), column=index%columns
    const x=left+column*(boxW+gap), top=y+row*(boxH+gap)
    doc.roundedRect(x,top,boxW,boxH,8).fill('#ffffff').strokeColor(line).lineWidth(.8).stroke()
    if (item.image) doc.image(item.image,x+12,top+3,{fit:[boxW-24,31],align:'center',valign:'center'})
    else doc.fillColor(muted).font('Arial-Italic').fontSize(8).text('Firma no consignada',x+10,top+14,{width:boxW-20,align:'center'})
    doc.moveTo(x+14,top+36).lineTo(x+boxW-14,top+36).strokeColor(line).lineWidth(.55).stroke()
    doc.fillColor(ink).font('Arial-Bold').fontSize(8).text(item.name,x+7,top+41,{width:boxW-14,align:'center',height:11,ellipsis:true})
    doc.fillColor(muted).font('Arial').fontSize(8).text(item.role || 'Responsable',x+7,top+54,{width:boxW-14,align:'center',height:10,ellipsis:true})
    if (item.credential) doc.fillColor(ink).font('Arial-Bold').fontSize(8).text(item.credential,x+7,top+66,{width:boxW-14,align:'center',height:9,ellipsis:true})
  })
  return y+rows*(boxH+gap)-gap
}

export function drawOfficialSignatures(doc,{ y, signerName, signerRole='Responsable del registro', left=46, width=503, line='#d7ded9', ink='#17221b', muted='#66756c', pageBottom=782 }) {
  const signers = signerName
    ? [{ name: signerName, role: signerRole, image: signatureForName(signerName) }]
    : []
  return drawSignatureGrid(doc,{ y, signers, includeOfficials:true, left, width, line, ink, muted, pageBottom, heading:'Firmas' })
}
