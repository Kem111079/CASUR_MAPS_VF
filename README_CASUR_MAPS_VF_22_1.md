# CASUR Maps VF-22.1

## Cambios desde VF-22

### Fix: Botón ✕ Cerrar — ahora funciona y posición inferior derecha

**Causa del bug:** `closePanel()` no estaba expuesta en `window`, por lo que
el atributo `onclick="closePanel(true)"` en el HTML generado dinámicamente
fallaba silenciosamente (las funciones inline solo buscan en `window`).

**Fixes aplicados:**
1. `closePanel` declarada como `window.closePanel = function closePanel(...)` → accesible desde inline onclick.
2. `onclick` cambiado a `window.closePanel(true)` para explicitarlo.
3. `.go-close-panel` agregado a la lista de exclusión del autoclose listener, de lo contrario el toque era interceptado antes de llegar al onclick.
4. Posición: botón en `grid-column:2` (derecha) — "Compartir hallazgo" queda a la izquierda.
