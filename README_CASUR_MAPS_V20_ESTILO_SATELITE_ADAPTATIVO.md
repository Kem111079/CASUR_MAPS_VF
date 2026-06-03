# CASUR Maps V20 · Estilo Satélite Adaptativo

Versión generada con enfoque quirúrgico sobre la base V19.5.

## Objetivo
Mejorar la visibilidad de los polígonos CASUR cuando se cambia el mapa base a **Vista satélite**, evitando que las líneas se pierdan sobre vegetación, caminos, sombras o texturas del fondo.

## Cambios principales

1. **Estilo automático según mapa base**
   - En **Mapa claro**, la app conserva el estilo normal.
   - En **Satélite**, activa automáticamente borde reforzado con halo blanco.
   - En **Sin mapa base**, activa estilo de alto contraste.

2. **Selector manual de estilo de polígonos**
   En el panel de **Capas inteligentes** se agregó:
   - Automático según mapa.
   - Normal · mapa claro.
   - Satélite · halo blanco.
   - Alto contraste · campo.

3. **Halo de polígonos**
   Se agregó una capa inferior no interactiva para crear efecto de borde/halo:
   - Satélite: halo blanco.
   - Alto contraste: halo oscuro.

4. **Etiquetas adaptativas**
   En satélite y alto contraste, las etiquetas CodLote cambian a fondo oscuro, texto blanco y sombra para mejorar lectura.

5. **Conserva lo ya funcional**
   No se tocó GPS, búsqueda por CodLote, tarjeta, histórico, fotos, reportes, visitas, recorrido ni actualizador Excel.

## Instalación en GitHub Pages
Suba el contenido interno de esta carpeta a la raíz del repositorio, reemplazando los archivos actuales.

Luego limpie caché o reinstale la PWA para que el service worker tome la nueva versión:
`casur-maps-pwa-v20-estilo-satelite-adaptativo`.

## Prueba recomendada
1. Abrir CASUR Maps.
2. Activar capa Satélite en el control de Leaflet.
3. Verificar que los polígonos tengan borde más grueso y halo blanco.
4. Activar capas TCH o edad y comprobar que los colores resalten.
5. Probar el selector manual: Normal, Satélite y Alto contraste.
