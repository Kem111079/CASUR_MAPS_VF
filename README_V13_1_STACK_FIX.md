# CASUR Maps V13.1 · Stack Fix

Corrección quirúrgica sobre V13 Campo PRO.

## Problema corregido

Al iniciar la app podía aparecer:

`No se pudo cargar el mapa: Maximum call stack size exceeded`

Causa: recursión involuntaria entre `loadActiveVisit()` y `renderVisitSummary()` dentro del módulo de visita de campo.

## Corrección aplicada

- `loadActiveVisit()` ahora solo carga la visita activa desde `localStorage` y devuelve el estado.
- `renderVisitSummary()` ya no vuelve a llamar a `loadActiveVisit()`.
- `bindVisitUi()` carga la visita activa una vez y luego renderiza el resumen.
- Se actualizó el service worker a `casur-maps-pwa-v13-1-stack-fix`.

## Qué se mantiene

- Base V9 validada en campo.
- `precomputeBboxes()`.
- GPS silencioso/asistido/preciso.
- Panel agronómico.
- Recorrido, visita, reporte HTML y actualizador Excel.
- Tarjeta final, cronológico e histórico.

## Recomendación

Subir todo el contenido de esta carpeta a la raíz de GitHub Pages y reinstalar/limpiar caché de la PWA.
