# AS Laboratorios · Panel de Cliente

Panel front-end (React + Vite) para clientes de análisis agroindustriales:
suelo, agua, alimentos, detección de fitopatógenos, foliar y microbiología.

Estética **futurista, verde neón y minimalista**, con objeto 3D (Three.js),
difuminados, glassmorphism y animaciones.

## Funcionalidades

- **Panel**: hero 3D interactivo, KPIs, órdenes en progreso con barras animadas y tendencia de pH.
- **Órdenes**: listado con filtros, estado en tiempo real, y modal de seguimiento (timeline).
- **Nueva orden**: wizard de 4 pasos (tipo → zona → detalles → confirmación).
- **Zonas de campo**: mapa satelital real (Leaflet + Esri). Dibuja polígonos haciendo clic,
  con coordenadas reales; cada zona muestra cultivo, área y vértices.
- **Analíticas**: gráficas (barras, líneas, radar, pastel) con recomendaciones automáticas.
- **Mi cuenta**: edición de datos, toggles de notificaciones.
- **Asistencia inmediata**: chat flotante con respuestas simuladas.

> Solo front-end. Los datos son simulados (`src/data/mock.js`).

## Cómo ejecutar

```bash
npm install
npm run dev      # servidor de desarrollo
npm run build    # build de producción en /dist
```

Requiere Node 18+. El mapa usa mosaicos satelitales de Esri (conexión a internet).

## Estructura

```
src/
  App.jsx              # shell + navegación + toasts
  components/          # Sidebar, Topbar, Hero3D, AssistChat, Icons
  pages/               # Dashboard, Ordenes, NuevaOrden, Zonas, Resultados, Cuenta
  data/mock.js         # datos simulados
  styles/global.css    # design system (verde neón)
```

## Personalización rápida

- Colores: variables CSS en `:root` de `src/styles/global.css` (`--neon`, `--bg-0`, etc.).
- Datos y catálogo de análisis: `src/data/mock.js`.
