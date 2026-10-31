"""PR 1 da discagem: a tabela única de desfechos de voz (motor/voz.py) não muda NADA. Paridade com os valores
que taxonomia.py, discagem.py e entrada.py tinham escritos à mão antes da tabela (copiados aqui literalmente)."""
import re
import unittest
from datetime import date
from pathlib import Path
from types import SimpleNamespace

from motor import discagem as DG
from motor import voz as V
from motor.entrada import GENERICOS
from motor.retorno_canal import MARCAS
from motor.taxonomia import CERT, ENGAJ, TAXONOMIA, TERCEIRO, Classificacao as C, Nivel

RAIZ = Path(__file__).resolve().parent.parent

ANTES_DISCADOR = {
    "numero_inexistente": C(Nivel.INVALIDO),
    "nao_atendida": C(Nivel.SEM_RETORNO),
    "caixa_postal": C(Nivel.ENTREGUE),
    "atendida_sem_cpc": C(Nivel.ENGAJADO, pro_titular=ENGAJ),
    "atendida_terceiro_desconhece": C(Nivel.ENGAJADO, contra_titular=TERCEIRO),
    "cpc": C(Nivel.CERTIFICADO, pro_titular=CERT),
    "promessa": C(Nivel.CERTIFICADO, pro_titular=CERT),
    "recusa": C(Nivel.CERTIFICADO, pro_titular=CERT),
    "recado": C(Nivel.ENGAJADO, pro_titular=ENGAJ),
    "ocupado": C(Nivel.SEM_RETORNO),
    "abandonada": C(Nivel.SEM_RETORNO),
    "falha_rede": C(Nivel.SEM_RETORNO, ignorar=True),
    "opt_out": C(Nivel.ENGAJADO, restricao="voz:opt_out"),
}
ANTES_AGENTE = {**ANTES_DISCADOR, "identidade_confirmada": C(Nivel.CERTIFICADO, pro_titular=CERT)}
ANTES_MARCA_VOZ = {"nao_atendida": "temporario", "ocupado": "temporario", "caixa_postal": "temporario",
                   "numero_inexistente": "inexistente",
                   "atendida_sem_cpc": "clique", "recado": "clique", "abandonada": "clique", "cpc": "clique",
                   "promessa": "clique", "recusa": "clique", "atendida_terceiro_desconhece": "clique",
                   "identidade_confirmada": "clique"}
ANTES_NAO_COMPLETADA = ("nao_atendida", "ocupado", "numero_inexistente", "falha_rede", "caixa_postal")
ANTES_NAO_ATENDE = ("nao_atendida", "ocupado", "caixa_postal")
ANTES_GENERICOS = {
    "cpc": {"discador": "cpc", "agente_voz": "cpc", "whatsapp": "identidade_confirmada",
            "rcs": "identidade_confirmada", "sms": "identidade_confirmada", "email": "identidade_confirmada"},
    "sem_contato": {"discador": "nao_atendida", "agente_voz": "nao_atendida", "whatsapp": "entregue",
                    "rcs": "entregue", "sms": "entregue", "email": "entregue"},
    "atendida_sem_cpc": {"discador": "atendida_sem_cpc", "agente_voz": "atendida_sem_cpc", "whatsapp": "lido",
                         "rcs": "lido", "sms": "entregue", "email": "abertura"},
    "terceiro": {"discador": "atendida_terceiro_desconhece", "agente_voz": "atendida_terceiro_desconhece",
                 "whatsapp": "desconhece", "rcs": "desconhece", "sms": "desconhece", "email": "desconhece"},
    "invalido": {"discador": "numero_inexistente", "agente_voz": "numero_inexistente", "whatsapp": "sem_conta",
                 "rcs": "nao_entregue", "sms": "nao_entregue", "email": "hard_bounce"},
    "opt_out": {"whatsapp": "bloqueio", "sms": "opt_out", "email": "descadastro",
                "discador": "opt_out", "agente_voz": "opt_out"},
    "promessa": {"discador": "promessa", "agente_voz": "promessa", "whatsapp": "identidade_confirmada",
                 "rcs": "identidade_confirmada", "sms": "identidade_confirmada", "email": "identidade_confirmada"},
    "recusa": {"discador": "recusa", "agente_voz": "recusa", "whatsapp": "identidade_confirmada",
               "rcs": "identidade_confirmada", "sms": "identidade_confirmada", "email": "identidade_confirmada"},
    "recado": {"discador": "recado", "agente_voz": "recado"},
    "ocupado": {"discador": "ocupado", "agente_voz": "ocupado"},
    "abandonada": {"discador": "abandonada", "agente_voz": "abandonada"},
    "falha_rede": {"discador": "falha_rede", "agente_voz": "falha_rede"},
}


def _e_curta_antes(e, cc):
    d = getattr(e, "duracao_s", None)
    if d is not None and d <= cc["segundos"]:
        return True
    if e.resultado in ANTES_NAO_COMPLETADA:
        return True
    return e.resultado == "abandonada" and cc["abandono_conta"]


