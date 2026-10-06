"""Retorno de canal: o status do fornecedor por número/e-mail oxigena os contatos — número morto,
em pausa ou bloqueado sai do canal e o próximo contato do cliente assume."""
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

import rodar_dia
from motor.retorno_canal import (Registro, avaliar, detectar_colunas, ler_arquivo, regras_de, sugerir_marca)

RAIZ = Path(__file__).resolve().parent.parent
EMPRESA = RAIZ / "empresas" / "exemplo.json"
CAB = "COD_CLIENTE;CONTRATO;CPF;SALDO_DEVEDOR;DT_VENCIMENTO;PRODUTO;UF;TEL1;WHATS_TEL1;TEL2;TEL3;EMAIL;BLOQUEIO\n"
HOJE = date(2026, 9, 2)
T1, T2, T3 = "11988880001", "11977770002", "11966660003"


def _csv(p: Path, texto: str) -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(texto, encoding="utf-8")
    return p


def R(contato, canal, marca, dias_atras=1, arq="dlr.csv"):
    return Registro(contato, canal, marca, HOJE - timedelta(days=dias_atras), arq)


class TestOxigenacao(unittest.TestCase):
    """O caso da operação: o cliente tem vários telefones; o 1º volta 'não entregue' no SMS → o SMS de
    hoje sai pelo 2º. Idem no e-mail: hard bounce no 1º e-mail → vai o próximo."""

    def _rodar(self, retornos=None, canal="sms"):
        tmp = Path(tempfile.mkdtemp())
        _csv(tmp / "bruto" / "carga_2026-09-01.csv", CAB +
             f"A1;K1;;900,00;01/08/2026;CARTAO;SP;{T1};N;{T2};{T3};a1@exemplo.invalid;\n")
        base = tmp / "base"
        rodar_dia.preparar_base(EMPRESA, tmp / "bruto", base)
        estr = [{"id": 1, "nome": "Teste", "padrao": True, "definicao": {"localizacao": {"passos": {
            "1": [{"canal": canal, "modo": "sempre", "numeros": 1}]}}}}]
        return rodar_dia.rodar_dia(base / "clientes.csv", base / "contatos.csv", tmp / "ret", HOJE,
                                   pasta_estado=tmp / "estado", pasta_saida=tmp / "saida", estrategias=estr,
                                   retornos_canal=retornos, out=lambda *a: None)

    def _escolhido(self, r, canal):
        return [l["contato"] for l in r["fila"] if l["canal"] == canal]

    def test_sms_nao_entregue_vai_para_o_proximo_numero(self):
        (primeiro,) = self._escolhido(self._rodar(), "sms")
        depois = self._rodar([R(primeiro, "sms", "inexistente")])
        (segundo,) = self._escolhido(depois, "sms")
        self.assertNotEqual(segundo, primeiro)
        self.assertIn(segundo, (T1, T2, T3))
        rc = depois["retorno_canal"]
        self.assertEqual(rc["oxigenados"], {"sms": 1})
        self.assertEqual(rc["contatos_fora"], {"sms": 1, "rcs": 1})        # SMS falho também sai do RCS
        hig = (depois["saida"] / "higienizacao.csv").read_text(encoding="utf-8")
        self.assertIn(primeiro, hig)
        self.assertTrue(any("RETORNO DE CANAL" in a for a in depois["alertas"]))
        # o 2º também morre: vai o 3º
        (terceiro,) = self._escolhido(self._rodar([R(primeiro, "sms", "inexistente"), R(segundo, "sms", "inexistente")]),
                                      "sms")
        self.assertEqual({primeiro, segundo, terceiro}, {T1, T2, T3})

    def test_todos_os_numeros_mortos_no_sms_nao_acionam_sms(self):
        r = self._rodar([R(t, "sms", "inexistente") for t in (T1, T2, T3)])
        self.assertEqual(self._escolhido(r, "sms"), [])

    def test_sms_inexistente_nao_tira_o_numero_da_voz(self):
        (primeiro,) = self._escolhido(self._rodar(canal="discador"), "discador")
        r = self._rodar([R(primeiro, "sms", "inexistente")], canal="discador")
        self.assertEqual(self._escolhido(r, "discador"), [primeiro])

    def test_voz_inexistente_tira_de_todos_os_canais_de_telefone(self):
        (primeiro,) = self._escolhido(self._rodar(canal="discador"), "discador")
        r = self._rodar([R(primeiro, "voz", "inexistente")], canal="discador")
        (outro,) = self._escolhido(r, "discador")
        self.assertNotEqual(outro, primeiro)

    def test_email_hard_bounce_sem_outro_email_nao_envia(self):
        self.assertEqual(len([l for l in self._rodar(canal="email")["fila"] if l["canal"] == "email"]), 1)
        r = self._rodar([R("a1@exemplo.invalid", "email", "inexistente")], canal="email")
        self.assertEqual([l for l in r["fila"] if l["canal"] == "email"], [])


