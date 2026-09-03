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
  return null
}

export function natashaSignature() { return signatures.natasha }

export function drawOfficialSignatures(doc,{ y, signerName, signerRole='Responsable del registro', left=46, width=503, line='#d7ded9', ink='#17221b', muted='#66756c' }) {
  if (y + 76 > 782) { doc.addPage(); y = 42 }
  const gap=9, boxW=(width-gap)/2, boxH=72
  const boxes=[
    { x:left,name:signerName || 'Responsable no consignado',role:signerRole,image:signatureForName(signerName) },
    { x:left+boxW+gap,name:'Natasha Escobar Arana',role:'Gerente General',image:signatures.natasha },
  ]
  for (const box of boxes) {
    doc.roundedRect(box.x,y,boxW,boxH,8).fill('#ffffff').strokeColor(line).lineWidth(.8).stroke()
    if (box.image) doc.image(box.image,box.x+15,y+3,{fit:[boxW-30,34],align:'center',valign:'center'})
    else doc.fillColor(muted).font('Arial-Italic').fontSize(8).text('Firma no consignada',box.x+12,y+14,{width:boxW-24,align:'center'})
    doc.fillColor(ink).font('Arial-Bold').fontSize(8).text(box.name,box.x+9,y+40,{width:boxW-18,align:'center',height:12,ellipsis:true})
    doc.fillColor(muted).font('Arial').fontSize(8).text(box.role,box.x+9,y+55,{width:boxW-18,align:'center',height:12,ellipsis:true})
  }
  return y+boxH
}
