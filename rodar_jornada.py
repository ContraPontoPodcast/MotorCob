"""Rotina diária do MotorCli (frente de Jornada do Cliente): gera a Lista do dia da jornada.

Uso:
    python rodar_jornada.py --clientes base/clientes.csv --carteira base/contatos.csv \\
        [--data 2026-10-12] [--estado estado/] [--saida saida/] [--regras regras/jornada.json]

Base de clientes: id_cliente;data_contratacao;proximo_vencimento;vencimento_pago;ativado;ultima_atividade
[;dias_atraso][;bloqueio] (ver motor/jornada.py). Contatos: o mesmo arquivo do MotorCob
(id_cliente;contato;tipo[;origem][;cpf]) com a coluna opcional whatsapp_valido (sim = número confirmado
no WhatsApp; sem ela o MotorCli não usa WhatsApp, pelo risco de banimento).

Gera em saida/AAAA-MM-DD/:
    ids/<canal>.csv     id_cliente;contato — o que a Mensageria transforma em lote, ou vai para o fornecedor
    fila_do_dia.csv     detalhe: momento, passo, canal e contato
    resumo.json         clientes por momento e o motivo de quem ficou de fora
O estado (passos feitos e última ação de cada cliente) fica em --estado/jornada.json e o que foi
mandado acionar em --estado/escolhas.csv (o mesmo formato do MotorCob).
"""
from __future__ import annotations

import argparse
import csv
import json
from datetime import date, timedelta
from pathlib import Path

from motor import jornada as jor
from motor.acoes import agregar as agregar_acoes
from motor.certificacao import certificar_contatos, hit_rate_por_canal
from motor.entrada import carregar_escolhas, salvar_escolhas
from motor.ingestao import carregar_carteira
from motor.regua import carregar_regua
from motor.retorno_canal import aplicar_restricoes, avaliar as avaliar_canal, regras_de

DIAS_ACOES = 35          # janela das ações realizadas que a rotina recalcula (acoes_dia)


def _whatsapp_confirmados(caminho: Path) -> set[str]:
    from motor import normalizacao as norm
    ok = set()
    with open(caminho, newline="", encoding="utf-8") as f:
        for l in csv.DictReader(f, delimiter=";"):
            if jor._simnao(l.get("whatsapp_valido") or l.get("whatsapp")) and (l.get("tipo") or "").strip().lower() == "telefone":
                c = norm.contato(l.get("contato"), "telefone")
                if c:
                    ok.add(c)
    return ok


def _gravar(caminho: Path, linhas: list[dict]):
    caminho.parent.mkdir(parents=True, exist_ok=True)
    with open(caminho, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(linhas[0].keys()), delimiter=";")
        w.writeheader()
        w.writerows(linhas)


def historico_do_dia(enquadramento: dict, fila: list[dict], fase_antes: dict, resultado_hoje: dict) -> list[dict]:
    """Uma linha por cliente com algo no dia (entrou numa fase, teve ação num canal ou fechou um resultado), para
    jornada_cliente_dia (SQL 55). Só o ID do cliente; dia sem nada não grava. Leads (etapas) ficam de fora."""
    canal_hoje: dict[str, str] = {}
    for l in fila:
        canal_hoje.setdefault(l["id_cliente"], l.get("canal") or "")
    linhas = []
    for idc, v in enquadramento.items():
        if idc not in fase_antes:
            continue
        fase = v.get("fase") or ""
        entrou = fase_antes[idc] is None or fase_antes[idc] != fase
        canal = canal_hoje.get(idc, "")
        momento_res, desfecho = resultado_hoje.get(idc, ("", ""))
        if entrou or canal or desfecho:
            linhas.append({"id_cliente": idc, "fase": fase, "entrou": entrou, "passo": v.get("passo") or "",
                           "canal": canal, "desfecho": desfecho, "desfecho_momento": momento_res})
    return linhas


