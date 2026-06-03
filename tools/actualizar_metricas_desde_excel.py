#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CASUR Maps V16 · Actualizador de métricas desde Excel/CSV
Uso:
  python tools/actualizar_metricas_desde_excel.py plantilla.xlsx --salida data
  python tools/actualizar_metricas_desde_excel.py plantilla.csv --salida data
Genera:
  data/metricas_lote.json
  data/metadata_metricas.json
  data/update_log.json
  reporte_validacion_metricas.html
"""
import argparse, json, sys, math
from pathlib import Path
from datetime import datetime, date

REQUIRED = ["CodLote","Hacienda_Productor","Area_Total_CodLote","Fecha_Ultimo_Corte","TCH_Ultima_Zafra","Variedad"]
OPTIONAL = ["TCH_Promedio","Mejor_Zafra","Peor_Zafra","Zona","Estado","Prioridad"]
ALL = REQUIRED + OPTIONAL

def read_table(path: Path):
    if path.suffix.lower() in [".xlsx", ".xlsm", ".xls"]:
        try:
            import pandas as pd
        except Exception:
            raise SystemExit("Instale pandas y openpyxl: pip install pandas openpyxl")
        return pd.read_excel(path, dtype=object)
    if path.suffix.lower() == ".csv":
        import pandas as pd
        return pd.read_csv(path, dtype=object)
    raise SystemExit("Formato no soportado. Use .xlsx o .csv")

def clean_str(v):
    if v is None: return ""
    try:
        if isinstance(v, float) and math.isnan(v): return ""
    except Exception: pass
    return str(v).strip()

def as_float(v):
    s = clean_str(v).replace(",", "")
    if s == "": return None
    try: return float(s)
    except Exception: return None

def as_date_iso(v):
    if v is None or clean_str(v)=="": return ""
    if isinstance(v, (datetime, date)): return v.strftime("%Y-%m-%d")
    s = clean_str(v)
    for fmt in ["%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y"]:
        try: return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except Exception: pass
    return "INVALIDA:" + s

def html_report(summary, issues, out):
    rows = "".join(f"<tr><td>{k}</td><td>{len(v)}</td><td>{', '.join(v[:20])}</td></tr>" for k,v in issues.items())
    html = f"""<!doctype html><html lang='es'><meta charset='utf-8'><title>Validación métricas CASUR Maps</title>
<style>body{{font-family:Segoe UI,Arial,sans-serif;background:#f6faf7;color:#17212b;margin:0}}.top{{height:6px;background:linear-gradient(90deg,#0b7f3a,#005baa,#f4c542)}}main{{max-width:980px;margin:auto;padding:20px}}.hero{{background:linear-gradient(135deg,#07381d,#0b7f3a 60%,#005baa);color:#fff;border-radius:22px;padding:20px}}table{{width:100%;border-collapse:collapse;background:#fff;margin-top:14px}}th{{background:#0b7f3a;color:#fff;text-align:left}}td,th{{padding:9px;border-bottom:1px solid #e5e7eb;vertical-align:top}}.card{{background:#fff;border:1px solid #dbe5dd;border-radius:18px;padding:14px;margin-top:12px}}</style>
<body><div class='top'></div><main><section class='hero'><h1>Validación métricas CASUR Maps</h1><p>{summary['generated_at']}</p></section><section class='card'><b>Filas leídas:</b> {summary['rows']} · <b>Lotes generados:</b> {summary['lots']} · <b>Errores/alertas:</b> {sum(len(v) for v in issues.values())}</section><table><thead><tr><th>Validación</th><th>Cantidad</th><th>Ejemplos</th></tr></thead><tbody>{rows}</tbody></table></main></body></html>"""
    out.write_text(html, encoding="utf-8")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("archivo")
    ap.add_argument("--salida", default="data")
    args = ap.parse_args()
    path = Path(args.archivo)
    outdir = Path(args.salida); outdir.mkdir(parents=True, exist_ok=True)
    df = read_table(path)
    missing = [c for c in REQUIRED if c not in df.columns]
    if missing: raise SystemExit("Faltan columnas obligatorias: " + ", ".join(missing))
    issues = {"sin_fecha_corte":[],"sin_tch":[],"sin_variedad":[],"sin_productor_hacienda":[],"lotes_duplicados":[],"fechas_invalidas":[],"area_cero_o_vacia":[]}
    lotes = {}; seen = {}
    for _, row in df.iterrows():
        cod = clean_str(row.get("CodLote")).upper()
        if not cod: continue
        seen[cod]=seen.get(cod,0)+1
        hac = clean_str(row.get("Hacienda_Productor"))
        fecha = as_date_iso(row.get("Fecha_Ultimo_Corte"))
        tch = as_float(row.get("TCH_Ultima_Zafra"))
        area = as_float(row.get("Area_Total_CodLote"))
        variedad = clean_str(row.get("Variedad"))
        if not hac: issues["sin_productor_hacienda"].append(cod)
        if not fecha: issues["sin_fecha_corte"].append(cod)
        if fecha.startswith("INVALIDA:"): issues["fechas_invalidas"].append(cod+"="+fecha.replace('INVALIDA:',''))
        if tch is None: issues["sin_tch"].append(cod)
        if not variedad: issues["sin_variedad"].append(cod)
        if area is None or area<=0: issues["area_cero_o_vacia"].append(cod)
        lotes[cod] = {
            "codlote": cod,
            "hacienda_productor": hac,
            "area_total_ha": area,
            "area_shape_total_ha": area,
            "fecha_ultimo_corte": fecha if not fecha.startswith("INVALIDA:") else "",
            "fecha_base_edad": fecha if not fecha.startswith("INVALIDA:") else "",
            "tch_ultima_zafra": tch,
            "tch_promedio": as_float(row.get("TCH_Promedio")),
            "tch_promedio_historico": as_float(row.get("TCH_Promedio")),
            "mejor_zafra": as_float(row.get("Mejor_Zafra")),
            "peor_zafra": as_float(row.get("Peor_Zafra")),
            "variedad": variedad,
            "zona": clean_str(row.get("Zona")),
            "estado": clean_str(row.get("Estado")),
            "prioridad": clean_str(row.get("Prioridad"))
        }
    issues["lotes_duplicados"] = [k for k,v in seen.items() if v>1]
    metadata = {"generated_at": datetime.now().isoformat(timespec="seconds"), "source_file": str(path.name), "rows": int(len(df)), "lots": len(lotes), "required_columns": REQUIRED, "optional_columns": OPTIONAL}
    update_log = {"metadata": metadata, "issues": issues}
    (outdir/"metricas_lote.json").write_text(json.dumps({"metadata": metadata, "lotes": lotes}, ensure_ascii=False, indent=2), encoding="utf-8")
    (outdir/"metadata_metricas.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    (outdir/"update_log.json").write_text(json.dumps(update_log, ensure_ascii=False, indent=2), encoding="utf-8")
    html_report(metadata, issues, Path("reporte_validacion_metricas.html"))
    print("OK · lotes generados:", len(lotes))
    print("Archivos: data/metricas_lote.json, data/metadata_metricas.json, data/update_log.json, reporte_validacion_metricas.html")
if __name__ == "__main__": main()
