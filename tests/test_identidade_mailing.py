"""Identidade pelo arquivo (mailing) do agente de voz (SQL 88), no motor, na nuvem e na VM.

Motor: o código (HMAC com domínio, id e pergunta), a normalização (data inválida não vira código), a chave (nunca no
repr), o risco R1 (colunas de validação nunca viram atributo nem prévia) e base/identidade.csv só com códigos de quem
está na carga. Nuvem: só a lista de hoje do agente vai ao banco, nunca o valor. VM: a fonte interna manda só o código;
o executor com a configuração (fontes em ordem, N perguntas, "não confere" não troca de fonte, limite do dia) e,
sem configuração, exatamente o de hoje. Só dados fictícios; a chave dos testes é gerada aqui.
"""
import csv
import json
import secrets
import tempfile
import unittest
from datetime import date
from pathlib import Path

from motor import identidade_mailing as IM
from motor.entrada import LayoutBase, converter_base
from motor import previa as PV
from voz import conector as CN
from voz import fluxo as FX
from voz import fluxo_casos as C
from voz import fluxo_validador as FV
from voz.segredos import Dicionario

HOJE = date(2026, 11, 8)
CHAVE_HEX = secrets.token_hex(32)
CHAVE = IM.Chave(7, 3, bytes.fromhex(CHAVE_HEX))
CFG = {"fonte": "crm_arquivo", "perguntas": ["dia_mes_nascimento", "ultimos3_documento"], "quantas": 2,
       "se_faltar": "proxima", "erros_dia": 4}


class TestCodigo(unittest.TestCase):
    def test_codigo_tem_dominio_id_e_pergunta(self):
        a = IM.codigo(CHAVE, "C1", "dia_mes_nascimento", "1503")
        self.assertRegex(a, r"^[0-9a-f]{32}$")
        self.assertEqual(a, IM.codigo(CHAVE, "C1", "dia_mes_nascimento", "1503"))
        self.assertNotEqual(a, IM.codigo(CHAVE, "C2", "dia_mes_nascimento", "1503"))     # mesmo aniversário, outro código
        self.assertNotEqual(a, IM.codigo(CHAVE, "C1", "ano_nascimento", "1503"))
        self.assertNotEqual(a, IM.codigo(IM.Chave(7, 4, secrets.token_bytes(32)), "C1", "dia_mes_nascimento", "1503"))
        self.assertNotEqual(a, IM.codigo(IM.Chave(8, 3, CHAVE.segredo), "C1", "dia_mes_nascimento", "1503"))

    def test_chave_nunca_aparece(self):
        self.assertNotIn(CHAVE_HEX, repr(CHAVE))
        self.assertNotIn(CHAVE_HEX, str(CHAVE))

    def test_chave_do_ambiente(self):
        import base64
        self.assertIsNone(IM.chave_do_ambiente(7, {}))
        ch = IM.chave_do_ambiente(7, {"MOTORCX_IDENTIDADE_E7": f"3:{CHAVE_HEX}"})
        self.assertEqual((ch.empresa, ch.versao, ch.segredo), (7, 3, CHAVE.segredo))
        b64 = base64.b64encode(CHAVE_HEX.encode()).decode()            # como o gcloud mostra o payload
        self.assertEqual(IM.chave_do_ambiente(7, {"MOTORCX_IDENTIDADE_E7": f"5:{b64}"}).segredo, CHAVE.segredo)
        for ruim in ("3", f"x:{CHAVE_HEX}", "3:curta", f"0:{CHAVE_HEX}"):
            with self.assertRaises(IM.ChaveInvalida) as cm:
                IM.chave_do_ambiente(7, {"MOTORCX_IDENTIDADE_E7": ruim})
            self.assertNotIn(CHAVE_HEX, str(cm.exception))

    def test_data_de_nascimento(self):
        self.assertEqual(IM.data_nascimento("15/03/1980", HOJE), date(1980, 3, 15))
        self.assertEqual(IM.data_nascimento("1980-03-15", HOJE), date(1980, 3, 15))
        self.assertEqual(IM.data_nascimento("15-03-1980 00:00", HOJE), date(1980, 3, 15))
        for ruim in ("31/02/1980", "15/03/2030", "15/03/2020", "01/01/1900", "abc", ""):
            self.assertIsNone(IM.data_nascimento(ruim, HOJE), ruim)

    def test_ultimos3(self):
        self.assertEqual(IM.ultimos3("529.982.247-25"), "725")
        self.assertEqual(IM.ultimos3("45"), "045")                     # a planilha comeu o zero
        self.assertEqual(IM.ultimos3("12.345.678/0001-95"), "195")
        self.assertIsNone(IM.ultimos3("12345"))
        self.assertIsNone(IM.ultimos3(""))


