# CASUR Maps V12 · Actualizador desde Excel/CSV

## Objetivo
Actualizar `data/metricas_lote.json` sin tocar el código de la PWA.

## Archivos incluidos
- `tools/actualizar_metricas_desde_excel.py`: script local recomendado.
- `plantillas/plantilla_metricas_casur.csv`: plantilla de datos maestros.

## Columnas esperadas
- CodLote
- Hacienda_Productor
- Area_Total_CodLote
- Fecha_Ultimo_Corte
- TCH_Ultima_Zafra
- TCH_Promedio
- Mejor_Zafra
- Peor_Zafra
- Variedad
- Zona
- Estado
- Prioridad

## Uso recomendado
1. Actualice la plantilla o use su Excel maestro con esas columnas.
2. Ejecute:

```bash
python tools/actualizar_metricas_desde_excel.py plantillas/plantilla_metricas_casur.csv --out data
```

Para Excel:

```bash
pip install openpyxl
python tools/actualizar_metricas_desde_excel.py maestro_metricas.xlsx --sheet Hoja1 --out data
```

## Qué subir a GitHub
Después de ejecutar el script, suba/reemplace:
- `data/metricas_lote.json`
- `data/metadata_metricas.json`
- opcional: `data/resumen_actualizacion_metricas.txt`

## Verificación
Abra la PWA, toque un polígono y confirme que la tarjeta muestre:
- Hacienda/Productor nuevo.
- Área total del CODLOTE.
- Fecha de corte actualizada.
- Edad dinámica recalculada.
- TCH/variedad actualizados.
