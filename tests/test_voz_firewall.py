"""Firewall das VMs de voz a partir do cadastro (voz/firewall.py, SQL 104). Nada vai ao Google Cloud: a API do Compute
Engine e o banco são falsos. Só IPs de documentação e faixas fictícias."""
import io
import json
import unittest
import urllib.error
from contextlib import redirect_stderr, redirect_stdout

from voz import firewall as F


class Token:
    def __call__(self):
        return "token-ficticio"


class BancoFalso:
    def __init__(self, origens=None, erro=None):
        self.origens = origens or []
        self.erro = erro
        self.chamadas = []

    def rpc(self, nome, args=None):
        self.chamadas.append((nome, args))
        if nome == "origens_firewall_voz":
            if self.erro:
                raise self.erro
            return self.origens
        return 1


class ApiFalsa:
    """Responde GET/PATCH das regras motorcx-voz-sip/rtp; guarda os PATCH."""

    def __init__(self, regras=None, status=None):
        self.regras = regras or {n: {"sourceRanges": ["100.64.0.1/32"], "disabled": False} for n in F.REGRAS}
        self.patches = []
        self.status = status

    def __call__(self, req, timeout=None):
        nome = req.full_url.rsplit("/", 1)[-1]
        if self.status:
            raise urllib.error.HTTPError(req.full_url, self.status, "x", {}, io.BytesIO(b"corpo"))
        if req.get_method() == "PATCH":
            corpo = json.loads(req.data.decode())
            self.patches.append((nome, corpo))
            self.regras[nome] = {**self.regras[nome], **corpo}
            return io.BytesIO(b'{"name": "operation-1"}')
        return io.BytesIO(json.dumps(self.regras[nome]).encode())


def origem(o, tipo="tronco", ref=1, empresa=7):
    return {"origem": o, "tipo": tipo, "ref_id": ref, "empresa_id": empresa}


class TestRegra(unittest.TestCase):
    def test_motivo_igual_ao_banco(self):
        casos = {
            "200.160.10.5/32": None, "200.160.10.0/24": None, "200.160.10.9": None,
            "200.160.0.0/16": "faixa grande demais: no máximo /24",
            "0.0.0.0/0": "0.0.0.0/0 abriria o SIP para a internet inteira",
            "10.1.2.3/32": "endereço em rede interna, reservada ou de loopback",
            "192.168.0.0/24": "endereço em rede interna, reservada ou de loopback",
            "127.0.0.1": "endereço em rede interna, reservada ou de loopback",
            "169.254.169.254": "endereço em rede interna, reservada ou de loopback",
            "2001:db8::1": "só IPv4", "abc": "origem inválida",
        }
        for faixa, motivo in casos.items():
            self.assertEqual(F.motivo_origem(faixa), motivo, faixa)
        self.assertEqual(F.motivo_origem("35.198.40.10/32", ["35.198.40.10"]), "endereço do próprio MotorCX")
        # a lista fixa do criar_gcp.sh aceita faixa larga (já validada lá), mas nunca /0 nem rede interna
        self.assertIsNone(F.motivo_origem("200.160.0.0/16", max_prefixo=1))
        self.assertIsNotNone(F.motivo_origem("0.0.0.0/0", max_prefixo=1))

    def test_desejadas_junta_canoniza_e_recusa(self):
        quero, avisos = F.desejadas(["200.160.0.0/16", "200.160.20.1"],
                                    [origem("200.161.1.0/24"), origem("200.161.1.0/24", "transferencia", 3),
                                     origem("10.0.0.0/24", ref=2), origem("203.0.113.5/32", ref=4)],
                                    proprios=["35.198.40.10"])
        self.assertEqual(quero, ["200.160.0.0/16", "200.160.20.1/32", "200.161.1.0/24"])
        self.assertTrue(any("tronco 2 (empresa 7): origem recusada" in a for a in avisos))
        self.assertTrue(any("tronco 4" in a and "documentação" in a for a in avisos))

    def test_limite_de_origens(self):
        muitas = [origem(f"200.{i // 250}.{i % 250}.1/32", ref=i) for i in range(F.MAX_ORIGENS + 1)]
        with self.assertRaises(F.FirewallRecusado):
            F.desejadas([], muitas)

    def test_corpo_sem_origem_desliga(self):
        self.assertEqual(F.corpo_da_regra([]), {"sourceRanges": [F.RESERVA_DESLIGADA], "disabled": True})
        self.assertEqual(F.corpo_da_regra(["200.1.1.1/32"]), {"sourceRanges": ["200.1.1.1/32"], "disabled": False})
        self.assertEqual(F.atuais({"sourceRanges": ["192.0.2.1/32"], "disabled": True}), [])

    def test_lista_fixa_do_metadado(self):
        self.assertEqual(F.lista_fixa("200.1.1.1/32 200.2.0.0/24,200.3.3.3/32\n"),
                         ["200.1.1.1/32", "200.2.0.0/24", "200.3.3.3/32"])
        self.assertEqual(F.lista_fixa(""), [])


