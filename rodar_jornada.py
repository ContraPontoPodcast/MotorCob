"""Rotina diária do MotorCli (frente de Jornada do Cliente): gera a Lista do dia da jornada.

Uso:
    python rodar_jornada.py --clientes base/clientes.csv --carteira base/contatos.csv \\
        [--data 2026-10-12] [--estado estado/] [--saida saida/] [--regras regras/jornada.json]

Base de clientes: id_cliente;data_contratacao;proximo_vencimento;vencimento_pago;ativado;ultima_atividade
[;dias_atraso][;bloqueio] (ver motor/jornada.py). Contatos: o mesmo arquivo do MotorCob
(id_cliente;contato;tipo[;origem][;cpf]) com a coluna opcional whatsapp (sim = número confirmado
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
            if jor._simnao(l.get("whatsapp")) and (l.get("tipo") or "").strip().lower() == "telefone":
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


def rodar_jornada(clientes_csv, contatos_csv, data: date, estado_dir, saida_dir, regras_json=jor.PADRAO,
                  definicao: dict | None = None, canais: list[dict] | None = None, calendario: dict | None = None,
                  registros_canal: list | None = None, regras_retorno: dict | None = None, out=print) -> dict:
    """Roda o dia do MotorCli. canais: linhas de canais_empresa (canal, ativo); registros_canal:
    retornos de canal e da mensageria (motor.retorno_canal.Registro)."""
    estado_dir, saida_dir = Path(estado_dir), Path(saida_dir)
    regras = jor.carregar_jornada(regras_json, definicao)
    regua = carregar_regua().com_calendario(calendario)
    clientes, rej_cli = jor.carregar_clientes_jornada(clientes_csv)
    contatos, pessoa_de, rej_cont = carregar_carteira(contatos_csv)
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
    res = jor.gerar(clientes, contatos, data, regras, estado, janela_ok=regua.janela(data) is not None,
                    canais_ativos=ativos, certs=certs, restricoes=restricoes,
                    whatsapp_ok=_whatsapp_confirmados(Path(contatos_csv)),
                    melhor=jor.ordem_por_resultado(hit_rate_por_canal(eventos)))
    jor.salvar_estado(estado_dir, estado)
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
              "sem_acao": dict(res.motivos), "rejeitados": {**rej_cli, **rej_cont}}
    pasta.mkdir(parents=True, exist_ok=True)
    (pasta / "resumo.json").write_text(json.dumps(resumo, ensure_ascii=False, indent=1), encoding="utf-8")
    acoes = agregar_acoes(carregar_escolhas(estado_dir), eventos, regua, desde=data - timedelta(days=DIAS_ACOES))
    out(f"  MotorCli {data.isoformat()}: {len(clientes)} clientes · {resumo['com_acao']} com ação · "
        + " · ".join(f"{jor.CODIGO[m]} {n}" for m, n in sorted(res.por_momento.items())))
    return {"fila": res.fila, "motivos": res.motivos, "por_momento": res.por_momento,
            "enquadramento": res.enquadramento, "alertas": res.alertas, "acoes": acoes, "saida": pasta,
            "resumo": resumo}


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