class TestParidadeVoz(unittest.TestCase):
    def test_taxonomia_identica_e_na_mesma_ordem(self):
        self.assertEqual(TAXONOMIA["discador"], ANTES_DISCADOR)
        self.assertEqual(list(TAXONOMIA["discador"]), list(ANTES_DISCADOR))
        self.assertEqual(TAXONOMIA["agente_voz"], ANTES_AGENTE)
        self.assertEqual(list(TAXONOMIA["agente_voz"]), list(ANTES_AGENTE))
        self.assertEqual(list(TAXONOMIA), ["discador", "sms", "whatsapp", "rcs", "email", "agente_voz"])

    def test_renitencia_curtas_e_nao_atende(self):
        self.assertEqual(DG.MARCA_VOZ, ANTES_MARCA_VOZ)
        self.assertEqual(set(DG.NAO_COMPLETADA), set(ANTES_NAO_COMPLETADA))
        self.assertEqual(set(V.NAO_ATENDE), set(ANTES_NAO_ATENDE))
        self.assertEqual(V.CURTA_SE_ABANDONO, ("abandonada",))
        self.assertTrue(set(DG.MARCA_VOZ.values()) <= set(MARCAS))

    def test_e_curta_igual_em_todos_os_desfechos(self):
        for r in list(ANTES_AGENTE) + ["xpto"]:
            for dur in (None, 0, 6, 7, 120):
                for ab in (True, False):
                    cc = {"segundos": 6, "abandono_conta": ab}
                    e = SimpleNamespace(resultado=r, duracao_s=dur)
                    self.assertEqual(DG.e_curta(e, cc), _e_curta_antes(e, cc), (r, dur, ab))

    def test_modelo_curtas_conta_os_mesmos_nao_atende(self):
        hoje = date(2026, 10, 30)
        ev = [SimpleNamespace(canal="discador", data=date(2026, 10, 29), fornecedor="x", contato=f"119{i:08d}",
                              resultado=r, duracao_s=None) for i, r in enumerate(ANTES_AGENTE)]
        m = DG.ModeloCurtas(ev, hoje, DG.PADRAO)
        self.assertEqual({e.resultado for e in ev if m.nao_atende.get(e.contato)}, set(ANTES_NAO_ATENDE))

    def test_genericos_identicos(self):
        self.assertEqual(GENERICOS, ANTES_GENERICOS)

    def test_marcas_do_site_iguais_no_banco_e_na_tela(self):
        sql = (RAIZ / "supabase" / "migrations" / "20261017000001_mapeamento_arquivos.sql").read_text(encoding="utf-8")
        m = re.search(r"resultado\s+text check \(resultado in \(([^)]*)\)\)", sql)
        self.assertEqual(tuple(re.findall(r"'([^']+)'", m.group(1))), V.GENERICOS_SITE)
        tela = (RAIZ / "site" / "src" / "components" / "credores" / "configuracoes.tsx").read_text(encoding="utf-8")
        m = re.search(r"type ResultadoOcorrencia = ([^;]+);", tela)
        self.assertEqual(tuple(re.findall(r"'([^']+)'", m.group(1))), V.GENERICOS_SITE)
        self.assertTrue(set(V.GENERICOS_SITE) <= set(GENERICOS))

    def test_tabela_consistente(self):
        for d in V.DESFECHOS:
            self.assertIn(d.nivel, Nivel.__members__, d.chave)
            self.assertTrue(set(d.canais) <= set(V.CANAIS_VOZ), d.chave)
            self.assertIn(d.curta, (None, "sempre", "abandono"), d.chave)
            self.assertIn(d.marca, (None,) + MARCAS, d.chave)
            self.assertTrue(d.rotulo, d.chave)

    def test_cpc_padrao_igual_ao_playbook(self):
        import json
        contato = json.loads((RAIZ / "regras" / "regua.json").read_text(encoding="utf-8"))["contato"]
        for canal in V.CANAIS_VOZ:
            self.assertEqual(set(V.cpc_padrao(canal)), set(contato[canal]), canal)

    def test_hoje_todo_desfecho_conta_tentativa(self):
        """Mudar o que conta como tentativa é decisão do dono: a tabela ainda não muda nada."""
        self.assertTrue(all(d.conta_tentativa for d in V.DESFECHOS))
        self.assertNotIn("falha_rede", V.PROVA_EXISTENCIA)
        self.assertNotIn("numero_inexistente", V.PROVA_EXISTENCIA)
        self.assertNotIn("nao_atendida", V.PROVA_EXISTENCIA)
        self.assertIn("caixa_postal", V.PROVA_EXISTENCIA)


class TestConfirmacaoInexistente(unittest.TestCase):
    """Listas A/B/nunca do de-para do especialista (só dados: o motor ainda não lê causas)."""

    def test_tipo_a(self):
        t = V.tipo_confirmacao
        for sip, q in ((404, None), (404, 1), (410, None), (604, None), (None, 1), (None, 22), (503, 1), (403, 22)):
            self.assertEqual(t(sip, q), "A", (sip, q))

    def test_tipo_b_so_com_numero_canonico(self):
        t = V.tipo_confirmacao
        for sip, q in ((484, None), (485, None), (301, None), (None, 4), (None, 28)):
            self.assertEqual(t(sip, q), "B", (sip, q))
            self.assertIsNone(t(sip, q, canonico=False), (sip, q))
            self.assertIsNone(t(sip, q, aceita_tipo_b=False), (sip, q))

    def test_rota_e_aparelho_nunca_confirmam(self):
        t = V.tipo_confirmacao
        for q in (2, 3, 14, 127, 34, 38, 41, 42, 44, 47, 18, 20, 27, 31, 16):
            self.assertIsNone(t(404, q), q)
            self.assertIsNone(t(None, q), q)
        for sip in (403, 408, 480, 486, 488, 500, 502, 503, 603, 606, 608):
            self.assertIsNone(t(sip, None), sip)
        self.assertIsNone(t(None, None))

    def test_listas_sem_conflito(self):
        a, b = V.CONFIRMA_A_SIP | V.CONFIRMA_B_SIP, V.CONFIRMA_A_Q850 | V.CONFIRMA_B_Q850
        self.assertFalse(a & V.NUNCA_CONFIRMA_SIP)
        self.assertFalse(b & (V.NUNCA_CONFIRMA_Q850 | V.APARELHO_Q850))


if __name__ == "__main__":
    unittest.main()
