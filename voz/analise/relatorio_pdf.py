"""PDF do relatório ao credor (SA20), no dia 1 de cada mês: o mesmo conteúdo da tela (só agregados), em HTML
impresso no servidor pelo Chromium sem interface, enviado ao bucket `saidas` em
<empresa>/relatorios_credor/<credor>/<AAAA-MM>.pdf (a policy saidas_relatorio_credor libera para quem envia).

    python3 -m voz.analise.relatorio_pdf --empresa 12 --competencia 2026-10-01
"""
from __future__ import annotations

import argparse
import html
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro",
         "novembro", "dezembro"]


def _n(v) -> str:
    return f"{int(v):,}".replace(",", ".")


def _p(v) -> str:
    return "—" if v is None else f"{float(v):.1f}%".replace(".", ",")


def montar_html(rel: dict, credor: str, assessoria: str) -> str:
    c = rel["conteudo"]
    ano, mes = int(rel["competencia"][:4]), int(rel["competencia"][5:7])
    e = html.escape
    secoes = []
    for s in c.get("secoes", []):
        if not s.get("itens"):
            continue
        linhas = "".join(f"<tr><td>{e(i['rotulo'])}</td><td class=n>{_p(i['pct'])}</td><td class=n>{_n(i['n'])}</td></tr>"
                         for i in s["itens"])
        secoes.append(f"<h2>{e(s.get('titulo', ''))}</h2><table>{linhas}</table>")
    recs = "".join(
        f"<div class=pol><h3>{e(r['titulo'])}</h3><p>{e(r.get('evidencia', ''))}</p>"
        f"<p><b>+{_n(r['estimativa']['centro'])}</b> {e(r.get('unidade', ''))} · faixa de {_n(r['estimativa']['min'])} "
        f"a {_n(r['estimativa']['max'])}</p></div>" for r in c.get("recomendacoes", []))
    com = f"<h2>Comentário da assessoria</h2><p>{e(rel['comentario'])}</p>" if rel.get("comentario") else ""
    resumo = c.get("resumo", {})
    return f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório ao credor</title>
<style>body{{font-family:Arial,Helvetica,sans-serif;color:#1d1d1f;margin:32px;font-size:12px}}h1{{font-size:20px;margin:4px 0}}
h2{{font-size:14px;margin:20px 0 6px}}h3{{font-size:13px;margin:0 0 4px}}table{{width:100%;border-collapse:collapse}}
td{{padding:4px 6px;border-bottom:1px solid #e6e6ea}}td.n{{text-align:right;white-space:nowrap}}.k{{color:#6e6e73;font-size:11px}}
.pol{{border:1px solid #e6e6ea;border-radius:8px;padding:10px;margin:8px 0}}.lgpd{{margin-top:24px;color:#6e6e73;font-size:11px}}</style></head>
<body><div class=k>Relatório ao credor · {MESES[mes - 1]} de {ano}</div>
<h1>O que os devedores do {e(credor)} disseram</h1>
<p class=k>{_n(resumo.get('conversas', {}).get('n', 0))} conversas analisadas · acordo em {_p(resumo.get('acordo_pct'))} · preparado por {e(assessoria)} com o MotorCX</p>
{''.join(secoes)}<h2>Recomendações de política</h2><p class=k>Estimativa conservadora: metade da diferença observada,
com faixa de 25% a 75%. Não é promessa.</p>{recs or '<p>Sem recomendação com evidência suficiente neste mês.</p>'}{com}
<p class=lgpd>Só números agregados. Grupos com menos de 30 conversas não aparecem. Nenhum dado de cliente, nenhum trecho de
conversa e nenhum operador identificado saem neste relatório.</p></body></html>"""


def caminho_pdf(slug: str, credor_id: int, competencia: str) -> str:
    return f"{slug}/relatorios_credor/{int(credor_id)}/{competencia[:7]}.pdf"


def html_para_pdf(html_txt: str, chromium: str = "chromium", rodar=subprocess.run) -> bytes:
    with tempfile.TemporaryDirectory() as d:
        entrada, saida = Path(d) / "r.html", Path(d) / "r.pdf"
        entrada.write_text(html_txt, encoding="utf-8")
        rodar([chromium, "--headless", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer",
               f"--print-to-pdf={saida}", entrada.as_uri()], check=True, capture_output=True, timeout=120)
        return saida.read_bytes()


def gerar(sb, empresa_id: int, competencia: str, para_pdf=html_para_pdf) -> int:
    emp = (sb.selecionar("empresas", {"id": f"eq.{int(empresa_id)}"}, limite=1) or [None])[0]
    if not emp:
        return 0
    rels = sb.selecionar("relatorios_credor", {"empresa_id": f"eq.{int(empresa_id)}", "competencia": f"eq.{competencia}"}) or []
    n = 0
    for rel in rels:
        cred = (sb.selecionar("credores", {"id": f"eq.{int(rel['credor_id'])}"}, limite=1) or [{"nome": "credor"}])[0]
        pdf = para_pdf(montar_html(rel, cred["nome"], emp["nome"]))
        caminho = caminho_pdf(emp["slug"], rel["credor_id"], competencia)
        sb.enviar("saidas", caminho, pdf, tipo="application/pdf")
        sb.atualizar("relatorios_credor", {"id": f"eq.{int(rel['id'])}"}, {"pdf_caminho": caminho})
        n += 1
    return n


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="PDF do relatório ao credor (só agregados)")
    ap.add_argument("--empresa", type=int, required=True)
    ap.add_argument("--competencia", required=True)
    a = ap.parse_args(argv)
    from nuvem.sincronizar import carregar_config
    from nuvem.supabase_api import Supabase
    sb = Supabase(*carregar_config(Path(os.environ.get("MOTORCOB_DADOS", Path.home() / "MotorCob-dados"))))
    print(json.dumps({"pdfs": gerar(sb, a.empresa, a.competencia)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
