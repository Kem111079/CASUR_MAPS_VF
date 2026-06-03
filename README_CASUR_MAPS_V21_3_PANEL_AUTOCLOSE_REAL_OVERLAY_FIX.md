# CASUR Maps V21.3 · Panel Auto-Close Real Overlay FIX

Corrección quirúrgica sobre V21.2.

## Problema corregido
En algunos teléfonos, el cierre automático del panel al tocar fuera no funcionaba de forma consistente porque dependía de un pseudo-elemento CSS (`body::before`) y eventos globales.

## Solución
- Se agregó un overlay real en el DOM: `#sidebarBackdrop`.
- Tocar ese overlay cierra el panel inmediatamente en móvil.
- Se mantiene respaldo por eventos globales y eventos del mapa.
- No se cierra automáticamente durante medición activa.
- No se cierra si hay formularios/modales abiertos.
- Escape cierra el panel en escritorio/tablet.

## Archivos tocados
- `index.html`
- `app.js`
- `styles.css`
- `service-worker.js`

## Service worker
`casur-maps-pwa-v21-3-panel-autoclose-real-overlay-fix`

## Prueba
1. Abrir en teléfono.
2. Tocar **Panel**.
3. Tocar fuera del panel: el panel debe cerrarse.
4. Activar medición y confirmar que no se cierre accidentalmente mientras se mide.
