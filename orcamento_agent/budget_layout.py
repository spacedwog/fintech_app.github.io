"""
orcamento_agent/budget_layout.py

Leitura de planilha de orçamento usando um "layout" definido pelo usuário —
mesmo conceito e mesmos nomes de campo do modal "Configurar layout de
leitura" do painel web (ver js/budget-ai.js e js/dashboard.js), só que do
lado do agente Python. Um layout.json criado ali (ou pelo assistente
`mp_sync.py --criar-layout`) usa exatamente este formato.

Um layout é um dict com:
  name              (opcional) nome do layout
  sheetName         aba a ler, ou None/"" para detectar automaticamente
                     (primeira aba com "orcamento"/"budget" no nome, ou a
                     primeira aba da planilha)
  format            "longo" ou "largo"

  # formato "longo": uma linha por categoria (+ mês opcional)
  headerRow         linha (1-based) do cabeçalho
  colCategoria      coluna (letra, ex. "A") com a categoria
  colMes            coluna do mês (opcional)
  colPrevisto       coluna do valor previsto
  colRealizado      coluna do valor realizado (opcional)

  # formato "largo": Categoria + pares Previsto/Realizado por mês
  colCategoriaLarga coluna da categoria
  monthRow          linha (1-based) com o nome dos meses
  subHeaderRow      linha (1-based) com "Previsto"/"Realizado"

Isto NÃO é um modelo de linguagem -- é leitura de planilha com coordenadas
exatas informadas pelo usuário, sem heurística nenhuma (ao contrário do
js/budget-ai.js, que também tenta adivinhar o formato automaticamente).
"""
import unicodedata


def _normalize(s):
    if s is None:
        return ""
    s = str(s).lower().strip()
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c))


def col_to_index(letter):
    """'A' -> 0, 'B' -> 1, 'AA' -> 26 ... também aceita número de coluna
    1-based (ex.: "4" -> 3). Retorna None se vazio/inválido."""
    if letter is None or str(letter).strip() == "":
        return None
    s = str(letter).strip().upper()
    if s.isdigit():
        return int(s) - 1
    n = 0
    for ch in s:
        c = ord(ch) - 64
        if c < 1 or c > 26:
            return None
        n = n * 26 + c
    return n - 1