class TestRegras(unittest.TestCase):
    def test_positivo_desfaz_inexistente_e_pausa(self):
        donos = {T1: ["A1"]}
        _, restr, _, _ = avaliar([R(T1, "sms", "inexistente", 5), R(T1, "sms", "entregue", 2)], donos, HOJE)
        self.assertEqual(restr, {})
        temps = [R(T1, "sms", "temporario", d) for d in (6, 4, 2)]
        _, restr, sit, _ = avaliar(temps, donos, HOJE)
        self.assertEqual(restr[T1], {"sms:pausa"})
        self.assertIn("pausa", sit[0]["situacao"])
        _, restr, _, _ = avaliar(temps[:2], donos, HOJE)                       # só 2: ainda não pausa
        self.assertEqual(restr, {})
        _, restr, _, _ = avaliar(temps + [R(T1, "sms", "lido", 1)], donos, HOJE)  # leu depois: volta
        self.assertEqual(restr, {})

    def test_rcs_e_whatsapp_sem_suporte_sao_retestados(self):
        donos = {T1: ["A1"]}
        _, restr, _, _ = avaliar([R(T1, "rcs", "inexistente", 10)], donos, HOJE)
        self.assertEqual(restr[T1], {"rcs:sem_suporte"})
        _, restr, _, _ = avaliar([R(T1, "rcs", "inexistente", 70)], donos, HOJE)
        self.assertEqual(restr, {})                                          # passou 60 dias: testa de novo
        _, restr, _, _ = avaliar([R(T1, "whatsapp", "inexistente", 3)], donos, HOJE)
        self.assertEqual(restr[T1], {"whatsapp:sem_conta"})

    def test_bloqueio_nao_e_desfeito_por_entrega(self):
        _, restr, _, _ = avaliar([R(T1, "sms", "bloqueio", 5), R(T1, "sms", "entregue", 1)], {T1: ["A1"]}, HOJE)
        self.assertEqual(restr[T1], {"sms:opt_out"})

    def test_regras_configuradas_na_pagina_canais(self):
        regras = regras_de([{"canal": "sms", "regras_retorno": {"temporarios_pausa": 2, "dias_pausa": 7,
                                                                 "inexistente": "ignorar"}},
                            {"canal": "rcs", "regras_retorno": {"dias_pausa": "abc"}}])
        self.assertEqual((regras["sms"]["temporarios_pausa"], regras["sms"]["dias_pausa"]), (2, 7))
        self.assertEqual(regras["rcs"]["dias_pausa"], 30)                    # valor inválido: fica o padrão
        donos = {T1: ["A1"]}
        _, restr, _, _ = avaliar([R(T1, "sms", "temporario", 3), R(T1, "sms", "temporario", 2)], donos, HOJE, regras)
        self.assertEqual(restr[T1], {"sms:pausa"})
        _, restr, _, _ = avaliar([R(T1, "sms", "temporario", 9), R(T1, "sms", "temporario", 8)], donos, HOJE, regras)
        self.assertEqual(restr, {})                                          # pausa de 7 dias já acabou
        _, restr, _, _ = avaliar([R(T1, "sms", "inexistente")], donos, HOJE, regras)
        self.assertEqual(restr, {})                                          # "ignorar"

    def test_numero_compartilhado_leitura_vale_so_como_entrega(self):
        ev, _, _, _ = avaliar([R(T1, "rcs", "clique")], {T1: ["A1", "B2"]}, HOJE)
        self.assertEqual({(e.id_cliente, e.resultado) for e in ev}, {("A1", "entregue"), ("B2", "entregue")})
        ev, _, _, _ = avaliar([R(T1, "rcs", "clique")], {T1: ["A1"]}, HOJE)
        self.assertEqual([(e.canal, e.resultado) for e in ev], [("rcs", "clique_link")])


class TestArquivo(unittest.TestCase):
    def test_le_dlr_sugere_colunas_e_trava_lote_de_falha_do_fornecedor(self):
        tmp = Path(tempfile.mkdtemp())
        linhas = ["DESTINO;STATUS_DLR;DATA_ENVIO"] + [f"55{11900000000 + i};UNDELIV;01/09/2026 10:00" for i in range(150)] \
            + [f"55{11800000000 + i};DELIVRD;01/09/2026 10:00" for i in range(100)]
        arq = _csv(tmp / "dlr_sms.csv", "\n".join(linhas) + "\n")
        from motor.retorno_canal import abrir
        ls, cab, _, _ = abrir(arq)
        self.assertEqual(detectar_colunas(cab, ls), {"contato": "DESTINO", "status": "STATUS_DLR", "data": "DATA_ENVIO"})
        marcas = {"UNDELIV": "inexistente", "DELIVRD": "entregue"}
        cols = {"contato": "DESTINO", "status": "STATUS_DLR", "data": "DATA_ENVIO"}
        regs, rel = ler_arquivo(arq, "sms", cols, marcas, HOJE)
        self.assertTrue(rel.lote_travado)                                    # 60% inexistente em 250 linhas
        self.assertEqual({r.marca for r in regs}, {"entregue"})
        self.assertEqual(regs[0].contato, "11800000000")                     # DDI tirado
        regs, rel = ler_arquivo(arq, "sms", cols, {"DELIVRD": "entregue"}, HOJE)
        self.assertEqual(rel.sem_marca, {"UNDELIV": 150})                    # status sem marca espera

    def test_sugestao_das_marcas(self):
        casos = {"DELIVRD": "entregue", "UNDELIV": "inexistente", "Não entregue": "inexistente",
                 "EXPIRED": "temporario", "Hard Bounce": "inexistente", "Soft bounce - caixa cheia": "temporario",
                 "Lido": "lido", "Clicou no link": "clique", "OPT-OUT": "bloqueio", "Descadastrado": "bloqueio",
                 "Caixa postal": "entregue", "OK": "entregue", "NOK": None, "xyz": None}
        self.assertEqual({c: sugerir_marca(c) for c in casos}, casos)


if __name__ == "__main__":
    unittest.main()