def _carga(pasta: Path, linhas: list[dict], cab: list[str]) -> Path:
    arq = pasta / "carga_2026-11-08.csv"
    with open(arq, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cab, delimiter=";")
        w.writeheader()
        w.writerows(linhas)
    return arq


CAB = ["COD", "CPF", "SALDO", "ATRASO", "TEL", "DT_NASC", "ULT3_DOC", "UF"]
LINHAS = [
    {"COD": "C1", "CPF": "529.982.247-25", "SALDO": "100,00", "ATRASO": "30", "TEL": "11987654321",
     "DT_NASC": "15/03/1980", "ULT3_DOC": "725", "UF": "SP"},
    {"COD": "C2", "CPF": "", "SALDO": "200,00", "ATRASO": "40", "TEL": "11987654322",
     "DT_NASC": "31/02/1980", "ULT3_DOC": "", "UF": "RJ"},
]


class TestCarga(unittest.TestCase):
    def _converter(self, colunas, chave):
        tmp = Path(tempfile.mkdtemp())
        arq = _carga(tmp, LINHAS, CAB)
        lay = LayoutBase(colunas={"id_cliente": "COD", "cpf": "CPF", "saldo": "SALDO", "dias_atraso": "ATRASO",
                                  **colunas}, telefones=["TEL"])
        rel = converter_base([arq], lay, tmp / "base", identidade=chave)
        return tmp / "base", rel

    def test_colunas_mapeadas_nunca_viram_atributo(self):
        base, rel = self._converter({"nascimento": "DT_NASC", "documento_validacao": "ULT3_DOC"}, CHAVE)
        cab = (base / "atributos.csv").read_text(encoding="utf-8").splitlines()[0].split(";")
        self.assertNotIn("DT_NASC", cab)
        self.assertNotIn("ULT3_DOC", cab)
        self.assertIn("UF", cab)
        self.assertIn("idade", cab)                                       # a idade continua (calculada)
        self.assertNotIn("ULT3_DOC", rel["colunas"])

    def test_identidade_csv_so_com_codigos_de_quem_esta_na_carga(self):
        base, rel = self._converter({"nascimento": "DT_NASC", "documento_validacao": "ULT3_DOC"}, CHAVE)
        texto = (base / "identidade.csv").read_text(encoding="utf-8")
        for valor in ("1503", "1980", "725", "15/03/1980", "529"):
            self.assertNotIn(valor, texto.replace(IM.codigo(CHAVE, "C1", "dia_mes_nascimento", "1503"), ""))
        linhas = IM.ler(base)
        self.assertEqual({(l["id_cliente"], l["pergunta"]) for l in linhas},
                         {("C1", "dia_mes_nascimento"), ("C1", "ano_nascimento"), ("C1", "ultimos3_documento")})
        self.assertEqual(next(l["codigo"] for l in linhas if l["pergunta"] == "ultimos3_documento"),
                         IM.codigo(CHAVE, "C1", "ultimos3_documento", "725"))
        self.assertEqual({l["versao"] for l in linhas}, {"3"})
        r = rel["identidade"]
        self.assertEqual((r["nascimento_validas"], r["nascimento_invalidas"], r["documento_validos"],
                          r["clientes_com_codigo"], r["chave"]), (1, 1, 1, 1, True))
        self.assertNotIn("1980", json.dumps(r))

    def test_usar_o_cpf_ja_apontado(self):
        base, _ = self._converter({"nascimento": "DT_NASC", "documento_validacao": "CPF"}, CHAVE)
        cod = next(l["codigo"] for l in IM.ler(base) if l["pergunta"] == "ultimos3_documento")
        self.assertEqual(cod, IM.codigo(CHAVE, "C1", "ultimos3_documento", "725"))

    def test_sem_chave_so_conta_e_nao_guarda(self):
        base, rel = self._converter({"nascimento": "DT_NASC"}, None)
        self.assertFalse((base / "identidade.csv").exists())
        self.assertEqual((rel["identidade"]["chave"], rel["identidade"]["nascimento_validas"]), (False, 1))

    def test_sem_colunas_mapeadas_nada_muda(self):
        base, rel = self._converter({}, CHAVE)
        self.assertEqual(IM.ler(base), [])
        self.assertFalse(any(rel["identidade"]["colunas"].values()))

    def test_previa_nunca_publica_nome_de_validacao(self):
        sim, nao = PV.colunas_publicaveis({"ULT3_DOC": ["1", "2"], "DIG_CPF": ["1"], "DT_NASC": ["x"], "UF": ["SP"]})
        self.assertEqual(sim, ["UF"])


