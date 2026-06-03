# CASUR Maps PWA · V5.3 Tarjeta Final Agronómica

Versión lista para GitHub Pages. Incluye GPS silencioso V5.1, integración con histórico/cronológico y nueva tarjeta final por CodLote.

## Cambios V5.3

- Encabezado compacto: `CODLOTE 2501 (48.72 ha)`.
- `Hacienda/Productor` aparece debajo del CodLote.
- Se elimina `Finca - Suerte` del encabezado de la tarjeta.
- Se muestra `Tablón` como tercera línea.
- Tarjetas internas: Área Shape, TCH última zafra, Edad actual y Variedad.
- Nuevo archivo `data/metricas_lote.json` para enriquecer el mapa sin hacer pesado el HTML.

## Subida a GitHub Pages

Subir todo el contenido de esta carpeta a la raíz del repositorio, reemplazando los archivos anteriores. Mantener las carpetas `data/` e `icons/`.


## V5.3
Corrección quirúrgica: la Edad actual de la tarjeta se calcula dinámicamente desde la última fecha de corte hasta la fecha actual del dispositivo.
