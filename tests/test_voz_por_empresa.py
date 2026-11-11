"""Voz por empresa na Montagem: a voz_config.voz_id da empresa vale na ligação real quando a VM a liberou (tts_voz ou
tts_vozes do provedores.json); voz não liberada ou sem voz cai na padrão (tts_voz). Sem rede e sem Pipecat. Só dados
fictícios."""
import asyncio
import json
import re
import socket
import unittest
from pathlib import Path
from unittest import mock

from tests.test_voz_gerador import dados_exemplo
from tests.test_voz_orquestrador import Base, item
from voz import banco as B
from voz.provedores import montagem as M
from voz.provedores.base import ContextoChamada
from voz.provedores.simulador import Simulador
from voz.segredos import Dicionario

PADRAO, V2, V3, V4 = "0YziWIrqiRTHCxeg1lyc", "RGymW84CSmfVugnA5tvA", "PznTnBc8X6pvixs9UkQm", "4J31DrhygVjvFsoj7BsM"
CFG = M.ConfigMontagem(tts_voz=PADRAO, tts_vozes=(V2, V3, V4))


class TestVozDaEmpresa(unittest.TestCase):
    def test_liberada_e_usada(self):
        for v in (V2, V3, V4, PADRAO):
            self.assertEqual(M.voz_da_empresa(CFG, v, 1), v)

    def test_nao_liberada_cai_na_padrao_com_aviso_sem_dado_pessoal(self):
        M._AVISADAS.clear()
        with self.assertLogs("motorcx.voz", "WARNING") as log:
            self.assertEqual(M.voz_da_empresa(CFG, "vozQueNaoFoiLiberada", 7), PADRAO)
            self.assertEqual(M.voz_da_empresa(CFG, "vozQueNaoFoiLiberada", 7), PADRAO)   # aviso só uma vez
        self.assertEqual(len(log.output), 1)
        self.assertIn("empresa 7", log.output[0])

    def test_sem_voz_e_padrao(self):
        for v in (None, ""):
            self.assertEqual(M.voz_da_empresa(CFG, v, 1), PADRAO)

    def test_lista_vinda_do_json_e_ids_fora_do_formato(self):
        cfg = M.ConfigMontagem(tts_voz=PADRAO, tts_vozes=[V2, "../x", 5, PADRAO])     # o JSON traz lista
        self.assertEqual(M.vozes_liberadas(cfg), (PADRAO, V2))
        self.assertEqual(M.voz_da_empresa(cfg, "../x", 1), PADRAO)
        self.assertEqual(M.voz_da_empresa(cfg, V2, 1), V2)


RAIZ = Path(__file__).resolve().parent.parent


class TestPadraoESite(unittest.TestCase):
    def test_padrao_da_vm_e_lista_do_console_iguais(self):
        """O padrão da VM (tts_voz + tts_vozes) e o seletor do Console (VOZES_MONTAGEM) têm as mesmas vozes, na ordem."""
        m = json.loads((RAIZ / "infra/asterisk/vm/motorcx-provedores.padrao.json").read_text(encoding="utf-8"))["montagem"]
        self.assertEqual((m["tts_voz"], *m["tts_vozes"]), (PADRAO, V2, V3, V4))
        ts = (RAIZ / "site/src/lib/voz.ts").read_text(encoding="utf-8")
        bloco = ts[ts.index("export const VOZES_MONTAGEM"):]
        bloco = bloco[:bloco.index("];")]
        self.assertEqual(tuple(re.findall(r"id: '([A-Za-z0-9_\-]+)'", bloco)), (PADRAO, V2, V3, V4))
        self.assertEqual(M.vozes_liberadas(M.ConfigMontagem(**{k: v for k, v in m.items()})), (PADRAO, V2, V3, V4))


