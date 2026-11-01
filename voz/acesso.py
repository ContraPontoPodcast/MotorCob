"""Como a VM de voz fala com o Supabase: escolha por configuração da VM (MOTORCX_VOZ_ACESSO).

  supabase_chave  (piloto, modo simulado) PostgREST + Storage com a chave do servidor (nuvem/supabase_api.Supabase).
  acesso_proprio  (obrigatório antes do modo real) Postgres direto pelo pooler do Supabase (Supavisor), com o papel
                  motorcx_voz do SQL 57, que só enxerga o schema voz_vm. A senha vem do Secret Manager
                  (motorcx-voz-db-senha) e fica só em memória. Arquivos (Lista do dia, retorno) vão pela Edge Function
                  voz-arquivos com um bilhete de uso único que o banco emite para UM caminho validado.

AcessoProprio tem a MESMA interface que a voz usa da classe Supabase (selecionar, inserir, rpc, baixar, enviar,
apagar_arquivos): configuracao.py, registro.py, publicacao.py, fluxo.py, gerar_fluxo.py e o orquestrador não mudam.
Tabela ou RPC fora da voz é recusada aqui e, de novo, no banco.

Variáveis (gravadas em /run/motorcx/voz.env por infra/asterisk/vm/motorcx-voz-segredos a partir dos metadados;
nenhuma é segredo):
  MOTORCX_VOZ_ACESSO        supabase_chave (padrão) | acesso_proprio
  MOTORCOB_SUPABASE_URL     https://<ref>.supabase.co (Edge Function de arquivos; no piloto, também a API)
  MOTORCX_VOZ_DB_HOST       host do pooler (ex.: aws-0-sa-east-1.pooler.supabase.com)
  MOTORCX_VOZ_DB_PORTA      5432 (modo sessão do Supavisor; padrão)
  MOTORCX_VOZ_DB_USUARIO    motorcx_voz.<ref do projeto>
  MOTORCX_VOZ_DB_BANCO      postgres (padrão)
  MOTORCX_VOZ_DB_CA         arquivo com o certificado da CA do Supabase (verificação completa do TLS)
"""
from __future__ import annotations

import json
import os
import re
import ssl
import threading
import urllib.error
import urllib.request

from voz import banco as B
from voz.analise import contrato as K_ANALISE

try:   # o driver só existe na imagem da VM (voz/requirements.txt); o resto do módulo não depende dele
    from pg8000.exceptions import InterfaceError as _ConexaoCaiu
except ImportError:   # pragma: no cover
    _ConexaoCaiu = OSError

MODOS = ("supabase_chave", "acesso_proprio")
SEGREDO_SENHA = "motorcx-voz-db-senha"
FUNCAO_ARQUIVOS = "voz-arquivos"

