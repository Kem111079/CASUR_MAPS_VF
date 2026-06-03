# CASUR Maps V19.1 · Campo PRO FIX

Versión quirúrgica basada en `V19_Campo_PRO`.

## Correcciones aplicadas

1. **Corrección HTML crítica del panel lateral**
   - Se cerró correctamente la sección `GPS de campo`.
   - La sección `Navegación PRO` ya no queda anidada dentro de GPS.
   - El conteo de `<section>` y `</section>` queda balanceado.

2. **Actualización de versión/cache**
   - Se actualizó el `service-worker` a `casur-maps-pwa-v19-1-campo-pro-fix`.
   - Se actualizaron referencias visibles de V19 a V19.1.
   - Se actualizaron querystrings de `app.js` y `styles.css` para reducir problemas de caché en GitHub Pages/PWA.

## Se conserva intacto

- `precomputeBboxes()` y detección dentro de lote.
- GPS silencioso/asistido/preciso.
- Norte arriba / Rumbo arriba.
- Flecha de rumbo GPS.
- Drag manual desactiva “siguiéndome”.
- Tarjeta final aprobada.
- Recorrido con distancia, duración, throttle y CSV.
- Visitas, reportes, fotos georreferenciadas e IndexedDB.
- Actualizador Excel y estructura GitHub Pages.

## Instalación

Subir el contenido interno de esta carpeta a la raíz del repositorio GitHub Pages. Luego desinstalar/reinstalar la PWA o limpiar caché si el celular conserva versión anterior.
