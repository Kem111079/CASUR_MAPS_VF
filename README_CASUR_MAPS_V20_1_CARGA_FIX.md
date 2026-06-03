# CASUR Maps V20.1 · Carga FIX

Corrección sobre V20 para evitar que la PWA quede detenida en “Cargando CASUR Maps...”.

## Cambios
- Carga robusta de Leaflet con reintento: unpkg → jsDelivr.
- `app.js` inicia aunque se cargue después de `DOMContentLoaded`.
- Service worker con estrategia network-first para `index.html`, `app.js`, `styles.css` y `manifest.json`.
- El service worker ya no bloquea instalación si falla el cacheo de archivos grandes.
- Mensajes de loader más claros si falta `app.js` o falla la librería de mapa.

## Recomendación
Después de subir esta versión, desinstale la PWA anterior o borre datos del sitio para eliminar el service worker/cache de V20.