class TestBanco(unittest.TestCase):
    def test_voz_id_lido_da_config(self):
        d = dados_exemplo()
        d["voz_config"][0]["voz_id"] = V2
        self.assertEqual(B.carregar(d).config(1).voz_id, V2)

    def test_sem_voz_ou_fora_do_formato(self):
        d = dados_exemplo()
        self.assertIsNone(B.carregar(d).config(1).voz_id)
        d["voz_config"][0]["voz_id"] = "voz com espaço"
        self.assertIsNone(B.carregar(d).config(1).voz_id)


class SimuladorQueGuarda(Simulador):
    def __init__(self):
        super().__init__()
        self.contextos = []

    def iniciar(self, ctx, emitir):
        self.contextos.append(ctx)
        return super().iniciar(ctx, emitir)


class TestOrquestrador(Base):
    def _ctx(self, mud):
        sim = SimuladorQueGuarda()
        self.montar([item()], mud=mud, provedor=sim)
        self.orq.tick()
        canal = self.originados()[0][2]
        self.atender(canal)
        self.assertEqual(len(sim.contextos), 1)
        return sim.contextos[0]

    def test_voz_da_empresa_vai_no_contexto(self):
        self.assertEqual(self._ctx([("voz_config", 0, {"voz_id": V3})]).voz_id, V3)

    def test_sem_voz_vai_vazio(self):
        self.assertEqual(self._ctx(None).voz_id, "")


class TestSessaoMontagem(unittest.TestCase):
    """A sessão real monta o TTS com a voz da empresa (o Pipecat é trocado por um mock que só anota a voz)."""

    def _voz_da_sessao(self, voz_id):
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.bind(("127.0.0.1", 0))
            porta = s.getsockname()[1]
        m = M.Montagem(CFG, Dicionario({}), lambda ctx: ("roteiro", "Alô?"), executor=lambda s: None)
        ctx = ContextoChamada("ch-1", 3, "C1", voz_id=voz_id)
        sessao = M.SessaoMontagem(ctx, porta, mock.Mock())
        vozes = []

        def montar(cfg, segredos, voz=None):
            vozes.append(voz)
            raise RuntimeError("sem pipecat no teste")

        with mock.patch.object(M, "montar_servicos_pipecat", montar), self.assertLogs("motorcx.voz", "WARNING"):
            asyncio.run(m._sessao(sessao))
        sessao.conversa._transferir.assert_called_once_with("pedido_humano")
        return vozes[0]

    def test_liberada(self):
        self.assertEqual(self._voz_da_sessao(V4), V4)

    def test_nao_liberada(self):
        M._AVISADAS.clear()
        self.assertEqual(self._voz_da_sessao("outraVozQualquer"), PADRAO)

    def test_sem_voz(self):
        self.assertEqual(self._voz_da_sessao(""), PADRAO)

    def test_pipecat_recebe_a_voz(self):
        import sys
        import types
        criados = {}

        def classe(nome):
            class C:
                class Settings:
                    def __init__(self, **kw):
                        self.kw = kw

                def __init__(self, **kw):
                    criados[nome] = kw
            return C
        mods = {"pipecat": types.ModuleType("pipecat"), "pipecat.services": types.ModuleType("s")}
        for caminho, nome in (("pipecat.services.deepgram.stt", "DeepgramSTTService"),
                              ("pipecat.services.elevenlabs.tts", "ElevenLabsTTSService")):
            mod = types.ModuleType(caminho)
            setattr(mod, nome, classe(nome))
            mods[caminho] = mod
            mods[caminho.rsplit(".", 1)[0]] = types.ModuleType(caminho.rsplit(".", 1)[0])
        seg = Dicionario({"voz/deepgram": "dg", "voz/tts": "tts"})
        with mock.patch.dict(sys.modules, mods):
            M.montar_servicos_pipecat(CFG, seg, V2)
            self.assertEqual(criados["ElevenLabsTTSService"]["settings"].kw["voice"], V2)
            M.montar_servicos_pipecat(CFG, seg)
            self.assertEqual(criados["ElevenLabsTTSService"]["settings"].kw["voice"], PADRAO)


if __name__ == "__main__":
    unittest.main()