class TestDetectar(unittest.TestCase):
    def test_layout_leva_as_colunas_apontadas(self):
        from motor import detectar as D
        tmp = Path(tempfile.mkdtemp())
        arq = _carga(tmp, LINHAS, CAB)
        lay = D.layout_base(arq, {}, {"id_cliente": "COD", "cpf": "CPF", "nascimento": "DT_NASC",
                                      "documento_validacao": "CPF"})
        self.assertEqual((lay["colunas"]["nascimento"], lay["colunas"]["documento_validacao"]), ("DT_NASC", "CPF"))
        self.assertNotIn("DT_NASC", [t["coluna"] for t in lay["telefones"]])
        lay2 = D.layout_base(arq, {}, {"id_cliente": "COD"})
        self.assertNotIn("nascimento", lay2["colunas"])                   # nunca pela detecção


class SbPublicar:
    def __init__(self, usa=True):
        self.chamadas, self.usa = [], usa

    def rpc(self, nome, args):
        self.chamadas.append((nome, args))
        return {"gravados": len(args["linhas"]) if self.usa else 0, "apagados": 0, "usa_arquivo": self.usa}


class TestPublicar(unittest.TestCase):
    def _pasta(self):
        tmp = Path(tempfile.mkdtemp())
        (tmp / "base").mkdir()
        IM.gravar(tmp / "base", [{"id_cliente": i, "pergunta": "dia_mes_nascimento",
                                  "codigo": IM.codigo(CHAVE, i, "dia_mes_nascimento", "1503"), "versao": 3}
                                 for i in ("C1", "C2", "C3")])
        (tmp / "saida" / "ids").mkdir(parents=True)
        (tmp / "saida" / "ids" / "agente_voz.csv").write_text("id_cliente;contato\nC1;11987654321\nC3;11987654323\n")
        (tmp / "saida" / "ids" / "sms.csv").write_text("id_cliente;contato\nC2;11987654322\n")
        return tmp

    def test_so_a_lista_de_hoje_do_agente(self):
        from nuvem import identidade_voz as NV
        tmp = self._pasta()
        sb = SbPublicar()
        self.assertIsNone(NV.publicar(sb, 7, 5, tmp, HOJE, tmp / "saida", out=lambda *_: None))
        (nome, a), = sb.chamadas
        self.assertEqual(nome, "publicar_identidade_voz")
        self.assertEqual({l["id_cliente"] for l in a["linhas"]}, {"C1", "C3"})
        self.assertTrue(a["substituir"])
        self.assertEqual(set(a["linhas"][0]), {"id_cliente", "pergunta", "codigo", "versao"})

    def test_lista_vazia_tambem_limpa(self):
        from nuvem import identidade_voz as NV
        tmp = self._pasta()
        (tmp / "saida" / "ids" / "agente_voz.csv").unlink()
        sb = SbPublicar()
        NV.publicar(sb, 7, 5, tmp, HOJE, tmp / "saida", out=lambda *_: None)
        self.assertEqual(sb.chamadas[0][1]["linhas"], [])

    def test_alerta_sem_chave(self):
        from nuvem import identidade_voz as NV
        self.assertIn("motorcx-voz-identidade-e7", NV.alerta_da_carga(
            {"identidade": {"colunas": {"nascimento": True}, "chave": False}}, 7))
        self.assertIsNone(NV.alerta_da_carga({"identidade": {"colunas": {"nascimento": False}, "chave": False}}, 7))


