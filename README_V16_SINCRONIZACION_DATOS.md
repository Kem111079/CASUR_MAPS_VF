# V16 · Sincronización y actualización de datos

Flujo recomendado seguro:

1. Actualizar Excel/CSV maestro con las columnas obligatorias.
2. Ejecutar: `python tools/actualizar_metricas_desde_excel.py archivo.xlsx --salida data`
3. Revisar `reporte_validacion_metricas.html` y `data/update_log.json`.
4. Subir a GitHub: `data/metricas_lote.json`, `data/metadata_metricas.json` y `data/update_log.json`.
5. Abrir la PWA y refrescar/reinstalar si hay caché viejo.

No se incluyen tokens de GitHub: la subida directa automática no se activa por seguridad.
