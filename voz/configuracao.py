"""Busca a configuração de voz no banco e grava o JSON que o gerador do Asterisk e o orquestrador leem.

  python3 -m voz.configuracao --saida /run/motorcx/voz.json [--provedores-sip /etc/motorcx/provedores_sip.json]

Lê voz_troncos, voz_rotas, voz_transferencias, voz_config, voz_contrato (concorrência contratada) e
voz_divisao_concorrencia (o limite de cada empresa) pelo acesso que a VM usa (voz/acesso.py: chave do servidor no
piloto, papel motorcx_voz antes do modo real; só em memória).
Valida tudo com voz/banco.py ANTES de gravar: configuração quebrada no banco não derruba o Asterisk que está no
ar. Um tronco, rota ou transferência inválido fica de fora sozinho (log com id e motivo, sem segredo; aviso em
fornecedor_saude, item configuracao_invalida, que some quando a linha volta a valer) e o resto é publicado: uma linha
de uma empresa não para as outras. Formato de cima errado (e voz_config inválido) mantém a configuração anterior, como
antes. Só grava se mudou (hash) e então sai com código 10, para o serviço da VM regerar o pjsip/dialplan dentro do
contêiner e recarregar (infra/asterisk/vm/motorcx-voz-config).
SQL 83 · B4: tronco ou transferência com host interno, reservado, de loopback ou do MotorCX (inclusive depois de
resolver o nome) fica de fora do mesmo jeito (voz/destinos.py).
Nenhuma senha passa por aqui: o banco só tem a referência do segredo.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

from voz import banco as B
from voz import destinos as DST

TABELAS = ("voz_troncos", "voz_rotas", "voz_transferencias", "voz_config")
MUDOU = 10


def enderecos_motorcx(sb) -> list[str]:
    """Faixas do próprio MotorCX (voz_enderecos_motorcx, SQL 83). Banco sem o SQL 83: lista vazia (fica só o IP
    externo e a rede da VM)."""
    try:
        linhas = sb.selecionar("voz_enderecos_motorcx") or []
    except Exception:   # noqa: BLE001 — tabela do SQL 83 ainda não criada
        return []
    return [str(x.get("faixa")) for x in linhas if x.get("faixa")]


def juntar_operadores(sb, transferencias: list[dict]) -> None:
    """SQL 111: "operadores para transferência ao mesmo tempo". No modo chave a coluna já vem na linha; no acesso
    próprio vem de voz_vm.transferencias_operadores (a view do SQL 57 não muda). Banco sem o SQL 111: fica o padrão (5)."""
    col = B.COLUNAS["voz_transferencias"]["simultaneas"]
    if not transferencias or all(col in t for t in transferencias):
        return
    try:
        por_id = {int(x["id"]): x.get("simultaneas") for x in sb.selecionar("voz_transferencias_operadores") or []}
    except Exception:   # noqa: BLE001 — sem a view do SQL 111
        return
    for t in transferencias:
        if col not in t and por_id.get(int(t.get("id") or 0)) is not None:
            t[col] = por_id[int(t["id"])]


def buscar(sb, provedores_sip: list | None = None, ignoradas: list | None = None, resolver=None,
           proprios=()) -> dict:
    """Configuração de voz do banco, validada. Linhas inválidas de troncos, rotas e transferências ficam de fora e vão
    para `ignoradas` (lista de banco.LinhaIgnorada), se dada. Formato de cima errado: DadosInvalidos.
    SQL 83 · B4: o host do tronco e o da transferência são conferidos contra as faixas reservadas e os IPs do MotorCX
    (`proprios` + voz_enderecos_motorcx) e, com `resolver` (o main usa o DNS), DEPOIS de resolver o nome; o que
    não passa fica de fora sozinho, com aviso. As faixas vão no JSON (enderecos_motorcx) para o gerador conferir de
    novo dentro do contêiner do Asterisk."""
    dados = {t: sb.selecionar(t, ordem="empresa_id.asc") or [] for t in TABELAS}
    juntar_operadores(sb, dados["voz_transferencias"])
    try:
        contrato = sb.selecionar("voz_contrato", limite=1) or []
    except Exception:   # noqa: BLE001 — tabela de V4 ainda não criada
        contrato = []
    dados["voz_contrato"] = {"concorrencia_contratada": int(contrato[0].get("concorrencia_contratada") or 0)} \
        if contrato else {"concorrencia_contratada": 0}
    # o limite de cada empresa é a parte dela no contratado, calculada pelo banco (voz_divisao_concorrencia)
    try:
        divisao = sb.selecionar("voz_divisao_concorrencia") or []
    except Exception:   # noqa: BLE001 — sem a view: limite = canais dos troncos (como antes)
        divisao = []
    cd = B.COLUNAS["voz_divisao_concorrencia"]
    limite = {int(d[cd["empresa_id"]]): d.get(cd["limite"]) for d in divisao}
    for c in dados["voz_config"]:
        c["limite_simultaneas"] = limite.get(int(c[B.COLUNAS["voz_config"]["empresa_id"]]))
    dados["provedores_sip"] = provedores_sip or []
    dados["enderecos_motorcx"] = enderecos_motorcx(sb)
    faixas = DST.proprios_do_ambiente(extras=[*(proprios or ()), *dados["enderecos_motorcx"]])
    dados, fora = B.separar_validos(dados, lambda h: DST.motivo_host(h, faixas, resolver))   # fica de fora sozinha
    B.carregar(dados)            # valida o resto (erro alto, nada é gravado)
    if ignoradas is not None:
        ignoradas.extend(fora)
    return dados


def _arquivo_avisos(saida: Path) -> Path:
    return saida.with_name(saida.name + ".ignoradas.json")


def avisar_ignoradas(sb, ignoradas: list, saida: Path) -> None:
    """Log de cada linha que ficou de fora (id e motivo, sem segredo) e aviso em fornecedor_saude só quando muda:
    linha nova com erro -> ok=false; linha que voltou a valer (ou foi apagada) -> ok=true. A linha do aviso é por
    empresa e referência (tronco.12, rota.5, transferencia.3), sem tronco_id: o aviso não depende do tronco existir.
    O estado fica ao lado do voz.json. Falha ao avisar nunca segura a publicação: o que falhou tenta de novo na
    próxima rodada."""
    for x in ignoradas:
        print(f"AVISO: {x.texto()}. Os outros seguem.", file=sys.stderr)
    arq = _arquivo_avisos(saida)
    try:
        antes = {(int(e), str(ref)) for e, ref in json.loads(arq.read_text(encoding="utf-8"))}
    except (OSError, ValueError, TypeError):
        antes = set()
    agora = {(x.empresa_id, x.referencia): x for x in ignoradas if x.empresa_id is not None}
    estado = set(antes)
    mudou = False
    for chave in sorted(set(agora) - antes) + sorted(antes - set(agora)):
        e, ref = chave
        x = agora.get(chave)
        linha = {"empresa_id": e, "tronco_id": None, "item": B.ITEM_SAUDE, "referencia": ref, "ok": x is None,
                 "contagem": 1 if x else 0,
                 "detalhe": (f"Não subiu: {x.motivo}. Os outros continuam ligando." if x else "Voltou a valer.")[:200]}
        try:
            _gravar_saude(sb, linha)
        except Exception as ex:   # noqa: BLE001 — aviso é melhor-esforço; tenta de novo na próxima rodada
            print(f"AVISO: fornecedor_saude {ref} (empresa {e}) não gravado ({ex.__class__.__name__})", file=sys.stderr)
            continue
        (estado.add if x else estado.discard)(chave)
        mudou = True
    if mudou:
        try:
            arq.parent.mkdir(parents=True, exist_ok=True)
            arq.write_text(json.dumps(sorted([e, ref] for e, ref in estado)), encoding="utf-8")
        except OSError as ex:
            print(f"AVISO: estado dos avisos não gravado ({ex.__class__.__name__})", file=sys.stderr)


def _gravar_saude(sb, linha: dict) -> None:
    try:
        sb.inserir("fornecedor_saude", [linha])     # acesso próprio: upsert por voz_vm.gravar_saude
    except Exception:   # noqa: BLE001 — chave do servidor: o insert simples bate no índice único; troca a linha
        sb.apagar("fornecedor_saude", {"empresa_id": f"eq.{linha['empresa_id']}", "item": f"eq.{linha['item']}",
                                       "referencia": f"eq.{linha['referencia']}"})
        sb.inserir("fornecedor_saude", [linha])


def gravar_se_mudou(dados: dict, saida: Path) -> bool:
    texto = json.dumps(dados, ensure_ascii=False, sort_keys=True, indent=1, default=str)
    if saida.exists() and hashlib.sha256(saida.read_bytes()).digest() == hashlib.sha256(texto.encode()).digest():
        return False
    saida.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=saida.parent, prefix=f".{saida.name}.")
    try:
        os.fchmod(fd, 0o644)          # sem segredo: o contêiner do Asterisk (uid próprio) lê
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(texto)
        os.replace(tmp, saida)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return True


def supabase_do_ambiente():
    """Cliente do banco da VM: chave do servidor (piloto) ou acesso próprio (SQL 57), por MOTORCX_VOZ_ACESSO."""
    from voz.acesso import conectar_do_ambiente
    return conectar_do_ambiente()


def main(argv=None, sb=None) -> int:
    ap = argparse.ArgumentParser(description="Configuração de voz do banco -> JSON do Asterisk/orquestrador")
    ap.add_argument("--saida", required=True)
    ap.add_argument("--provedores-sip", help="JSON com os provedores ligados por SIP (ex.: ElevenLabs)")
    a = ap.parse_args(argv)
    prov = json.loads(Path(a.provedores_sip).read_text(encoding="utf-8")) if a.provedores_sip and \
        Path(a.provedores_sip).exists() else []
    sb = sb or supabase_do_ambiente()
    ignoradas: list = []
    # IPs do próprio MotorCX pelos metadados da VM (motorcx-voz-config passa as duas variáveis ao contêiner)
    proprios = DST.proprios_do_ambiente(os.environ.get("MOTORCX_IP_EXTERNO", ""),
                                        [os.environ.get("MOTORCX_REDE_LOCAL", "")])
    try:
        dados = buscar(sb, prov, ignoradas, resolver=DST.resolver_dns, proprios=proprios)
    except (B.DadosInvalidos, TypeError, AttributeError, KeyError) as ex:   # formato inesperado também não derruba
        print(f"ERRO: configuração de voz inválida no banco (mantida a anterior): {ex.__class__.__name__}: {ex}",
              file=sys.stderr)
        return 2
    mudou = gravar_se_mudou(dados, Path(a.saida))
    avisar_ignoradas(sb, ignoradas, Path(a.saida))
    print(json.dumps({"mudou": mudou, **{t: len(dados[t]) for t in TABELAS},
                      "ignoradas": [x.referencia for x in ignoradas]}, ensure_ascii=False))
    return MUDOU if mudou else 0


if __name__ == "__main__":
    sys.exit(main())
