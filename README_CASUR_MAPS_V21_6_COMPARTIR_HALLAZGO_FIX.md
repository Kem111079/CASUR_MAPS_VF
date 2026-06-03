# CASUR Maps V21.6 · Compartir Hallazgo FIX

Corrige la generación y compartir de la tarjeta de hallazgo.

## Correcciones
- Corrige cálculo de coordenadas de la tarjeta usando `featureCentroid()`.
- Evita que el botón Generar tarjeta falle por función de centroide inexistente.
- `Compartir / WhatsApp` ahora espera correctamente la generación del canvas/PNG.
- `Descargar imagen` espera la generación completa antes de descargar.
- Mantiene fallback a WhatsApp con texto si el navegador no permite compartir archivos.
- Mantiene técnico, categoría, severidad, comentario y foto opcional.

## Nota
En iPhone/Safari, compartir imagen por WhatsApp puede depender del soporte del navegador. Si no permite archivo, use **Descargar imagen** y **Copiar texto** como respaldo.