def rodar_jornada(clientes_csv, contatos_csv, data: date, estado_dir, saida_dir, regras_json=jor.PADRAO,
                  definicao: dict | None = None, canais: list[dict] | None = None, calendario: dict | None = None,
                  registros_canal: list | None = None, regras_retorno: dict | None = None, out=print,
                  leads_csv=None, frases: list[dict] | None = None, desfechos_hist: list[dict] | None = None) -> dict:
    """Roda o dia do MotorCli. canais: linhas de canais_empresa (canal, ativo); registros_canal:
    retornos de canal e da mensageria (motor.retorno_canal.Registro); leads_csv: quem ainda não é cliente
    (prospecção, só pelas etapas da empresa); frases: tabela frases (texto das ações {"frase_id": n});
    desfechos_hist: jornada_desfechos dos últimos 90 dias (o "melhor canal" escolhe pelo resultado do momento)."""
    estado_dir, saida_dir = Path(estado_dir), Path(saida_dir)
    aviso = None
    try:
        regras = jor.carregar_jornada(regras_json, definicao)
    except jor.JornadaInvalida as ex:      # estratégia do site com erro: roda o padrão e avisa
        if not definicao:
            raise
        regras, aviso = jor.carregar_jornada(regras_json), f"Estratégia da jornada inválida ({ex}); rodou o padrão."
    regua = carregar_regua().com_calendario(calendario)
    clientes, rej_cli = jor.carregar_clientes_jornada(clientes_csv)
    contatos, pessoa_de, rej_cont = carregar_carteira(contatos_csv)
    leads, rej_leads, wa_leads = {}, {}, set()
    if leads_csv and Path(leads_csv).exists():
        leads, contatos_leads, wa_leads, rej_leads = jor.carregar_leads(leads_csv)
        contatos = contatos + [c for c in contatos_leads if c["id_cliente"] not in clientes]
    donos: dict[str, list[str]] = {}
    for c in contatos:
        donos.setdefault(c["contato"], []).append(c["id_cliente"])
    eventos, restricoes = [], {}
    if registros_canal:
        eventos, restricoes, _, _ = avaliar_canal(registros_canal, donos, data, regras_de(canais, regras_retorno))
    certs = aplicar_restricoes(certificar_contatos(eventos, data, contatos, pessoa_de), restricoes)
    # canal desligado em Canais fica de fora; canal sem linha vale (como no MotorCob)
    ativos = set(jor.CANAIS) - {c.get("canal") for c in canais or [] if c.get("ativo") is False}
    # dia refeito (carga nova, rodada repetida): parte do estado de antes deste dia, não do que ele já marcou
    antes = estado_dir / "jornada_antes.json"
    salvo = json.loads(antes.read_text(encoding="utf-8")) if antes.exists() else {}
    if salvo.get("data") == data.isoformat():
        estado = salvo["estado"]
    else:
        estado = jor.carregar_estado(estado_dir)
        estado_dir.mkdir(parents=True, exist_ok=True)
        antes.write_text(json.dumps({"data": data.isoformat(), "estado": estado}, ensure_ascii=False),
                         encoding="utf-8")
    from motor import etapas as ET
    etapas_estado = ET.carregar_estado(estado_dir)
    ET.limpar(etapas_estado, set(clientes) | set(leads))
    # resultado de cada momento e movimento: compara a carga de hoje com a de ontem (antes das ações de hoje)
    from motor import jornada_resultados as jr
    estado_res = jr.carregar(estado_dir, data)
    # fase de ontem de cada cliente (None = chegou hoje), para o histórico de 90 dias do site (SQL 55)
    fase_antes = {idc: (estado_res[idc].get("m") or "") if idc in estado_res else None for idc in clientes}
    resultado_hoje: dict[str, tuple[str, str]] = {}
    desfechos, movimento = jr.calcular(clientes, lambda c: jor.momento_aplicavel(c, regras, data), data,
                                       estado_res, estado, por_cliente=resultado_hoje)
    jr.salvar(estado_dir, estado_res)
    janela = regua.janela(data)
    if regras.get("travas_janela"):        # trava de horário/dias da estratégia (soma restrições ao calendário)
        from motor.travas import janela_com_travas
        janela = janela_com_travas(janela, regras["travas_janela"], data, regua.dados["janela"].get("feriados"))
    res = jor.gerar(clientes, contatos, data, regras, estado, janela_ok=janela is not None,
                    canais_ativos=ativos, certs=certs, restricoes=restricoes,
                    whatsapp_ok=_whatsapp_confirmados(Path(contatos_csv)) | wa_leads,
                    melhor=jr.melhor_por_resultado(jr.taxas_por_momento(desfechos_hist or []),
                                                   jor.ordem_por_resultado(hit_rate_por_canal(eventos))),
                    leads=leads, etapas_estado=etapas_estado)
    for idc, v in res.enquadramento.items():     # fase do cliente hoje (o mapa conta quem está em cada momento)
        v["fase"] = (estado_res.get(idc) or {}).get("m", "")
    historico = historico_do_dia(res.enquadramento, res.fila, fase_antes, resultado_hoje)
    if aviso:
        res.alertas.insert(0, aviso)
    for a in regras.get("avisos_etapas") or []:
        res.alertas.append(f"ETAPA: {a}")
    textos = {f.get("id"): f.get("texto") for f in frases or [] if f.get("ativo") is not False and f.get("texto")}
    for l in res.fila:                       # frase da ação da etapa: texto próprio ou frase do playbook
        f = l.pop("frase_acao", None)
        l["mensagem"] = textos.get(f.get("frase_id"), "") if isinstance(f, dict) else (f or "")
    jor.salvar_estado(estado_dir, estado)
    ET.salvar_estado(estado_dir, etapas_estado)
    salvar_escolhas(estado_dir, data, res.fila)

    pasta = saida_dir / data.isoformat()
    if (pasta / "ids").exists():
        for arq in (pasta / "ids").glob("*.csv"):     # dia refeito: não fica lista velha
            arq.unlink()
    for canal, linhas in jor.ids_por_canal(res.fila).items():
        _gravar(pasta / "ids" / f"{canal}.csv", linhas)
    if res.fila:
        _gravar(pasta / "fila_do_dia.csv", [{k: l[k] for k in ("id_cliente", "regua", "passo", "canal", "contato")}
                                            for l in res.fila])
    resumo = {"data": data.isoformat(), "frente": "motorcli", "clientes": len(clientes),
              "com_acao": sum(res.por_momento.values()), "por_momento": dict(res.por_momento),
              "fila": {c: len(v) for c, v in jor.ids_por_canal(res.fila).items()},
              "sem_acao": dict(res.motivos), "rejeitados": {**rej_cli, **rej_cont, **rej_leads},
              "leads": len(leads)}
    pasta.mkdir(parents=True, exist_ok=True)
    (pasta / "resumo.json").write_text(json.dumps(resumo, ensure_ascii=False, indent=1), encoding="utf-8")
    acoes = agregar_acoes(carregar_escolhas(estado_dir), eventos, regua, desde=data - timedelta(days=DIAS_ACOES))
    out(f"  MotorCli {data.isoformat()}: {len(clientes)} clientes · {resumo['com_acao']} com ação · "
        + " · ".join(f"{jor.CODIGO.get(m, m)} {n}" for m, n in sorted(res.por_momento.items())))
    return {"fila": res.fila, "motivos": res.motivos, "por_momento": res.por_momento,
            "enquadramento": res.enquadramento, "alertas": res.alertas, "acoes": acoes, "saida": pasta,
            "resumo": resumo,
            "desfechos": [{"momento": m, "canal": c, "frase_id": f, "desfecho": d, "clientes": n}
                          for (m, c, f, d), n in sorted(desfechos.items())],
            "movimento": [{"de": de, "para": para, "clientes": n} for (de, para), n in sorted(movimento.items())],
            "historico": historico}


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--clientes", required=True)
    p.add_argument("--carteira", required=True)
    p.add_argument("--data", type=date.fromisoformat, default=date.today())
    p.add_argument("--estado", default="estado_jornada")
    p.add_argument("--saida", default="saida_jornada")
    p.add_argument("--regras", default=str(jor.PADRAO))
    a = p.parse_args()
    r = rodar_jornada(a.clientes, a.carteira, a.data, a.estado, a.saida, a.regras)
    for alerta in r["alertas"]:
        print("ALERTA:", alerta)
    print(json.dumps(r["resumo"], ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
