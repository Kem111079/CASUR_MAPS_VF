# CASUR Maps V19.5 · Capas de edad por rangos

Versión quirúrgica sobre V19.4.

## Cambio aplicado
Se reemplazó la lógica anterior de edad por tres capas operativas:

- **Resaltar edad < 3 meses**
- **Resaltar edad 4 a 6 meses**
- **Resaltar edad > 6 meses**

La edad sigue calculándose dinámicamente desde la última fecha de corte hasta la fecha actual del dispositivo.

## Colores sugeridos
- Edad < 3 meses: azul celeste.
- Edad 4–6 meses: dorado/amarillo.
- Edad > 6 meses: café/dorado oscuro.

## No se tocó
- GPS.
- Detección dentro/cerca de lote.
- precomputeBboxes().
- Buscador por CodLote.
- Tarjeta final.
- Recorrido, visitas, fotos, reportes e histórico.

## Instalación
Subir todo el contenido interno de esta carpeta a la raíz de GitHub Pages y limpiar caché/reinstalar la PWA si el celular conserva la versión anterior.
