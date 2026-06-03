# CASUR Maps V13 · Acumulativa Campo PRO

## Base integrada
Esta versión usa como nueva base técnica la `V9_Modo_Recorrido` validada en campo y fusiona encima las funciones acumulativas V9 a V12:

- GPS silencioso / asistido / preciso.
- Detección inteligente de lote, caminos, bordes y varios lotes cercanos.
- Corrección crítica `precomputeBboxes()` para confirmar correctamente cuando el GPS está dentro de un polígono.
- Tarjeta final aprobada: `CODLOTE (área total)`, Hacienda/Productor y Tablón.
- Edad dinámica desde última fecha de corte hasta hoy.
- Enlaces a Cronológico e Histórico.
- Ficha rápida offline.
- Bitácora de campo.
- Capas inteligentes.
- Modo recorrido mejorado.
- Visita de campo.
- Reporte HTML de visita.
- Actualizador desde Excel / CSV.

## Cambios principales V13

### 1. GPS corregido con bboxes
Al cargar el GeoJSON se ejecuta `precomputeBboxes()` y queda un log en consola:

```text
[CASUR V13] Bboxes disponibles: 8575/8575 · calculados en carga: X
```

Esto evita que la detección “dentro del lote” falle por falta de `bbox`.

### 2. Flecha de rumbo GPS
El punto GPS ahora se muestra como una flecha direccional. Usa:

1. `heading` del GPS si el navegador lo entrega.
2. Rumbo calculado entre el punto anterior y el punto actual.
3. Último rumbo válido si el usuario se detiene.

### 3. Orientación del mapa
Se agregan dos botones:

- **Norte arriba**: modo estable para análisis.
- **Rumbo arriba**: modo visual para navegación en vehículo/campo.

Por seguridad, `Norte arriba` queda como modo inicial. Si el usuario mueve el mapa manualmente, se desactiva el seguimiento automático; se reactiva con **GPS** o **Seguirme**.

### 4. Panel agronómico de campo
Se eliminó el bloque técnico “Resumen del shape” del panel izquierdo. Ahora se muestra:

- GPS / navegación.
- Lote actual / seleccionado.
- Lectura agronómica: TCH, edad, variedad y estado.
- Visita / recorrido.

### 5. Coordenadas del centroide
La tarjeta flotante muestra coordenadas GPS del centroide del polígono seleccionado y botón **📍 Copiar**.

### 6. Recorrido mejorado
El recorrido ahora conserva:

- Distancia acumulada con haversine.
- Duración en tiempo real.
- Throttle mínimo de 1.5 s entre puntos.
- Botón **⌖ Ver recorrido en mapa**.
- CSV con línea resumen.
- Nombre con fecha: `recorrido_casur_YYYY-MM-DD.csv`.

### 7. Impresión / PDF
Se mantiene un `@media print` para imprimir ficha de campo sin mapa, priorizando datos agronómicos.

## Cómo subir a GitHub Pages

Suba el contenido interno de esta carpeta a la raíz del repositorio `apps_casur`:

```text
index.html
app.js
styles.css
service-worker.js
manifest.json
historico.html
data/
icons/
tools/
plantillas/
.nojekyll
```

No suba la carpeta completa como subcarpeta. Los archivos deben quedar en la raíz.

## Reinstalación / caché
Después de subir:

1. Desinstale la PWA anterior del celular.
2. Abra `https://kem111079.github.io/apps_casur/`.
3. Refresque dos veces.
4. Instale nuevamente.

## Checklist de prueba en campo

- Activar GPS.
- Confirmar que la flecha indique rumbo.
- Probar `Norte arriba` y `Rumbo arriba`.
- Entrar a un lote y revisar que indique confianza alta.
- Tocar un polígono y copiar coordenadas.
- Iniciar recorrido, avanzar y revisar distancia/duración.
- Usar **Ver recorrido en mapa**.
- Exportar CSV.
- Iniciar/finalizar visita.
- Generar reporte HTML.
- Probar Cronológico e Histórico desde tarjeta.
