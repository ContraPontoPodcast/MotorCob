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

    def _rodar(self, retornos=None, canal="sms", regras=None):
        tmp = Path(tempfile.mkdtemp())
        _csv(tmp / "bruto" / "carga_2026-09-01.csv", CAB +
             f"A1;K1;;900,00;01/08/2026;CARTAO;SP;{T1};N;{T2};{T3};a1@exemplo.invalid;\n")
        base = tmp / "base"
        rodar_dia.preparar_base(EMPRESA, tmp / "bruto", base)
        estr = [{"id": 1, "nome": "Teste", "padrao": True, "definicao": {"localizacao": {"passos": {
            "1": [{"canal": canal, "modo": "sempre", "numeros": 1}]}}}}]
        return rodar_dia.rodar_dia(base / "clientes.csv", base / "contatos.csv", tmp / "ret", HOJE,
                                   pasta_estado=tmp / "estado", pasta_saida=tmp / "saida", estrategias=estr,
                                   retornos_canal=retornos, regras_retorno=regras, out=lambda *a: None)

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
        # DLR de não entregue suspende o celular em tudo (SMS, RCS, WhatsApp e voz nesse número)
        self.assertEqual(rc["contatos_fora"], {c: 1 for c in ("sms", "rcs", "whatsapp", "discador", "agente_voz")})
        hig = (depois["saida"] / "higienizacao.csv").read_text(encoding="utf-8")
        self.assertIn(primeiro, hig)
        self.assertTrue(any("RETORNO DE CANAL" in a for a in depois["alertas"]))
        # o 2º também morre: vai o 3º
        (terceiro,) = self._escolhido(self._rodar([R(primeiro, "sms", "inexistente"), R(segundo, "sms", "inexistente")]),
                                      "sms")
        self.assertEqual({primeiro, segundo, terceiro}, {T1, T2, T3})

    def test_regra_do_credor_vale_na_lista(self):
        (primeiro,) = self._escolhido(self._rodar(), "sms")
        r = self._rodar([R(primeiro, "sms", "inexistente")], regras={"sms": {"inexistente": "ignorar"}})
        self.assertEqual(self._escolhido(r, "sms"), [primeiro])                # este credor não usa o DLR
        r = self._rodar([R(primeiro, "sms", "inexistente", 5)], regras={"sms": {"escalonamento": [3, 10]}})
        self.assertEqual(self._escolhido(r, "sms"), [primeiro])                # 1ª falha = 3 dias: já passou

    def test_todos_os_numeros_mortos_no_sms_nao_acionam_sms(self):
        r = self._rodar([R(t, "sms", "inexistente") for t in (T1, T2, T3)])
        self.assertEqual(self._escolhido(r, "sms"), [])

    def test_dlr_suspende_o_celular_tambem_na_voz_e_o_proximo_assume(self):
        (primeiro,) = self._escolhido(self._rodar(canal="discador"), "discador")
        r = self._rodar([R(primeiro, "sms", "inexistente")], canal="discador")
        (outro,) = self._escolhido(r, "discador")
        self.assertNotEqual(outro, primeiro)

    def test_voz_inexistente_suspende_so_a_voz_e_o_proximo_numero_assume(self):
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

    def test_dlr_suspensao_escalonada(self):
        """1ª falha 7 dias, 2ª 15, 3ª 30, 4ª 90, 5ª 120; falha durante a suspensão não conta; entrega zera;
        depois da 5ª reabre e uma nova falha suspende pelo último degrau."""
        donos = {T1: ["A1"]}
        susp = lambda regs: avaliar(regs, donos, HOJE)  # noqa: E731
        _, restr, sit, _ = susp([R(T1, "sms", "inexistente", 3)])
        self.assertIn("sms:suspenso", restr[T1])
        self.assertTrue({"rcs:suspenso", "whatsapp:suspenso", "discador:suspenso", "agente_voz:suspenso"} <= restr[T1])
        self.assertEqual((sit[0]["desde"], sit[0]["ate"]), ((HOJE - timedelta(3)).isoformat(),
                                                            (HOJE + timedelta(4)).isoformat()))
        self.assertEqual(susp([R(T1, "sms", "inexistente", 8)])[1], {})              # 7 dias já passaram
        falhas = [R(T1, "sms", "inexistente", d) for d in (100, 90, 60, 29)]           # 7 → 15 → 30 → 90
        _, restr, sit, _ = susp(falhas + [R(T1, "sms", "inexistente", 20)])         # 20: dentro da 4ª, não conta
        self.assertIn("4ª falha", sit[0]["situacao"])
        self.assertEqual(sit[0]["ate"], (HOJE + timedelta(61)).isoformat())
        self.assertEqual(susp(falhas + [R(T1, "sms", "entregue", 10)])[1], {})       # entregou: zera
        cinco = [R(T1, "sms", "inexistente", d) for d in (400, 390, 370, 330, 235)]  # 5ª acaba em HOJE-115
        self.assertEqual(susp(cinco)[1], {})                                        # reabriu
        _, _, sit, _ = susp(cinco + [R(T1, "sms", "inexistente", 5)])
        self.assertIn("6ª falha", sit[0]["situacao"])
        self.assertEqual(sit[0]["ate"], (HOJE + timedelta(115)).isoformat())        # último degrau: 120

    def test_voz_sozinha_nao_e_severa_e_junta_com_o_sms(self):
        """Telefonia pode falhar: 'número inexistente' na voz suspende só a voz (mesma escada). Se o SMS também
        falha, as falhas somam e a suspensão passa a valer para tudo do celular."""
        donos = {T1: ["A1"]}
        voz = {"discador:suspenso", "agente_voz:suspenso"}
        _, restr, sit, _ = avaliar([R(T1, "voz", "inexistente", 2)], donos, HOJE)
        self.assertEqual(restr[T1], voz)                                     # só a voz, 7 dias
        self.assertIn("só a voz", sit[0]["situacao"])
        self.assertEqual(sit[0]["ate"], (HOJE + timedelta(5)).isoformat())
        _, restr, sit, _ = avaliar([R(T1, "voz", "inexistente", 20), R(T1, "voz", "inexistente", 5)], donos, HOJE)
        self.assertEqual(restr[T1], voz)                                     # 2ª falha só de voz: 15 dias
        self.assertIn("2ª falha (Voz: Número inexistente)", sit[0]["situacao"])
        # junção: a voz suspendeu e o SMS também falhou (outro canal confirmando) → sobe e vale para tudo
        _, restr, sit, _ = avaliar([R(T1, "voz", "inexistente", 4), R(T1, "sms", "inexistente", 2)], donos, HOJE)
        self.assertIn("sms:suspenso", restr[T1])
        self.assertIn("whatsapp:suspenso", restr[T1])
        self.assertIn("2ª falha (SMS: Não entregue (DLR) + Voz: Número inexistente)", sit[0]["situacao"])
        self.assertEqual(sit[0]["ate"], (HOJE + timedelta(13)).isoformat())  # 15 dias a partir do SMS
        # atendeu / caixa postal depois: zera
        self.assertEqual(avaliar([R(T1, "voz", "inexistente", 4), R(T1, "voz", "entregue", 1)], donos, HOJE)[1], {})
        # a empresa pode voltar ao "bloquear" na voz (tira o número de todos os canais de telefone)
        regras = regras_de([{"canal": "discador", "regras_retorno": {"inexistente": "bloquear"}}])
        _, restr, _, _ = avaliar([R(T1, "voz", "inexistente", 2)], donos, HOJE, regras)
        self.assertIn("sms:inexistente", restr[T1])

    def test_rcs_e_whatsapp_sem_suporte_sao_retestados(self):
        donos = {T1: ["A1"]}
        _, restr, _, _ = avaliar([R(T1, "rcs", "inexistente", 10)], donos, HOJE)
        self.assertEqual(restr[T1], {"rcs:sem_suporte"})
        _, restr, _, _ = avaliar([R(T1, "rcs", "inexistente", 70)], donos, HOJE)
        self.assertEqual(restr, {})                                          # passou 60 dias: testa de novo
        _, restr, _, _ = avaliar([R(T1, "whatsapp", "inexistente", 10)], donos, HOJE)
        self.assertEqual(restr[T1], {"whatsapp:sem_conta"})
        self.assertEqual(avaliar([R(T1, "whatsapp", "inexistente", 16)], donos, HOJE)[1], {})   # 15 dias: retesta

    def test_bloqueio_nao_e_desfeito_por_entrega(self):
        _, restr, _, _ = avaliar([R(T1, "sms", "bloqueio", 5), R(T1, "sms", "entregue", 1)], {T1: ["A1"]}, HOJE)
        self.assertEqual(restr[T1], {"sms:opt_out"})

    def test_regras_por_credor_por_cima_da_sugestao(self):
        r = regras_de([{"canal": "sms", "regras_retorno": {"dias_pausa": 10}}],
                      {"sms": {"dias_pausa": 20, "escalonamento": [1, 2]}, "voz": {"inexistente": "bloquear"},
                       "whatsapp": "lixo"})
        self.assertEqual((r["sms"]["dias_pausa"], r["sms"]["escalonamento"]), (20, [1, 2]))   # credor vence
        self.assertEqual(r["voz"]["inexistente"], "bloquear")
        self.assertEqual(r["whatsapp"]["dias_rever"], 15)                                   # inválido: sugestão
        self.assertEqual(regras_de(None, None)["sms"]["escalonamento"], [7, 15, 30, 90, 120])

    def test_regras_configuradas_na_pagina_canais(self):
        esc = regras_de([{"canal": "sms", "regras_retorno": {"escalonamento": [2, 4]}}])
        self.assertEqual(esc["sms"]["escalonamento"], [2, 4])
        self.assertEqual(regras_de(None)["sms"]["escalonamento"], [7, 15, 30, 90, 120])   # padrão sugerido
        self.assertEqual(regras_de(None)["whatsapp"]["dias_rever"], 15)
        _, restr, _, _ = avaliar([R(T1, "sms", "inexistente", 3)], {T1: ["A1"]}, HOJE, esc)
        self.assertEqual(restr, {})                                          # 1ª falha: só 2 dias
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

    def test_cada_canal_tem_os_seus_retornos(self):
        from motor.retorno_canal import CANAIS, MARCAS, RETORNOS, rotulo
        for canal in CANAIS:
            marcas = [m for m, _, _ in RETORNOS[canal]]
            self.assertTrue(set(marcas) <= set(MARCAS) and len(marcas) == len(set(marcas)), canal)
            self.assertTrue({"inexistente", "temporario", "entregue", "bloqueio"} <= set(marcas), canal)
        self.assertEqual((rotulo("sms", "inexistente"), rotulo("email", "temporario"), rotulo("voz", "clique")),
                         ("Não entregue (DLR)", "Soft bounce", "Atendeu"))

    def test_sugestao_das_marcas(self):
        casos = {"DELIVRD": "entregue", "UNDELIV": "inexistente", "Não entregue": "inexistente",
                 "EXPIRED": "temporario", "Hard Bounce": "inexistente", "Soft bounce - caixa cheia": "temporario",
                 "Lido": "lido", "Clicou no link": "clique", "OPT-OUT": "bloqueio", "Descadastrado": "bloqueio",
                 "Caixa postal": "entregue", "OK": "entregue", "NOK": None, "xyz": None}
        self.assertEqual({c: sugerir_marca(c) for c in casos}, casos)


if __name__ == "__main__":
    unittest.main()
