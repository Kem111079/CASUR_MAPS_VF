# CASUR Maps V21.2 · Panel Auto-Close UX FIX

Versión quirúrgica sobre V21.1.

## Cambios aplicados

- En teléfonos, el panel lateral se cierra automáticamente al tocar fuera de él.
- Agrega cierre con tecla `Escape` en escritorio/tablet.
- Agrega overlay móvil discreto para indicar que el panel está activo.
- No cierra automáticamente durante medición activa, para no interrumpir mediciones de área/longitud.
- No cierra si hay formularios o modales abiertos: observaciones, ficha rápida o instalación.
- Se actualizan `app.js`, `styles.css`, `index.html` y `service-worker.js`.

## Instalación

Subir todo el contenido interno de esta carpeta a la raíz de GitHub Pages. Luego limpiar caché o reinstalar la PWA si el teléfono mantiene la versión anterior.

## Prueba rápida

1. Abrir panel en móvil.
2. Tocar el mapa/fondo fuera del panel.
3. Confirmar que el panel se cierra.
4. Activar medición y tocar mapa: el panel no debe cerrarse automáticamente durante medición activa.