# tabela que o código da voz pede -> view do schema voz_vm (só leitura)
LEITURA = {
    "voz_config": "config", "voz_troncos": "troncos", "voz_rotas": "rotas", "voz_transferencias": "transferencias",
    "voz_contrato": "contrato", "voz_roteiros": "roteiros_em_uso", "voz_divisao_concorrencia": "divisao_concorrencia",
    "empresas": "empresas", "credores": "carteiras", "voz_chamadas": "chamadas_tarifacao",
    # SQL 58 · executor do fluxo: conectores ativos (segredo_ref é o nome no Secret Manager), hosts e base revisada
    "crm_conectores": "crm_conectores", "crm_hosts_permitidos": "crm_hosts_permitidos",
    "voz_base_respostas": "base_respostas",
}
# tabela -> função de escrita do schema voz_vm (o upsert é dela)
ESCRITA = {
    "voz_chamadas": "gravar_chamadas", "consumo_voz": "gravar_consumo", "voz_gravacoes": "gravar_gravacoes",
    "fornecedor_saude": "gravar_saude", "voz_lotes": "gravar_lotes", "voz_ondas": "gravar_ondas",
    "voz_fluxo_passos": "gravar_fluxo_passos", "crm_chamadas": "gravar_crm_chamadas",    # SQL 58 (só códigos)
    "voz_trechos": "gravar_trechos", "voz_curadoria_itens": "gravar_curadoria",           # SQL 60 (Speech Analytics)
}
# RPC do public que a VM chama -> função de voz_vm com os mesmos argumentos (um objeto jsonb, como o corpo do
# PostgREST) e a mesma forma de resposta (lista, objeto, valor ou null). RPC fora daqui é recusada.
RPC = {
    "fluxo_voz_em_uso": "fluxo_em_uso", "alcada_voz_vigente": "alcada_vigente",                   # SQL 58 · executor
    "pegar_pedido_fluxo_voz": "pegar_pedido_fluxo", "registrar_geracao_fluxo_voz": "registrar_geracao_fluxo",
    "anexos_fluxo_vencidos": "anexos_fluxo_vencidos", "marcar_anexos_apagados": "marcar_anexos_apagados",   # geração
    "pegar_roleplay_voz": "pegar_roleplay", "registrar_roleplay_conversa": "registrar_roleplay_conversa",  # SQL 59
    "concluir_roleplay_lote": "concluir_roleplay_lote",
    "buscas_voz_pendentes": "buscas_voz_pendentes", "responder_busca_voz": "responder_busca_voz",   # SQL 60
    "registrar_uso_ia_voz": "registrar_uso_ia_voz",
    # SQL 62 · dados do Speech Analytics (avaliador, extrator, job noturno e retroalimentação pela VM)
    "speech_contexto_voz": "speech_contexto", "gravar_analise_voz": "gravar_analise_voz",
    "agregar_speech_dia": "agregar_speech_dia", "speech_empresas_voz": "speech_empresas",
    "dados_retroalimentacao_voz": "dados_retroalimentacao", "registrar_recomendacao_voz": "registrar_recomendacao_voz",
    "conferir_rascunhos_recomendacoes": "conferir_rascunhos_recomendacoes",
    "recomendacoes_aplicadas_voz": "recomendacoes_aplicadas", "gravar_impacto_voz": "gravar_impacto",
    "avisar_alertas_voz": "avisar_alertas",
    # SQL 64 · importador das gravações do discador do cliente e o registro da transcrição (worker Whisper)
    "importacao_voz_pendente": "importacao_pendente", "iniciar_importacao_voz": "iniciar_importacao",
    "arquivos_lidos_importacao_voz": "arquivos_lidos_importacao", "preparar_importacao_voz": "preparar_importacao",
    "registrar_importacao_voz": "registrar_importacao", "registrar_arquivo_importacao_voz": "registrar_arquivo_importacao",
    "concluir_importacao_voz": "concluir_importacao", "marcar_envio_gravacoes_apagado": "marcar_envio_apagado",
    "registrar_transcricao_voz": "registrar_transcricao",
}
# a chave do upsert de gravar_chamadas e gravar_consumo é a de voz/banco.py › CONFLITO (o on_conflict do modo
# chave): conflito diferente é erro aqui também, para os dois acessos gravarem igual
DEVOLVE_ID = ("voz_lotes", "voz_ondas")

COLUNA = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")
OPERADORES = {"eq": "=", "neq": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}


class AcessoNegado(PermissionError):
    """Operação que o acesso próprio da VM não tem (e o banco também recusaria)."""


class ErroArquivo(RuntimeError):
    pass


# ------------------------------------------------------------------ filtros no formato do PostgREST -> SQL
def _coluna(c: str) -> str:
    if not COLUNA.match(c or ""):
        raise ValueError(f"coluna inválida: {c!r}")
    return f'"{c}"'