# ------------------------------------------------------------------ VM
class SbIdentidade:
    """O banco de mentira: guarda códigos e compara como conferir_identidade_voz (a VM só vê a palavra)."""

    def __init__(self, guardados: dict, erros_dia=4, bloqueado=False, falhar=False):
        self.guardados, self.erros, self.erros_dia, self.bloq, self.falhar = guardados, 0, erros_dia, bloqueado, falhar
        self.pedidos = []

    def rpc(self, nome, a):
        self.pedidos.append((nome, dict(a)))
        if self.falhar:
            raise RuntimeError("banco fora")
        if nome == "abrir_identidade_voz":
            return {"disponiveis": sorted({p for (_, p) in self.guardados}), "bloqueado": self.bloq}
        if nome == "conferir_identidade_voz":
            if self.erros >= self.erros_dia:
                return "bloqueado"
            g = self.guardados.get((a["id_cliente"], a["pergunta"]))
            if g is None:
                return "sem_dado"
            if g == a["codigo"]:
                return "identidade_ok"
            self.erros += 1
            return "identidade_nao_confere"
        raise AssertionError(nome)


def _guardados(idc="CLI-TESTE", dm="1503", d3="725"):
    out = {}
    if dm:
        out[(idc, "dia_mes_nascimento")] = IM.codigo(CHAVE, idc, "dia_mes_nascimento", dm)
    if d3:
        out[(idc, "ultimos3_documento")] = IM.codigo(CHAVE, idc, "ultimos3_documento", d3)
    return out


def _fonte(sb):
    return CN.FonteArquivo(sb, Dicionario({"voz/identidade/e7": CHAVE_HEX}))


def _con_validar(match=True):
    return {2: CN.Conector(2, 7, "Validar", "validar_cadastro", "POST", "https://api.crm.exemplo.com.br/v/{id_cliente}",
                           "bearer", "crm/1/x", ({"origem": "id_cliente", "destino": "id_cliente", "onde": "path"},),
                           ({"origem": "$.match", "destino": "codigo", "grava": "codigo",
                             "valores": {"true": "identidade_ok", "false": "identidade_nao_confere"}},),
                           {}, 2500, 0, False, "ramo", "ativo", 1, {"match": match})}


def _fluxo(cfg=CFG, sb=None, validar=True, match=True, definicao=None):
    d = definicao or C.negociador(validar=C.C_VALIDAR if validar else None)
    # a versão usada aqui (identidade e logo depois encerra), suficiente para ver o caminho
    return FX.FluxoCarregado(10, d, _con_validar(match) if validar else {}, CN.Alcada(20, 6, 50),
                             identidade=cfg, fonte_interna=_fonte(sb) if sb is not None else None,
                             empresa_id=7, credor_id=5)


VARS = {"primeiro_nome": "Ana", "assessoria": "Aurora", "credor": "Varejo Aurora", "saldo": "1380,00"}


def _sim(falas, f, **k):
    return FX.simular(f, falas, VARS, hoje=HOJE, **k)