def _to_number(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    # aceita tanto "1.234,56" (formato BR) quanto "1234.56" (formato US)
    if len(s) >= 3 and s[-3] == ",":
        s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def pick_sheet(wb, sheet_name=None):
    """Escolhe a aba: usa sheet_name se existir na planilha; senão procura
    uma aba com "orcamento"/"budget" no nome; senão cai na primeira aba."""
    if sheet_name and sheet_name in wb.sheetnames:
        return sheet_name
    for name in wb.sheetnames:
        norm = _normalize(name)
        if "orcamento" in norm or "budget" in norm:
            return name
    return wb.sheetnames[0]


def _sheet_rows(wb, sheet_name):
    ws = wb[sheet_name]
    return [[c.value for c in row] for row in ws.iter_rows()]


def _row_value(row, idx):
    if idx is None or idx >= len(row):
        return None
    return row[idx]


def apply_long_layout(rows, layout):
    header_row = int(layout.get("headerRow") or 1) - 1
    cat_col = col_to_index(layout.get("colCategoria"))
    mes_col = col_to_index(layout.get("colMes"))
    prev_col = col_to_index(layout.get("colPrevisto"))
    real_col = col_to_index(layout.get("colRealizado"))

    if cat_col is None or prev_col is None:
        raise ValueError("Layout incompleto: informe pelo menos colCategoria e colPrevisto.")

    entries = []
    for row in rows[header_row + 1:]:
        categoria = _row_value(row, cat_col)
        if categoria is None or str(categoria).strip() == "":
            continue
        mes = _row_value(row, mes_col)
        entries.append({
            "categoria": str(categoria).strip(),
            "mes": str(mes).strip() if mes not in (None, "") else None,
            "previsto": _to_number(_row_value(row, prev_col)) or 0,
            "realizado": (_to_number(_row_value(row, real_col)) or 0) if real_col is not None else 0,
        })
    return entries


def apply_wide_layout(rows, layout):
    cat_col = col_to_index(layout.get("colCategoriaLarga") or layout.get("colCategoria") or "A")
    month_row_idx = int(layout.get("monthRow") or 1) - 1
    sub_header_row_idx = int(layout.get("subHeaderRow") or (month_row_idx + 2)) - 1

    month_row = rows[month_row_idx] if 0 <= month_row_idx < len(rows) else []
    sub_row = rows[sub_header_row_idx] if 0 <= sub_header_row_idx < len(rows) else []

    months = []
    last_month = None
    for v in month_row:
        if v is not None and str(v).strip() != "":
            last_month = str(v).strip()
        months.append(last_month)

    pairs = []
    for c, v in enumerate(sub_row):
        if _normalize(v) != "previsto":
            continue
        realizado_col = None
        if c + 1 < len(sub_row) and _normalize(sub_row[c + 1]) == "realizado":
            realizado_col = c + 1
        mes = months[c] if c < len(months) else None
        pairs.append({"mes": mes, "previstoCol": c, "realizadoCol": realizado_col})

    if not pairs:
        raise ValueError(
            "Não encontrei nenhum par Previsto/Realizado na linha de subcabeçalho informada. "
            "Confira monthRow/subHeaderRow do layout."
        )

    entries = []
    for row in rows[sub_header_row_idx + 1:]:
        categoria = _row_value(row, cat_col)
        if categoria is None or str(categoria).strip() == "":
            continue
        for p in pairs:
            previsto = _to_number(_row_value(row, p["previstoCol"]))
            realizado = _to_number(_row_value(row, p["realizadoCol"])) if p["realizadoCol"] is not None else None
            if previsto is None and realizado is None:
                continue
            entries.append({
                "categoria": str(categoria).strip(),
                "mes": p["mes"],
                "previsto": previsto or 0,
                "realizado": realizado or 0,
            })
    return entries


def _build_result(entries):
    rows = []
    for e in entries:
        saldo = e["previsto"] - e["realizado"]
        status = "ESTOURADO" if saldo < 0 else "DENTRO DO ORÇAMENTO"
        rows.append({**e, "saldo": saldo, "status": status})

    total_previsto = sum(r["previsto"] for r in rows)
    total_realizado = sum(r["realizado"] for r in rows)
    alerts = [r for r in rows if r["status"] == "ESTOURADO"]

    return {
        "rows": rows,
        "totalPrevisto": total_previsto,
        "totalRealizado": total_realizado,
        "saldoTotal": total_previsto - total_realizado,
        "alerts": alerts,
        "overBudget": len(alerts) > 0,
    }


def analyze_with_layout(wb, layout):
    """wb: openpyxl.Workbook já aberto (recomendado data_only=True, para
    pegar valores calculados em vez de fórmulas cruas). layout: dict (ver
    docstring do módulo).

    Retorna o mesmo formato de resultado que js/budget-ai.js:
      { rows: [{categoria, mes, previsto, realizado, saldo, status}],
        totalPrevisto, totalRealizado, saldoTotal, alerts, overBudget,
        sheetName }
    """
    if not layout:
        raise ValueError("Nenhum layout informado.")

    fmt = (layout.get("format") or "largo").lower()
    if fmt not in ("longo", "largo"):
        raise ValueError(f"Formato de layout desconhecido: {fmt!r} (use 'longo' ou 'largo').")

    sheet_name = pick_sheet(wb, layout.get("sheetName"))
    rows = _sheet_rows(wb, sheet_name)

    entries = apply_long_layout(rows, layout) if fmt == "longo" else apply_wide_layout(rows, layout)
    if not entries:
        raise ValueError(
            f"Nenhuma linha reconhecida com esse layout na aba '{sheet_name}'. "
            "Confira as linhas/colunas configuradas."
        )

    result = _build_result(entries)
    result["sheetName"] = sheet_name
    return result
