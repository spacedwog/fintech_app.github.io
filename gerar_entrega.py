
"""
Gera o PDF de entrega e o ZIP final para a atividade FIAP.
Execute: python gerar_entrega.py
"""

import zipfile
import os
import shutil
import urllib.request

# ── 1. Garantir pasta style/ ───────────────────────────────────────────────
os.makedirs("style", exist_ok=True)

# ── 2. Migrar CSS soltos da raiz para style/ ──────────────────────────────
css_raiz = ["tailwind.min.css", "style.css", "styles.css"]
for f in css_raiz:
    dest = os.path.join("style", f)
    if os.path.exists(f) and not os.path.exists(dest):
        shutil.move(f, dest)
        print(f"Migrado: {f} → style/{f}")
    elif os.path.exists(f) and os.path.exists(dest):
        os.remove(f)
        print(f"Removido da raiz (já existe em style/): {f}")

# ── 3. Baixar Tailwind CSS em style/ (se não existir) ─────────────────────
tw_path = os.path.join("style", "tailwind.min.css")
if not os.path.exists(tw_path):
    print("Baixando style/tailwind.min.css...")
    url = "https://unpkg.com/tailwindcss@2.2.19/dist/tailwind.min.css"
    urllib.request.urlretrieve(url, tw_path)
    print("  style/tailwind.min.css salvo.")
else:
    print("style/tailwind.min.css OK.")

# ── 4. Criar PDF com link do repositório ──────────────────────────────────
try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable
    from reportlab.lib.enums import TA_CENTER

    pdf_path = "link_github.pdf"
    doc = SimpleDocTemplate(
        pdf_path,
        pagesize=A4,
        leftMargin=3*cm,
        rightMargin=3*cm,
        topMargin=3*cm,
        bottomMargin=3*cm,
    )

    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        "TitleCustom",
        parent=styles["Title"],
        fontSize=20,
        textColor=colors.HexColor("#10b981"),
        spaceAfter=6,
        alignment=TA_CENTER,
    )
    subtitle_style = ParagraphStyle(
        "SubtitleCustom",
        parent=styles["Normal"],
        fontSize=11,
        textColor=colors.HexColor("#6b7280"),
        spaceAfter=20,
        alignment=TA_CENTER,
    )
    label_style = ParagraphStyle(
        "Label",
        parent=styles["Normal"],
        fontSize=10,
        textColor=colors.HexColor("#6b7280"),
        spaceAfter=6,
    )
    link_style = ParagraphStyle(
        "Link",
        parent=styles["Normal"],
        fontSize=13,
        textColor=colors.HexColor("#2563eb"),
        spaceAfter=20,
        fontName="Helvetica-Bold",
    )
    body_style = ParagraphStyle(
        "Body",
        parent=styles["Normal"],
        fontSize=10,
        textColor=colors.HexColor("#374151"),
        spaceAfter=8,
        leading=16,
    )

    story = [
        Paragraph("Fintech Inteligente", title_style),
        Paragraph("Atividade - Desenvolvimento de Telas com HTML, CSS e Tailwind CSS", subtitle_style),
        HRFlowable(width="100%", thickness=1, color=colors.HexColor("#e5e7eb")),
        Spacer(1, 0.5*cm),

        Paragraph("Aluno:", label_style),
        Paragraph("Felipe Santos", ParagraphStyle("name", parent=styles["Normal"], fontSize=12, fontName="Helvetica-Bold", spaceAfter=16)),

        Paragraph("Repositorio publico no GitHub:", label_style),
        Paragraph("https://github.com/spacedwog/fintech_app", link_style),

        HRFlowable(width="100%", thickness=1, color=colors.HexColor("#e5e7eb")),
        Spacer(1, 0.4*cm),

        Paragraph("Descricao do projeto:", label_style),
        Paragraph(
            "Tela de Dashboard do sistema Fintech Inteligente, desenvolvida com HTML semantico, "
            "CSS customizado (style/style.css) e Tailwind CSS (style/tailwind.min.css). "
            "A interface apresenta KPIs financeiros, grafico de barras de gastos mensais, "
            "distribuicao por categoria e lista de despesas recentes. "
            "O layout e totalmente responsivo para dispositivos mobile.",
            body_style,
        ),

        Spacer(1, 0.4*cm),
        Paragraph("Arquivos incluidos no ZIP:", label_style),
        Paragraph("- index.html               tela principal (Dashboard)", body_style),
        Paragraph("- style/style.css          estilos customizados", body_style),
        Paragraph("- style/tailwind.min.css   framework Tailwind CSS (local)", body_style),
        Paragraph("- link_github.pdf          este documento", body_style),

        Spacer(1, 0.8*cm),
        HRFlowable(width="100%", thickness=1, color=colors.HexColor("#e5e7eb")),
        Paragraph(
            "FIAP - Atividade Avaliativa | Junho 2026",
            ParagraphStyle("footer", parent=styles["Normal"], fontSize=9,
                           textColor=colors.HexColor("#9ca3af"), alignment=TA_CENTER),
        ),
    ]

    doc.build(story)
    print(f"PDF gerado: {pdf_path}")

except ImportError:
    print("reportlab nao encontrado. Instalando...")
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "reportlab"])
    print("Execute o script novamente apos a instalacao.")
    exit(1)

# ── 5. Criar ZIP de entrega ────────────────────────────────────────────────
zip_name = "entrega_fintech.zip"
files_to_zip = [
    "index.html",
    os.path.join("style", "style.css"),
    os.path.join("style", "tailwind.min.css"),
    "link_github.pdf",
]

with zipfile.ZipFile(zip_name, "w", zipfile.ZIP_DEFLATED) as zf:
    for fname in files_to_zip:
        if os.path.exists(fname):
            zf.write(fname)
            print(f"  adicionado: {fname}")
        else:
            print(f"  AVISO: {fname} nao encontrado, pulando.")

print(f"\nZIP criado: {zip_name}")
print("\nPronto! Envie 'entrega_fintech.zip' na plataforma FIAP ON.")
