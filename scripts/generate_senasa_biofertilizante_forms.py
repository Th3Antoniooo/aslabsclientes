from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white, black

OUT = Path("output/pdf/Kit_formatos_registro_biofertilizante_SENASA.pdf")
OUT.parent.mkdir(parents=True, exist_ok=True)
W, H = A4
M = 24
GREEN = HexColor("#0B5A3C")
PALE = HexColor("#EAF3EE")
GRAY = HexColor("#E5E9E6")
LIGHT = HexColor("#F8F9F8")
MID = HexColor("#65736C")
ORANGE = HexColor("#D88922")


class PDFKit:
    def __init__(self):
        self.c = canvas.Canvas(str(OUT), pagesize=A4)
        self.form = self.c.acroForm
        self.page = 0
        self.seq = 0

    def fname(self, label):
        self.seq += 1
        s = "".join(ch if ch.isalnum() else "_" for ch in label.lower())[:36]
        return f"p{self.page:02d}_{self.seq:04d}_{s}"

    def wrap(self, text, x, y, width, size=6.4, lead=7.4, bold=False, color=black):
        font = "Helvetica-Bold" if bold else "Helvetica"
        self.c.setFont(font, size)
        self.c.setFillColor(color)
        words, lines, line = text.split(), [], ""
        for word in words:
            test = (line + " " + word).strip()
            if self.c.stringWidth(test, font, size) <= width:
                line = test
            else:
                if line:
                    lines.append(line)
                line = word
        if line:
            lines.append(line)
        for i, ln in enumerate(lines):
            self.c.drawString(x, y-i*lead, ln)
        return y-len(lines)*lead

    def page_header(self, code, title):
        self.page += 1
        self.c.setFillColor(GREEN)
        self.c.roundRect(M, H-66, W-2*M, 42, 8, fill=1, stroke=0)
        self.c.setFillColor(white)
        self.c.setFont("Helvetica-Bold", 12.2)
        self.c.drawString(M+12, H-43, title)
        self.c.setFont("Helvetica-Bold", 6.4)
        self.c.drawRightString(W-M-12, H-43, code)
        self.c.setFillColor(MID)
        self.c.setFont("Helvetica", 6.2)
        self.c.drawString(M, H-77, "EXPEDIENTE PREPARATORIO - BIOFERTILIZANTE MICROBIANO")
        self.c.drawRightString(W-M, H-77, f"Pagina {self.page}")
        return H-91

    def footer(self):
        self.c.setStrokeColor(GRAY)
        self.c.line(M, 25, W-M, 25)
        self.c.setFillColor(MID)
        self.c.setFont("Helvetica", 5.4)
        self.c.drawString(M, 15, "AS LABORATORIOS CONTROL BIOLOGICO S.A.C. | RUC 20440181792 | Trujillo, La Libertad")
        self.c.drawRightString(W-M, 15, "Validar requisitos, tasa y canal vigentes con SENASA")

    def finish_page(self):
        self.footer()
        self.c.showPage()

    def section(self, y, title):
        self.c.setFillColor(GRAY)
        self.c.roundRect(M, y-17, W-2*M, 17, 3, fill=1, stroke=0)
        self.c.setFillColor(GREEN)
        self.c.setFont("Helvetica-Bold", 6.9)
        self.c.drawString(M+7, y-12, title.upper())
        return y-22

    def field(self, x, y, w, h, label, value="", multiline=False, required=False, size=7):
        self.c.setFillColor(white)
        self.c.setStrokeColor(HexColor("#ADB9B2"))
        self.c.roundRect(x, y, w, h, 2.5, fill=1, stroke=1)
        self.form.textfield(
            name=self.fname(label), x=x+2, y=y+2, width=w-4, height=h-4,
            value=value, fontName="Helvetica", fontSize=size,
            textColor=black, fillColor=white, borderColor=white, borderWidth=0,
            fieldFlags=4096 if multiline else 0, forceBorder=False,
        )
        if required:
            self.c.setFillColor(HexColor("#B22D2D"))
            self.c.setFont("Helvetica-Bold", 6)
            self.c.drawRightString(x+w-3, y+h-7, "*")

    def labeled(self, x, y, w, label, value="", required=False, h=16):
        self.c.setFillColor(HexColor("#24362D"))
        self.c.setFont("Helvetica-Bold", 5.8)
        self.c.drawString(x, y+h+3, label)
        self.field(x, y, w, h, label, value, h > 24, required, 6.7)

    def check(self, x, y, label):
        self.form.checkbox(name=self.fname(label), x=x, y=y, size=8.5,
                           buttonStyle="check", borderWidth=0.7,
                           borderColor=GREEN, fillColor=white, textColor=GREEN,
                           forceBorder=True)
        self.c.setFillColor(black)
        self.c.setFont("Helvetica", 6.1)
        self.c.drawString(x+12, y+1.5, label)

    def note(self, y, text, h=38):
        self.c.setFillColor(HexColor("#FFF7E8"))
        self.c.setStrokeColor(ORANGE)
        self.c.roundRect(M, y-h, W-2*M, h, 5, fill=1, stroke=1)
        self.c.setFillColor(ORANGE)
        self.c.setFont("Helvetica-Bold", 6.8)
        self.c.drawString(M+8, y-11, "IMPORTANTE")
        self.wrap(text, M+68, y-10, W-2*M-78, 6.0, 7, color=HexColor("#4D514F"))
        return y-h-6

    def table(self, y, headers, widths, rows, prefix, row_h=24):
        x = M
        self.c.setFillColor(GREEN)
        self.c.roundRect(M, y-16, sum(widths), 16, 3, fill=1, stroke=0)
        for head, w in zip(headers, widths):
            self.wrap(head, x+3, y-10, w-6, 5.4, 5.8, True, white)
            x += w
        y -= 16
        for r in range(rows):
            x = M
            fill = white if r % 2 == 0 else LIGHT
            for j, w in enumerate(widths):
                self.c.setFillColor(fill)
                self.c.setStrokeColor(HexColor("#CBD3CE"))
                self.c.rect(x, y-row_h, w, row_h, fill=1, stroke=1)
                self.form.textfield(name=self.fname(f"{prefix}_{r}_{j}"),
                    x=x+2, y=y-row_h+2, width=w-4, height=row_h-4,
                    fontName="Helvetica", fontSize=5.9, textColor=black,
                    fillColor=fill, borderColor=fill, borderWidth=0,
                    fieldFlags=4096 if row_h >= 28 else 0, forceBorder=False)
                x += w
            y -= row_h
        return y-5

    def two_col_fields(self, y, labels, start=0, h=16):
        for i, label in enumerate(labels):
            col, row = i % 2, i // 2
            x = M + col*270
            yy = y - 20 - row*35
            self.labeled(x, yy, 258, label, h=h)
        return y - ((len(labels)+1)//2)*35 - 5


k = PDFKit()

# 00 - Portada y control
y = k.page_header("FR-SEN-BIO-00", "KIT DE FORMATOS PARA REGISTRO DE BIOFERTILIZANTE")
k.c.setFillColor(PALE)
k.c.roundRect(M, y-77, W-2*M, 70, 7, fill=1, stroke=0)
k.c.setFillColor(GREEN)
k.c.setFont("Helvetica-Bold", 15)
k.c.drawString(M+14, y-31, "Expediente tecnico preparatorio")
k.c.setFont("Helvetica", 7.8)
k.c.setFillColor(HexColor("#3F5148"))
k.c.drawString(M+14, y-48, "Biofertilizantes de origen microbiano - Peru")
k.c.drawString(M+14, y-62, "Formato compacto, imprimible y rellenable digitalmente")
y -= 88
y = k.note(y, "Este kit se alinea con la estructura tecnica mas reciente publicada por SENASA para el proyecto de Reglamento de Fertilizantes y Sustancias Afines. No reemplaza el formulario oficial ni confirma que el proyecto sea norma vigente. Antes de presentar, validar procedimiento, tasa, requisitos y canal con SENASA/VUCE.", 44)
y = k.section(y, "Control maestro")
k.labeled(M, y-20, 270, "Nombre comercial del producto", required=True)
k.labeled(M+282, y-20, 250, "Codigo interno / version")
y -= 43
k.labeled(M, y-20, 130, "Fecha de apertura")
k.labeled(M+142, y-20, 128, "Fecha objetivo")
k.labeled(M+282, y-20, 135, "Responsable regulatorio")
k.labeled(M+429, y-20, 103, "Telefono / correo")
y -= 48
y = k.section(y, "Estado documental")
docs = ["Solicitud", "Certificado de analisis", "Certificado de composicion", "Caracterizacion microbiana",
        "Eficacia agronomica", "Propiedades fisicoquimicas", "Uso y dosis", "Estabilidad / vida util",
        "Proyecto de etiqueta", "Ficha tecnica", "Hoja de seguridad", "Envases y embalajes",
        "Suministro de cepa", "Pago / tasa validada"]
for i, d in enumerate(docs):
    k.check(M+8+(i%2)*270, y-17-(i//2)*19, d)
y -= 151
y = k.section(y, "Solicitante")
k.labeled(M, y-20, 315, "Razon social", "AS LABORATORIOS CONTROL BIOLOGICO S.A.C.")
k.labeled(M+327, y-20, 100, "RUC", "20440181792")
k.labeled(M+439, y-20, 93, "Pais", "PERU")
y -= 43
k.labeled(M, y-20, 315, "Domicilio", "Jr. Huancavelica 315, 2do Piso, Trujillo")
k.labeled(M+327, y-20, 130, "Correo", "ventas@aslaboratorios.com")
k.labeled(M+469, y-20, 63, "Telefono", "+51 961 996 645")
y -= 48
y = k.section(y, "Resultado de revision interna")
k.labeled(M, y-68, 532, "Observaciones generales y faltantes", h=64)
k.finish_page()

# 01 - Solicitud
y = k.page_header("FR-SEN-BIO-01", "SOLICITUD Y DATOS ADMINISTRATIVOS")
y = k.section(y, "1. Solicitante")
k.labeled(M, y-20, 310, "Persona natural / razon social", "AS LABORATORIOS CONTROL BIOLOGICO S.A.C.", True)
k.labeled(M+322, y-20, 105, "RUC", "20440181792", True)
k.labeled(M+439, y-20, 93, "Pais", "PERU")
y -= 43
k.labeled(M, y-20, 350, "Domicilio legal", "Jr. Huancavelica 315, 2do Piso, Trujillo", True)
k.labeled(M+362, y-20, 170, "Distrito / provincia / departamento", "Trujillo / Trujillo / La Libertad")
y -= 43
k.labeled(M, y-20, 180, "Representante legal", required=True)
k.labeled(M+192, y-20, 105, "DNI / CE")
k.labeled(M+309, y-20, 105, "Telefono")
k.labeled(M+426, y-20, 106, "Correo")
y -= 48
y = k.section(y, "2. Fabricante y formulador")
k.labeled(M, y-20, 260, "Fabricante / productor", required=True)
k.labeled(M+272, y-20, 260, "Formulador (si difiere)")
y -= 43
k.labeled(M, y-20, 260, "Direccion de planta", required=True)
k.labeled(M+272, y-20, 125, "Pais de origen", required=True)
k.labeled(M+409, y-20, 123, "RUC / identificacion")
y -= 48
y = k.section(y, "3. Producto y tramite")
k.labeled(M, y-20, 220, "Nombre comercial", required=True)
k.labeled(M+232, y-20, 168, "Nombre generico", "Biofertilizante microbiano")
k.labeled(M+412, y-20, 120, "Presentacion")
y -= 43
for i, opt in enumerate(["Descomponedor", "Fijador de N", "Solubilizador", "Micorrizico", "Consorcio", "Otro"]):
    k.check(M+5+i*88, y-14, opt)
y -= 36
k.labeled(M, y-20, 175, "N. comprobante / pago")
k.labeled(M+187, y-20, 115, "Fecha de pago")
k.labeled(M+314, y-20, 218, "Procedimiento / codigo VUCE validado")
y -= 48
y = k.section(y, "4. Declaracion")
k.field(M, y-62, 532, 58, "declaracion", "Declaro que la informacion y anexos son veraces, corresponden al producto descrito y se encuentran vigentes. Me comprometo a comunicar cualquier cambio de composicion, fabricante, proceso, uso, etiqueta o condiciones de calidad.", True, False, 6.4)
y -= 73
k.labeled(M, y-20, 200, "Nombre y cargo del firmante", required=True)
k.labeled(M+212, y-20, 100, "DNI / CE")
k.labeled(M+324, y-20, 95, "Fecha")
k.labeled(M+431, y-20, 101, "Firma / sello")
k.finish_page()

# 02 - Identidad y composicion
y = k.page_header("FR-SEN-BIO-02", "IDENTIDAD, CLASIFICACION Y COMPOSICION")
y = k.section(y, "1. Identificacion del producto")
k.labeled(M, y-20, 230, "Nombre comercial", required=True)
k.labeled(M+242, y-20, 140, "Estado fisico")
k.labeled(M+394, y-20, 138, "Color / olor")
y -= 43
k.labeled(M, y-20, 180, "Funcion principal", required=True)
k.labeled(M+192, y-20, 340, "Accion declarada", required=True)
y -= 48
y = k.section(y, "2. Microorganismos declarados")
y = k.table(y, ["Nombre cientifico", "Familia / genero / especie", "Cepa", "Funcion", "Pureza", "CFU/g o mL"], [100, 105, 65, 95, 72, 95], 6, "micro", 27)
y = k.section(y, "3. Composicion cualitativa y cuantitativa")
y = k.table(y, ["Componente", "Funcion", "% m/m", "% m/v", "Especificacion", "Proveedor / lote"], [130, 90, 55, 55, 110, 92], 5, "comp", 24)
y = k.section(y, "4. Trazabilidad de cepas")
k.labeled(M, y-20, 175, "Origen / coleccion / depositario")
k.labeled(M+187, y-20, 155, "Certificado de suministro")
k.labeled(M+354, y-20, 178, "Fecha / vigencia")
y -= 43
k.labeled(M, y-20, 250, "Metodo de identificacion")
k.labeled(M+262, y-20, 270, "Documento / laboratorio")
k.finish_page()

# 03 - Analisis
y = k.page_header("FR-SEN-BIO-03", "CERTIFICADO DE ANALISIS Y CALIDAD MICROBIOLOGICA")
y = k.note(y, "Registrar valores unicos, unidades, metodos y limites. Segun la estructura publicada, los certificados de analisis y composicion no deberian superar dos anos de antiguedad.", 34)
y = k.section(y, "1. Lote analizado")
k.labeled(M, y-20, 175, "Producto / lote", required=True)
k.labeled(M+187, y-20, 105, "Fecha fabricacion")
k.labeled(M+304, y-20, 105, "Fecha analisis")
k.labeled(M+421, y-20, 111, "Laboratorio")
y -= 48
y = k.section(y, "2. Matriz de resultados")
y = k.table(y, ["Parametro", "Especificacion", "Resultado", "Unidad", "Metodo", "Conforme"], [132, 92, 78, 60, 120, 50], 13, "analisis", 24)
y = k.section(y, "3. Controles considerados")
checks = ["Viabilidad", "Recuento CFU", "E. coli: ausencia", "Salmonella: ausencia", "Coliformes <1000",
          "pH", "Metales pesados", "Esporas viables", "Pureza biologica", "Actividad hidrolitica",
          "% nodulacion", "Micorrizacion / propagulos"]
for i, d in enumerate(checks):
    k.check(M+8+(i%2)*270, y-17-(i//2)*18, d)
y -= 116
k.labeled(M, y-20, 260, "Responsable / firma")
k.labeled(M+272, y-20, 130, "N. certificado")
k.labeled(M+414, y-20, 118, "Fecha")
k.finish_page()

# 04 - Propiedades
y = k.page_header("FR-SEN-BIO-04", "PROPIEDADES FISICAS, QUIMICAS Y DE FORMULACION")
y = k.section(y, "1. Propiedades fisicoquimicas")
y = k.two_col_fields(y, ["Estado fisico", "Color", "Olor", "Solubilidad", "Humedad (solidos)", "Granulometria",
    "Conductividad / indice salino", "Higroscopicidad", "Punto fusion / ebullicion", "Tension superficial",
    "Fitotoxicidad", "Pureza", "Densidad y temperatura", "Estabilidad / vida util", "Inflamabilidad", "pH", "Explosividad", "Corrosividad"])
y = k.section(y, "2. Propiedades de formulacion - segun corresponda")
y = k.two_col_fields(y, ["Humectabilidad", "Persistencia de espuma", "Suspensibilidad", "Estabilidad de emulsion",
    "Compatibilidad / incompatibilidad", "Densidad a 20 C", "Viscosidad", "Indice de sulfonacion", "Dispersion", "Fluidez"])
k.labeled(M, y-40, 532, "Observaciones, metodo y respaldo", h=36)
k.finish_page()

# 05 - Uso
y = k.page_header("FR-SEN-BIO-05", "USO, APLICACION, DOSIS Y RECOMENDACIONES")
y = k.section(y, "1. Funcion y mecanismo")
k.labeled(M, y-56, 260, "Funcion / beneficio medible", h=52)
k.labeled(M+272, y-56, 260, "Modo de accion e interacciones con suelo", h=52)
y -= 69
y = k.section(y, "2. Recomendaciones por cultivo")
y = k.table(y, ["Cultivo", "Objetivo", "Dosis", "N. aplicaciones", "Momento", "Metodo"], [100, 108, 70, 70, 105, 79], 8, "dosis", 28)
y = k.section(y, "3. Condiciones e instrucciones")
for row, pair in enumerate([
    ("Forma y condiciones de aplicacion", "Preparacion, equipos y calibracion"),
    ("Condiciones ambientales / restricciones", "Compatibilidades e incompatibilidades"),
    ("Fitotoxicidad y reduccion de riesgos", "Buenas practicas de manejo de suelo"),
]):
    yy = y-49-row*57
    k.labeled(M, yy, 260, pair[0], h=43)
    k.labeled(M+272, yy, 260, pair[1], h=43)
k.finish_page()

# 06 - Proceso
y = k.page_header("FR-SEN-BIO-06", "PROCESO DE FABRICACION Y CONTROL DE LOTES")
y = k.note(y, "Describir el proceso real y adjuntar diagrama de flujo, formula maestra, registros de lote y criterios de liberacion.", 30)
y = k.section(y, "1. Flujo de fabricacion")
y = k.table(y, ["Etapa", "Descripcion / insumos", "Equipo", "Parametro critico", "Criterio", "Registro"], [55, 135, 72, 88, 105, 77], 11, "proceso", 31)
y = k.section(y, "2. Liberacion del lote")
k.labeled(M, y-20, 175, "Codigo de lote", required=True)
k.labeled(M+187, y-20, 105, "Tamano")
k.labeled(M+304, y-20, 105, "Fabricacion")
k.labeled(M+421, y-20, 111, "Liberacion")
y -= 43
k.labeled(M, y-20, 260, "Responsable de produccion")
k.labeled(M+272, y-20, 260, "Responsable de calidad")
y -= 42
for i, d in enumerate(["Conforme", "No conforme", "Liberacion condicionada"]):
    k.check(M+8+i*115, y-12, d)
k.labeled(M+390, y-20, 142, "N. acta / informe")
k.finish_page()

# 07 - Estabilidad
y = k.page_header("FR-SEN-BIO-07", "ESTABILIDAD, VIABILIDAD Y VIDA UTIL")
y = k.section(y, "1. Diseno del estudio")
k.labeled(M, y-20, 170, "Producto / lote", required=True)
k.labeled(M+182, y-20, 120, "Envase")
k.labeled(M+314, y-20, 105, "Fecha inicio")
k.labeled(M+431, y-20, 101, "Vida util propuesta")
y -= 43
k.labeled(M, y-20, 260, "Condicion de almacenamiento", required=True)
k.labeled(M+272, y-20, 260, "Frecuencia de evaluacion")
y -= 48
y = k.section(y, "2. Resultados por periodo")
y = k.table(y, ["Tiempo", "Temp./HR", "CFU/g o mL", "Viabilidad", "pH", "Apariencia", "Contaminantes", "Conforme"], [52, 68, 78, 68, 45, 76, 93, 52], 10, "estabilidad", 29)
y = k.section(y, "3. Conclusion")
k.labeled(M, y-56, 350, "Criterio de vida util y tendencia", h=52)
k.labeled(M+362, y-20, 170, "Vida util confirmada")
k.labeled(M+362, y-48, 170, "Conservacion")
y -= 69
k.labeled(M, y-20, 260, "Responsable / laboratorio")
k.labeled(M+272, y-20, 130, "N. informe")
k.labeled(M+414, y-20, 118, "Fecha")
k.finish_page()

# 08 - Eficacia
y = k.page_header("FR-SEN-BIO-08", "PROTOCOLO E INFORME DE EFICACIA AGRONOMICA")
y = k.note(y, "La estructura publicada propone protocolo aprobado, evaluacion en al menos dos zonas agroecologicas y analisis estadistico. Confirmar con SENASA antes de iniciar ensayos regulatorios.", 38)
y = k.section(y, "1. Objetivo y diseno")
k.labeled(M, y-20, 330, "Objetivo / accion a demostrar", required=True)
k.labeled(M+342, y-20, 190, "Cultivo / variedad", required=True)
y -= 43
k.labeled(M, y-20, 260, "Variable principal")
k.labeled(M+272, y-20, 130, "Diseno estadistico")
k.labeled(M+414, y-20, 118, "Repeticiones")
y -= 48
y = k.section(y, "2. Tratamientos")
y = k.table(y, ["Tratamiento", "Producto / control", "Dosis", "Frecuencia", "Momento", "Unidades"], [75, 135, 70, 80, 95, 77], 7, "tratamientos", 26)
y = k.section(y, "3. Sitios de ensayo")
y = k.table(y, ["Zona", "Ubicacion / coordenadas", "Suelo / clima", "Fecha", "Responsable"], [108, 135, 105, 82, 102], 3, "sitios", 28)
y = k.section(y, "4. Variables y resultados")
y = k.table(y, ["Variable", "Metodo / unidad", "Momento", "Resultado", "Estadistica", "Conclusion"], [95, 105, 75, 105, 72, 80], 5, "eficacia", 26)
k.labeled(M, y-20, 260, "N. protocolo / aprobacion")
k.labeled(M+272, y-20, 260, "N. informe / entidad")
k.finish_page()

# 09 - Envase y etiqueta
y = k.page_header("FR-SEN-BIO-09", "ENVASE, EMBALAJE, ETIQUETA Y SEGURIDAD")
y = k.section(y, "1. Envase primario")
y = k.table(y, ["Tipo", "Material", "Capacidad", "Cierre", "Resistencia / compatibilidad", "Descontaminacion"], [70, 75, 65, 65, 135, 122], 4, "envase", 25)
y = k.section(y, "2. Embalaje externo")
y = k.table(y, ["Tipo", "Material", "Capacidad", "Resistencia", "Rotulado"], [85, 95, 75, 125, 152], 3, "embalaje", 25)
y = k.section(y, "3. Contenido del proyecto de etiqueta")
items = ["Nombre comercial", "Clasificacion / funcion", "Composicion y concentracion", "Microorganismos y cepas",
         "Cultivos y dosis", "Modo de uso", "Precauciones", "Compatibilidades", "Almacenamiento", "Vida util",
         "Lote y fechas", "Fabricante / formulador", "Titular", "Contenido neto", "Pais de origen", "GHS si aplica",
         "Manejo de envase", "Ficha tecnica", "SDS en espanol", "Contacto"]
for i, d in enumerate(items):
    k.check(M+8+(i%2)*270, y-17-(i//2)*19, d)
y -= 202
y = k.section(y, "4. Seguridad")
k.labeled(M, y-20, 230, "Clasificacion de peligros / GHS")
k.labeled(M+242, y-20, 140, "Version SDS")
k.labeled(M+394, y-20, 138, "Fecha SDS")
y -= 43
k.labeled(M, y-45, 532, "Primeros auxilios, derrames, almacenamiento y disposicion", h=41)
k.finish_page()

# 10 - Anexo microorganismos
y = k.page_header("FR-SEN-BIO-10", "ANEXO ESPECIFICO DE MICROORGANISMOS")
y = k.section(y, "1. Inoculantes y transformadores")
y = k.table(y, ["Microorganismo / cepa", "Medio", "Conteo 72 h / 37 C", "Viabilidad", "Estabilidad"], [115, 105, 110, 80, 122], 5, "inoculante", 28)
y = k.section(y, "2. Actividad enzimatica - si transforma materia organica")
y = k.table(y, ["Actividad", "Metodo", "Resultado", "Unidad", "Especificacion", "Documento"], [95, 110, 80, 60, 100, 87], 4, "enzimas", 25)
y = k.section(y, "3. Micorrizas - si corresponde")
y = k.table(y, ["Parametro", "Resultado", "Unidad", "Metodo", "Especificacion"], [170, 80, 75, 110, 97], 4, "micorriza", 25)
k.wrap("Sugeridos: esporas o propagulos viables; % micorrizacion radicular; micelio externo; NMP de propagulos infectivos.", M+4, y+5, 520, 5.5, 6.2, color=MID)
y -= 13
y = k.section(y, "4. Nodulacion - si corresponde")
k.labeled(M, y-20, 170, "% plantas noduladas")
k.labeled(M+182, y-20, 170, "Metodo / cultivo indicador")
k.labeled(M+364, y-20, 168, "Informe / laboratorio")
y -= 48
y = k.section(y, "5. Incompatibilidades y bioseguridad")
k.labeled(M, y-56, 260, "Incompatibilidades", h=52)
k.labeled(M+272, y-56, 260, "Riesgos y controles de bioseguridad", h=52)
k.finish_page()

# 11 - Checklist final
y = k.page_header("FR-SEN-BIO-11", "LISTA FINAL DE VERIFICACION Y ENTREGA")
y = k.section(y, "1. Matriz de anexos")
y = k.table(y, ["N.", "Documento / anexo", "Codigo / version", "Fecha", "Vigente", "Firmado", "Archivo"], [28, 190, 92, 60, 48, 48, 66], 12, "anexos", 19)
y = k.section(y, "2. Validaciones previas")
vals = ["Categoria confirmada", "Procedimiento VUCE confirmado", "Tasa vigente", "Nombre comercial verificado",
        "Formula consistente", "Certificados con valores unicos", "Cepas coinciden con etiqueta", "Metodos homologados",
        "Certificados vigentes", "Eficacia respalda declaraciones", "Vida util sustentada", "Etiqueta coincide con usos",
        "SDS revisada", "Archivos firmados y legibles"]
for i, d in enumerate(vals):
    k.check(M+8+(i%2)*270, y-17-(i//2)*19, d)
y -= 151
y = k.section(y, "3. Presentacion")
k.labeled(M, y-20, 170, "Canal / VUCE")
k.labeled(M+182, y-20, 170, "N. expediente")
k.labeled(M+364, y-20, 168, "Fecha de ingreso")
y -= 43
k.labeled(M, y-20, 260, "Responsable")
k.labeled(M+272, y-20, 120, "N. folios / archivos")
k.labeled(M+404, y-20, 128, "Constancia")
y -= 48
y = k.section(y, "4. Observaciones / subsanaciones")
k.labeled(M, y-98, 532, "Observaciones de SENASA y control de respuesta", h=94)
y -= 111
k.labeled(M, y-20, 170, "Fecha de requerimiento")
k.labeled(M+182, y-20, 170, "Plazo")
k.labeled(M+364, y-20, 168, "Fecha de respuesta")
k.footer()
k.c.save()
print(OUT.resolve())
