# CASUR Maps V20.2 · Capas de rendimiento adaptativas para satélite

Versión quirúrgica sobre V20.1.

## Cambio principal
Se ajustó la simbología de las capas de rendimiento para que, cuando estén activas todas y se use vista satélite, cada una se distinga por **color + patrón + grosor + halo**:

- **TCH < 40 t/ha:** rojo sólido, prioridad crítica.
- **TCH < 50 t/ha:** naranja discontinuo para el rango bajo; si también está activo <40, el crítico mantiene prioridad.
- **TCH > 70 t/ha:** en mapa claro se mantiene verde; en satélite cambia a cian punteado para no perderse con la vegetación.

## Se mantiene intacto
GPS, buscador, tarjeta, recorrido, visitas, fotos, reportes, histórico, PWA y service worker robusto de V20.1.

## Instalación
Subir el contenido interno de esta carpeta a la raíz de GitHub Pages y limpiar caché/reinstalar PWA si el celular conserva versión anterior.
