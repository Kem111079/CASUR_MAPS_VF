# CASUR Maps V20.4 · Medición de campo

Versión quirúrgica basada en V20.3.

## Cambios principales

1. Header oficial ajustado:
   - Departamento de Negocios de Caña
   - CASUR Maps
   - Mapa inteligente de lotes cañeros

2. Nueva herramienta **Medición de campo**:
   - Medir longitud manual tocando puntos en el mapa.
   - Medir área manual formando un polígono.
   - Deshacer último punto.
   - Limpiar medición.
   - Reporta distancia, perímetro, hectáreas y manzanas.

3. La medición no interfiere con la selección de lotes:
   - Si la medición está activa, tocar un polígono agrega punto de medición.
   - Al limpiar, el mapa vuelve a operar normal.

4. Estilo visual adaptativo:
   - En mapa claro usa línea azul.
   - En satélite usa línea cian con alto contraste.
   - En alto contraste usa línea dorada.

## Instalación

Suba todo el contenido interno de esta carpeta a la raíz de GitHub Pages. Luego limpie caché o reinstale la PWA para tomar el nuevo service worker.

Service worker: `casur-maps-pwa-v20-4-medicion-campo`.