class TestSincronizar(unittest.TestCase):
    def test_muda_as_duas_regras_e_registra(self):
        sb, api = BancoFalso([origem("200.161.1.0/24")]), ApiFalsa()
        r = F.sincronizar(sb, "motorcob", "motorcx-ast-1", ["200.160.20.1/32"], token=Token(), abrir=api)
        self.assertEqual(r["mudou"], list(F.REGRAS))
        self.assertEqual([p[0] for p in api.patches], list(F.REGRAS))
        self.assertEqual(api.patches[0][1], {"sourceRanges": ["200.160.20.1/32", "200.161.1.0/24"], "disabled": False})
        self.assertEqual((r["adicionadas"], r["removidas"]), (["200.160.20.1/32", "200.161.1.0/24"], ["100.64.0.1/32"]))
        reg = [a for n, a in sb.chamadas if n == "registrar_firewall_voz"]
        self.assertEqual(reg[0]["evento"]["vm"], "motorcx-ast-1")
        self.assertEqual(reg[0]["evento"]["origens"], 2)

    def test_sem_mudanca_nao_mexe(self):
        sb = BancoFalso([origem("200.161.1.0/24")])
        api = ApiFalsa({n: {"sourceRanges": ["200.161.1.0/24"], "disabled": False} for n in F.REGRAS})
        r = F.sincronizar(sb, "motorcob", "vm", [], token=Token(), abrir=api)
        self.assertEqual((r["mudou"], api.patches), ([], []))
        self.assertFalse(any(n == "registrar_firewall_voz" for n, _ in sb.chamadas))

    def test_sem_nenhuma_origem_fecha(self):
        api = ApiFalsa()
        F.sincronizar(BancoFalso([]), "motorcob", "vm", [], token=Token(), abrir=api)
        self.assertEqual(api.patches[0][1], {"sourceRanges": [F.RESERVA_DESLIGADA], "disabled": True})

    def test_simular_nao_muda(self):
        api = ApiFalsa()
        r = F.sincronizar(BancoFalso([origem("200.161.1.0/24")]), "motorcob", "vm", [], token=Token(), abrir=api,
                          simular=True)
        self.assertEqual((r["mudou"], api.patches), (list(F.REGRAS), []))

    def test_banco_fora_nao_muda_nada(self):
        api = ApiFalsa()
        sb = BancoFalso(erro=OSError("sem banco"))
        with self.assertRaises(OSError):
            F.sincronizar(sb, "motorcob", "vm", [], token=Token(), abrir=api)
        self.assertEqual(api.patches, [])

    def test_api_recusa_nao_vaza_corpo(self):
        api = ApiFalsa(status=403)
        with self.assertRaises(Exception) as cm:
            F.sincronizar(BancoFalso([origem("200.161.1.0/24")]), "motorcob", "vm", [], token=Token(), abrir=api)
        self.assertIn("403", str(cm.exception))
        self.assertNotIn("corpo", str(cm.exception))

    def test_main_sem_projeto_e_com_recusa(self):
        import os
        antes = dict(os.environ)
        try:
            os.environ.pop("MOTORCX_GCP_PROJETO", None)
            err = io.StringIO()
            with redirect_stderr(err):
                self.assertEqual(F.main([], sb=BancoFalso(), abrir=lambda *a, **k: (_ for _ in ()).throw(OSError())), 2)
            os.environ["MOTORCX_GCP_PROJETO"] = "motorcob"
            os.environ["MOTORCX_FIREWALL_FIXOS"] = "0.0.0.0/0"
            muitas = [origem(f"200.{i // 250}.{i % 250}.1/32", ref=i) for i in range(F.MAX_ORIGENS + 1)]
            sb = BancoFalso(muitas)
            with redirect_stderr(io.StringIO()), redirect_stdout(io.StringIO()):
                self.assertEqual(F.main([], sb=sb, abrir=ApiFalsa()), 2)
            reg = [a for n, a in sb.chamadas if n == "registrar_firewall_voz"]
            self.assertFalse(reg[0]["evento"]["ok"])
        finally:
            os.environ.clear()
            os.environ.update(antes)


if __name__ == "__main__":
    unittest.main()
