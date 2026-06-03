# CASUR Maps V19.3 · Header + TCH + Buscador FIX

Versión quirúrgica basada en V19.2. No agrega rutas ni “Ir a destino”.

## Cambios aplicados

1. **Header limpio**
   - Visible solo: `Departamento de Negocios de Caña` y `CASUR Maps`.
   - Se elimina del encabezado visible el texto técnico de versión y descripción larga.

2. **Capas TCH refinadas**
   - `Resaltar TCH < 40 t/ha`
   - `Resaltar TCH < 50 t/ha`
   - `Resaltar TCH > 70 t/ha`
   - Se mantiene edad alta y variedad seleccionada.

3. **Buscador corregido por CodLote**
   - La búsqueda ya no revisa todos los campos mezclados.
   - Prioriza coincidencia exacta por CodLote / CodSuerte / LLAVE_LOTE normalizada.
   - Si el CodLote tiene varios polígonos o tablones, centra el conjunto del lote.
   - Si hay varias coincidencias parciales, pide escribir el CodLote completo.

4. **Cache/PWA**
   - Service worker actualizado a `casur-maps-pwa-v19-3-header-tch-buscador-fix`.

## Instalación

Sube el contenido interno de esta carpeta a la raíz del repositorio GitHub Pages. Luego desinstala la PWA anterior o limpia caché para asegurar que cargue V19.3.
