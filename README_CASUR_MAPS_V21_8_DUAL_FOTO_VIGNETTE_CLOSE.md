# CASUR Maps V21.8 · Dual Foto + Vignette + Cerrar Abajo

## Cambios incluidos en esta versión

### 1. Cronológico/Histórico actualizado
- `historico.html` reemplazado con la versión más reciente `Cronolog_Historico_CASUR_NC_VF50` (2178 líneas, +328 líneas de mejoras: gráfica de tendencia por suerte, filtros avanzados).

### 2. Botón Cerrar en la parte inferior del tooltip
- La `×` del panel de ficha rápida se movió a la **parte inferior** como botón ancho verde fácil de tocar en móvil.
- Más ergonómico: el pulgar llega naturalmente al botón inferior en cualquier teléfono.

### 3. Compartir Hallazgo: hasta 2 fotos
- Se añadió un segundo campo de foto opcional (`Foto 2`).
- En el informe/tarjeta generada: si hay 2 fotos, se muestran **side-by-side** ajustadas automáticamente. Si hay 1, ocupa el ancho completo.

### 4. Categorías ampliadas
- Agregadas: **Siembra** y **Madurante** a la lista de categorías.

### 5. Comentarios tipo Viñeta (hasta 5)
- El campo único de "Comentario" fue reemplazado por un sistema de **viñetas numeradas**.
- Inicia con 1 comentario; el botón "+ Agregar comentario" añade hasta 5 entradas numeradas con burbuja verde.
- Cada comentario aparece numerado (①②③...) en la tarjeta generada.

### 6. Optimizaciones generales
- Service Worker actualizado a v21.8 para limpiar caché anterior.
- Async/await en share, download y copy para mejor rendimiento.
- `wrapCanvasTextReturn` helper para cálculo de líneas en canvas.