def _condicao(col: str, expr: str, params: dict) -> str:
    op, _, val = expr.partition(".")
    nome = f"p{len(params)}"
    if op in OPERADORES:
        params[nome] = val
        return f"{_coluna(col)} {OPERADORES[op]} :{nome}"
    if op == "in":
        if not (val.startswith("(") and val.endswith(")")):
            raise ValueError(f"filtro in inválido: {expr!r}")
        params[nome] = [x.strip().strip('"') for x in val[1:-1].split(",") if x.strip()]
        return f"{_coluna(col)}::text = any(cast(:{nome} as text[]))"
    if op == "is" and val in ("null", "true", "false"):
        return f"{_coluna(col)} is {val}"
    if op == "not" and val in ("is.null", "is.true", "is.false"):
        return f"{_coluna(col)} is not {val[3:]}"
    raise ValueError(f"filtro não suportado: {col}={expr!r}")


def _e(grupo: str, params: dict) -> list[str]:
    """and=(col.op.val,col.op.val) -> condições (valores sem vírgula, como os que a voz usa)."""
    if not (grupo.startswith("(") and grupo.endswith(")")):
        raise ValueError(f"grupo and inválido: {grupo!r}")
    saida = []
    for parte in grupo[1:-1].split(","):
        col, _, expr = parte.partition(".")
        saida.append(_condicao(col, expr, params))
    return saida


def _ordem(ordem: str) -> str:
    itens = []
    for x in ordem.split(","):
        partes = x.strip().split(".")
        sentido = {"asc": "asc", "desc": "desc"}.get(partes[1] if len(partes) > 1 else "asc")
        nulos = {"nullsfirst": " nulls first", "nullslast": " nulls last"}.get(partes[2] if len(partes) > 2 else "", "")
        if sentido is None or len(partes) > 3:
            raise ValueError(f"ordem inválida: {ordem!r}")
        itens.append(f"{_coluna(partes[0])} {sentido}{nulos}")
    return ", ".join(itens)


def montar_select(tabela: str, filtros: dict | None = None, ordem: str | None = None,
                  limite: int | None = None) -> tuple[str, dict]:
    if tabela not in LEITURA:
        raise AcessoNegado(f"a VM de voz não lê {tabela}")
    params: dict = {}
    conds, deslocamento = [], 0
    for k, v in (filtros or {}).items():
        if k == "offset":
            deslocamento = int(v)
        elif k == "and":
            conds += _e(v, params)
        elif k in ("select", "order", "limit"):
            raise ValueError(f"use os parâmetros de selecionar(), não o filtro {k}")
        else:
            conds.append(_condicao(k, v, params))
    sql = f"select to_jsonb(t) from voz_vm.{LEITURA[tabela]} t"
    if conds:
        sql += " where " + " and ".join(conds)
    if ordem:
        sql += " order by " + _ordem(ordem)
    if limite:
        sql += f" limit {int(limite)}"
    if deslocamento:
        sql += f" offset {int(deslocamento)}"
    return sql, params