class TestFonteArquivo(unittest.TestCase):
    def test_manda_so_o_codigo(self):
        sb = SbIdentidade(_guardados())
        r = _fonte(sb).conferir(7, 5, "CLI-TESTE", "ch-0001", "dia_mes_nascimento", "1503")
        self.assertEqual((r.classe, r.codigo), ("ok", "identidade_ok"))
        nome, a = sb.pedidos[0]
        self.assertEqual(set(a), {"empresa", "credor", "id_cliente", "id_chamada", "pergunta", "codigo", "versao"})
        self.assertNotIn("1503", json.dumps(a))
        self.assertEqual(a["versao"], 1)                                   # versão do cofre (Dicionario = 1)

    def test_banco_fora_e_sem_chave(self):
        self.assertEqual(_fonte(SbIdentidade({}, falhar=True)).conferir(7, 5, "C", "ch-1", "ano_nascimento", "1980").classe,
                         "tempo")
        r = CN.FonteArquivo(SbIdentidade({}), Dicionario({})).conferir(7, 5, "C", "ch-1", "ano_nascimento", "1980")
        self.assertEqual(r.classe, "recusado")
        self.assertIsNone(_fonte(SbIdentidade({}, falhar=True)).abrir(7, 5, "C", "ch-1"))


class TestExecutor(unittest.TestCase):
    def test_sem_configuracao_e_o_de_hoje(self):
        """Paridade: identidade=None percorre exatamente o caminho de hoje (mesmos passos, conectores e falas)."""
        from tests.test_voz_fluxo import fluxo as fluxo_hoje, simular as simular_hoje
        for falas in (["Sou eu", "15 de março"], ["Sou eu", "15 de março", "16 de março"], ["Sou eu", "não sei", "x"]):
            a = simular_hoje(falas)
            b = simular_hoje(falas, f=fluxo_hoje(identidade=None))
            self.assertEqual(json.dumps(a, default=str, sort_keys=True), json.dumps(b, default=str, sort_keys=True))

    def test_arquivo_confere_as_duas_perguntas(self):
        sb = SbIdentidade(_guardados())
        cfg = dict(CFG, fonte="arquivo")
        r = _sim(["Sou eu", "15 de março", "7 2 5"], _fluxo(cfg, sb, validar=False))
        self.assertEqual(r["caminho"][:3], ["N1", "N2", "N3"])
        self.assertIn("três últimos números", r["turnos"][2]["falas"][0]["texto"])
        self.assertIn("1380,00", r["turnos"][-1]["falas"][0]["texto"])     # dívida só depois das duas
        self.assertEqual([n for n, _ in sb.pedidos], ["abrir_identidade_voz", "conferir_identidade_voz",
                                                      "conferir_identidade_voz"])

    def test_nao_confere_nao_troca_de_fonte(self):
        """arquivo_crm: o arquivo diz "não confere" duas vezes → não confirmou; o CRM (que diria ok) nem é chamado."""
        sb = SbIdentidade(_guardados())
        r = _sim(["Sou eu", "16 de março", "17 de março"], _fluxo(dict(CFG, fonte="arquivo_crm"), sb))
        self.assertEqual(r["caminho"], ["N1", "N2", "N14"])
        self.assertEqual(r["conectores"], [])                              # nenhum evento do CRM
        self.assertEqual(sb.erros, 2)

    def test_crm_falha_e_o_arquivo_confere_a_mesma_resposta(self):
        sb = SbIdentidade(_guardados())
        r = _sim(["Sou eu", "15 de março", "725"], _fluxo(CFG, sb), falhar={2})
        self.assertEqual(r["caminho"][:3], ["N1", "N2", "N3"])
        self.assertEqual(len(r["turnos"]), 4)                              # a pessoa não repetiu a data
        self.assertEqual(r["conectores"][0]["classe"], "tempo")

    def test_crm_nao_confere_nao_vai_para_o_arquivo(self):
        sb = SbIdentidade(_guardados())
        r = _sim(["Sou eu", "15 de março", "15 de março"], _fluxo(CFG, sb, match=False))
        self.assertEqual(r["caminho"], ["N1", "N2", "N14"])
        self.assertNotIn("conferir_identidade_voz", [n for n, _ in sb.pedidos])

    def test_sem_dado_no_arquivo_vai_para_o_crm(self):
        sb = SbIdentidade(_guardados(dm=None))                             # sem data: com "proxima", o CRM pergunta
        r = _sim(["Sou eu", "15 de março", "725"], _fluxo(dict(CFG, fonte="arquivo_crm"), sb))
        self.assertEqual(r["caminho"][:3], ["N1", "N2", "N3"])
        self.assertEqual(len(r["conectores"]), 2)                          # as duas perguntas pelo CRM

    def test_menos_faz_so_a_que_tem_dado(self):
        sb = SbIdentidade(_guardados(dm=None))
        r = _sim(["Sou eu", "725"], _fluxo(dict(CFG, fonte="arquivo", se_faltar="menos"), sb, validar=False))
        self.assertEqual(r["caminho"][:3], ["N1", "N2", "N3"])

    def test_transferir_quando_falta_dado(self):
        sb = SbIdentidade(_guardados(dm=None))
        r = _sim(["Sou eu"], _fluxo(dict(CFG, fonte="arquivo", se_faltar="transferir"), sb, validar=False))
        self.assertTrue(r["turnos"][-1]["fim"].startswith("transferida"))

    def test_limite_do_dia_vai_para_atendente(self):
        sb = SbIdentidade(_guardados(), bloqueado=True)
        r = _sim(["Sou eu"], _fluxo(dict(CFG, fonte="arquivo"), sb, validar=False))
        self.assertTrue(r["turnos"][-1]["fim"].startswith("transferida"))
        self.assertNotIn("conferir_identidade_voz", [n for n, _ in sb.pedidos])

    def test_limite_atingido_no_meio(self):
        sb = SbIdentidade(_guardados(), erros_dia=1)
        r = _sim(["Sou eu", "16 de março", "15 de março"], _fluxo(dict(CFG, fonte="arquivo"), sb, validar=False))
        self.assertTrue(r["turnos"][-1]["fim"].startswith("transferida"))
        self.assertNotIn("N3", r["caminho"])

    def test_sem_fonte_nunca_confirma(self):
        r = _sim(["Sou eu", "15 de março"], _fluxo(dict(CFG, fonte="arquivo"), None, validar=False))
        self.assertNotIn("N3", r["caminho"])

    def test_log_sem_valor_nem_codigo(self):
        sb = SbIdentidade(_guardados())
        with self.assertLogs("motorcx.voz", level="DEBUG") as cm:
            _sim(["Sou eu", "15 de março", "7 2 5"], _fluxo(dict(CFG, fonte="arquivo"), sb, validar=False))
        texto = "\n".join(cm.output)
        self.assertIn("identidade: fonte=arquivo confirmou=sim", texto)
        for proibido in ("1503", "725", CHAVE_HEX, *(c for c in _guardados().values())):
            self.assertNotIn(proibido, texto)

    def test_config_identidade(self):
        self.assertEqual(FX.config_identidade(CFG), CFG)
        for ruim in (None, {}, dict(CFG, quantas=3), dict(CFG, fonte="ia"), dict(CFG, perguntas=["nome_mae"]),
                     dict(CFG, erros_dia=5), dict(CFG, perguntas=["dia_mes_nascimento"]), dict(CFG, extra=1),
                     dict(CFG, quantas=True)):
            self.assertIsNone(FX.config_identidade(ruim), ruim)


class TestValidador(unittest.TestCase):
    def test_identidade_sem_crm_com_arquivo(self):
        d = C.negociador(1, None, 3, 4)
        cons = {1: ("ativo", "buscar_ofertas"), 3: ("ativo", "registrar_acordo"), 4: ("ativo", "gerar_boleto")}
        self.assertIn("identidade_sem_conferencia:N2", FV.pendencias(d, cons, True, set(FX.SINONIMOS) | {
            "quero_negociar", "ja_paguei", "nao_reconheco", "sem_dinheiro"}))
        self.assertNotIn("identidade_sem_conferencia:N2", FV.pendencias(d, cons, True, set(), identidade_arquivo=True))


if __name__ == "__main__":
    unittest.main()
