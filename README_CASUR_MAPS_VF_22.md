# CASUR Maps VF-22

## Cambios en esta versión

### 1. Botón Cerrar movido a parte inferior izquierda
- La ✕ ya no está pegada en la parte superior del panel.
- Ahora aparece como botón **"✕ Cerrar"** en la fila inferior izquierda del card de lote seleccionado, junto a "Compartir hallazgo".
- Posición natural para el pulgar en móviles.

### 2. Eliminar comentario en viñetas
- Cada comentario ahora tiene un botón rojo **✕** para eliminarlo.
- El primero solo se muestra cuando hay más de 1 comentario.
- Los comentarios se renumeran automáticamente al eliminar.

### 3. Impresión Histórico: nombre de archivo único
- El PDF del Histórico ahora se genera con nombre `Historico_CASUR_{Código}_{Nombre}`.
- Ya no se llama igual que el Cronológico.

### 4. Página en blanco en Histórico corregida
- Los elementos `<summary>` de los acordeones se ocultan correctamente en modo impresión.
- El contenido de `fichaSection` se muestra sin dejar espacio en blanco inicial.

### 5. Cronológico: impresión rediseñada
- Barra tricolor CASUR (verde-azul-dorado) al inicio del documento.
- Encabezado de gradiente oscuro con nombre del productor y metadatos en blanco.
- Gráficas de área por riego/variedad/textura incluidas en impresión (grid 2 columnas).
- Filas de tabla con colores TCH (verde/amarillo/rojo) en impresión.
- Nombre de archivo `Cronologico_CASUR_{Nombre}`.

### 6. Histórico: impresión también mejorada
- Misma barra tricolor al inicio.
- Encabezado con gradiente azul oscuro.
- Filas de tabla con colores TCH en impresión.

### 7. Service Worker actualizado a VF-22