# ------------------------------------------------------------------ o acesso próprio
class AcessoProprio:
    """Postgres direto (papel motorcx_voz) + Edge Function voz-arquivos. Mesma interface da classe Supabase."""

    def __init__(self, conectar, url_supabase: str = "", abrir=urllib.request.urlopen, tentativas: int = 2):
        """conectar(): devolve uma conexão nova (pg8000.native.Connection ou igual: run(sql, **params), close())."""
        self._conectar, self._conn = conectar, None
        self.url = (url_supabase or "").rstrip("/")
        self._abrir = abrir
        self.tentativas = tentativas
        # uma conexão só, e o roleplay (SQL 59) grava as conversas de várias threads: um comando de cada vez
        self._trava = threading.RLock()

    # ---------------------------------------------------------- banco
    def _run(self, sql: str, **params):
        with self._trava:
            for tentativa in range(self.tentativas):
                if self._conn is None:
                    self._conn = self._conectar()
                try:
                    return self._conn.run(sql, **params)
                except (_ConexaoCaiu, OSError):         # conexão caiu (pooler reiniciou, rede): reconecta
                    self.fechar()
                    if tentativa + 1 >= self.tentativas:
                        raise

    def fechar(self) -> None:
        with self._trava:
            if self._conn is not None:
                try:
                    self._conn.close()
                except Exception:   # noqa: BLE001 — já estava fechada
                    pass
                self._conn = None

    def selecionar(self, tabela, filtros: dict | None = None, ordem: str | None = None, limite: int | None = None):
        sql, params = montar_select(tabela, filtros, ordem, limite)
        return [r[0] for r in self._run(sql, **params) or []]

    def inserir(self, tabela, linhas, conflito: str | None = None, retornar=False, lote=1000):
        linhas = linhas if isinstance(linhas, list) else [linhas]
        if tabela == "envios":
            feitos = [self._registrar_retorno(l) for l in linhas]
            return feitos if retornar else []
        if tabela not in ESCRITA:
            raise AcessoNegado(f"a VM de voz não grava em {tabela}")
        chave = B.conflito(tabela) if tabela in B.CONFLITO else K_ANALISE.CONFLITO.get(tabela)
        if conflito and chave and conflito.replace(" ", "") != chave:
            raise ValueError(f"{tabela}: o upsert do acesso próprio é por ({chave}), não ({conflito})")
        saida = []
        for i in range(0, len(linhas), lote):
            corpo = json.dumps(linhas[i:i + lote], default=str, ensure_ascii=False)
            if tabela in DEVOLVE_ID:
                saida += [{"id": r[0]} for r in self._run(f"select id from voz_vm.{ESCRITA[tabela]}(cast(:l as jsonb))",
                                                          l=corpo) or []]
            else:
                self._run(f"select voz_vm.{ESCRITA[tabela]}(cast(:l as jsonb))", l=corpo)
        return saida if retornar else []

    def _registrar_retorno(self, l: dict) -> dict:
        if l.get("tipo") != "retorno" or l.get("status", "pendente") != "pendente":
            raise AcessoNegado("a VM de voz só registra envio do tipo retorno, pendente")
        r = self._run("select voz_vm.registrar_retorno(cast(:e as bigint), cast(:c as bigint), :caminho, :nome, "
                      "cast(:por as uuid))", e=str(l["empresa_id"]),
                      c=None if l.get("credor_id") is None else str(l["credor_id"]),
                      caminho=l["caminho"], nome=l["nome_original"], por=l["enviado_por"])
        return {"id": r[0][0]}

    def atualizar(self, tabela, filtros, valores):
        raise AcessoNegado("a VM de voz não atualiza tabela direto (só pelas funções de voz_vm)")

    def apagar(self, tabela, filtros):
        raise AcessoNegado("a VM de voz não apaga linha")

    def rpc(self, funcao, args=None):
        """Só as RPCs de RPC, pela função equivalente de voz_vm; devolve o que o PostgREST devolveria."""
        if funcao not in RPC:
            raise AcessoNegado(f"a VM de voz não chama a RPC {funcao}")
        r = self._run(f"select voz_vm.{RPC[funcao]}(cast(:a as jsonb))",
                      a=json.dumps(args or {}, default=str, ensure_ascii=False))
        return r[0][0] if r else None

    # ---------------------------------------------------------- arquivos (bilhete + Edge Function)
    def _bilhete(self, operacao: str, bucket: str, caminho: str) -> str:
        return self._run("select voz_vm.bilhete_arquivo(:o, :b, :c)", o=operacao, b=bucket, c=caminho)[0][0]

    def _arquivo(self, operacao: str, bucket: str, caminho: str, corpo: bytes | None = None,
                 tipo: str = "text/csv") -> bytes:
        if not self.url.startswith("https://"):
            raise ErroArquivo("defina MOTORCOB_SUPABASE_URL (https://<ref>.supabase.co) para os arquivos")
        cab = {"x-voz-bilhete": self._bilhete(operacao, bucket, caminho), "x-voz-operacao": operacao}
        if corpo is not None:
            cab["Content-Type"] = tipo
        req = urllib.request.Request(f"{self.url}/functions/v1/{FUNCAO_ARQUIVOS}", data=corpo or b"", method="POST",
                                     headers=cab)
        try:
            with self._abrir(req, timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as ex:   # nunca repassa o corpo (pode ecoar dados); só o status
            raise ErroArquivo(f"{operacao} em {bucket} -> HTTP {ex.code}") from None

    def baixar(self, bucket, caminho) -> bytes:
        return self._arquivo("baixar", bucket, caminho)

    def enviar(self, bucket, caminho, conteudo: bytes, tipo="text/csv"):
        self._arquivo("enviar", bucket, caminho, conteudo, tipo)

    def apagar_arquivos(self, bucket, caminhos: list[str]):
        for c in caminhos:
            self._arquivo("apagar", bucket, c)

    def listar(self, bucket, prefixo):
        raise AcessoNegado("a VM de voz não lista buckets")


# ------------------------------------------------------------------ escolha pelo ambiente da VM
def modo_do_ambiente(ambiente=None) -> str:
    amb = os.environ if ambiente is None else ambiente
    modo = (amb.get("MOTORCX_VOZ_ACESSO") or "supabase_chave").strip()
    if modo not in MODOS:
        raise ValueError(f"MOTORCX_VOZ_ACESSO deve ser {' ou '.join(MODOS)}")
    return modo


def contexto_tls(ca: str | None) -> ssl.SSLContext:
    """TLS sempre verificado (certificado e nome do host); com a CA do Supabase quando informada."""
    ctx = ssl.create_default_context(cafile=ca or None)
    ctx.check_hostname = True
    ctx.verify_mode = ssl.CERT_REQUIRED
    return ctx


def conector_do_ambiente(ambiente=None, segredos=None):
    """Função que abre uma conexão nova do papel motorcx_voz pelo pooler (senha do Secret Manager, só em memória)."""
    amb = os.environ if ambiente is None else ambiente
    host, usuario = amb.get("MOTORCX_VOZ_DB_HOST", ""), amb.get("MOTORCX_VOZ_DB_USUARIO", "")
    if not host or not re.match(r"^motorcx_voz\.[a-z0-9]{10,40}$", usuario):
        raise ValueError("acesso_proprio: defina MOTORCX_VOZ_DB_HOST e MOTORCX_VOZ_DB_USUARIO=motorcx_voz.<ref>")
    porta = int(amb.get("MOTORCX_VOZ_DB_PORTA") or 5432)
    banco = amb.get("MOTORCX_VOZ_DB_BANCO") or "postgres"
    ctx = contexto_tls(amb.get("MOTORCX_VOZ_DB_CA"))
    if segredos is None:
        from voz.segredos import SecretManager
        segredos = SecretManager()

    def conectar():
        import pg8000.native
        senha = segredos.valor(SEGREDO_SENHA)
        try:
            return pg8000.native.Connection(usuario, host=host, port=porta, database=banco, password=senha,
                                            ssl_context=ctx, timeout=30, application_name="motorcx-voz")
        finally:
            del senha
    return conectar


def conectar_do_ambiente(ambiente=None, segredos=None):
    """O cliente do banco da VM, conforme MOTORCX_VOZ_ACESSO (mesma interface nos dois modos)."""
    amb = os.environ if ambiente is None else ambiente
    if modo_do_ambiente(amb) == "acesso_proprio":
        return AcessoProprio(conector_do_ambiente(amb, segredos), amb.get("MOTORCOB_SUPABASE_URL", ""))
    from nuvem.supabase_api import Supabase
    return Supabase(amb.get("MOTORCOB_SUPABASE_URL", ""), amb.get("MOTORCOB_SUPABASE_KEY", ""))
