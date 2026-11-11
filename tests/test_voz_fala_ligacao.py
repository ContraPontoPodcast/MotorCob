"""PR10 do redesenho (SPEC B6 e Q9): números por extenso na ligação real e os áudios do sistema.

1. Todo texto que vai ao TTS na ligação passa por voz/falado.como_soa (montagem.para_tts / ConversaFalada), com a
   MESMA tabela de casos do "Como soa no telefone" do site (tests/dados/fala_por_extenso_casos.json). A transcrição
   continua com o texto como foi escrito.
2. voz/sons_sistema.py gera sem-robo.wav e alo.wav (8 kHz, mono, 16 bits) com textos neutros; a chave nunca aparece.
Sem rede; TTS falso.
"""
import io
import json
import math
import struct
import tempfile
import unittest
import wave
from pathlib import Path

from voz import fluxo as FX
from voz import sons_sistema as S
from voz import simulador_http as SH
from voz.provedores import montagem as M
from voz.transcricao.ia import ConversaComTurnos

from tests.test_voz_fluxo import VARS, fluxo

AQUI = Path(__file__).parent
CASOS = json.loads((AQUI / "dados" / "fala_por_extenso_casos.json").read_text(encoding="utf-8"))
RAIZ = AQUI.parent


class TestPorExtensoNaLigacao(unittest.TestCase):
    def test_mesma_tabela_do_como_soa(self):
        for entrada, esperado in CASOS["falas"]:
            self.assertEqual(M.para_tts(entrada), esperado, entrada)
        self.assertEqual(M.para_tts(""), "")

    def test_conversa_falada_converte_so_o_que_vai_ao_tts(self):
        class Interna:
            encerrada = False
            falar_agora = None

            def comecar(self):
                return ["Consta R$ 1.380,00 em aberto."]

            def ouvir(self, t):
                return ["São 6 parcelas de R$ 230,00, a primeira em 05/12."]

            def silencio(self):
                return ["Ligo às 14h30."]
        i = Interna()
        c = M.ConversaFalada(i)
        self.assertEqual(c.comecar(), ["Consta mil trezentos e oitenta reais em aberto."])
        self.assertEqual(c.ouvir("ok"), ["São seis parcelas de duzentos e trinta reais, a primeira em cinco de dezembro."])
        self.assertEqual(c.silencio(), ["Ligo às quatorze horas e trinta minutos."])
        self.assertFalse(c.encerrada)
        ditas = []
        c.falar_agora = ditas.append                 # a fala de espera do conector também sai por extenso
        i.falar_agora("Desconto de 15% à vista.")
        self.assertEqual(ditas, ["Desconto de quinze por cento à vista."])
        c.falar_agora = None
        self.assertIsNone(i.falar_agora)

        class SemSilencio:
            def comecar(self):
                return []
        self.assertEqual(M.ConversaFalada(SemSilencio()).silencio(), [])

    def test_sessao_do_fluxo_real_transcricao_com_o_texto_escrito(self):
        s = FX.Sessao(fluxo(), "c", "CLI", VARS, lambda *a: None, None)
        t = ConversaComTurnos(s)
        c = M.ConversaFalada(t)
        c.comecar()
        falas = c.ouvir("Sou eu")
        self.assertTrue(falas)
        self.assertNotRegex(" ".join(falas), r"\d")    # nada de dígito na voz
        self.assertIsInstance(t, ConversaComTurnos)    # a Montagem segue com a conversa de dentro (transcrição)

    def test_pipecat_recebe_a_conversa_falada(self):
        src = (RAIZ / "voz" / "provedores" / "montagem.py").read_text(encoding="utf-8")
        self.assertIn("rodar_pipecat(ponte, ConversaFalada(s.conversa)", src)

    def test_previa_ouvir_tambem_por_extenso(self):
        visto = []
        r = SH.ouvir({"texto": "Fica 6× de R$ 230,00?"}, lambda t, v: (visto.append(t), (b"mp3", "audio/mpeg"))[1])
        self.assertEqual(visto, ["Fica seis vezes de duzentos e trinta reais?"])
        self.assertEqual(r["mime"], "audio/mpeg")


def _tom(segundos=1.0, hz=440.0, taxa=16000):
    n = int(segundos * taxa)
    return struct.pack(f"<{n}h", *(int(8000 * math.sin(2 * math.pi * hz * i / taxa)) for i in range(n)))


class TestSonsDoSistema(unittest.TestCase):
    def test_textos_neutros(self):
        self.assertEqual(set(S.SONS), {"sem-robo", "alo"})
        for nome, t in S.SONS.items():
            self.assertTrue(S.neutro(t), nome)
        self.assertFalse(S.neutro("Sobre a sua dívida com a Loja Exemplo."))
        self.assertFalse(S.neutro("Olá, {{primeiro_nome}}."))
        self.assertFalse(S.neutro("Ligue 0800 123 4567."))

    def test_converte_para_8k_mono_16_bits(self):
        pcm = S.para_8k(_tom(1.0))
        self.assertEqual(len(pcm), 8000 * 2)
        with wave.open(io.BytesIO(S.wav(pcm))) as w:
            self.assertEqual((w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()), (8000, 1, 2, 8000))
        # acima de 4 kHz (que serrilharia em 8 kHz) o filtro tira quase tudo; o tom de 440 Hz passa
        alto = struct.unpack("<8000h", S.para_8k(_tom(1.0, hz=6000)))
        baixo = struct.unpack("<8000h", pcm)
        self.assertLess(max(map(abs, alto[100:-100])), 0.05 * max(map(abs, baixo[100:-100])))

    def test_gera_os_arquivos_e_recusa_texto_que_revela(self):
        pedidos = []
        with tempfile.TemporaryDirectory() as d:
            feitos = S.gerar(Path(d), lambda t: (pedidos.append(t), _tom(1.2))[1])
            self.assertEqual(sorted(p.name for p in feitos), ["alo.wav", "sem-robo.wav"])
            self.assertEqual(sorted(x.name for x in Path(d).iterdir()), ["alo.wav", "sem-robo.wav"])   # sem temporário
            with wave.open(str(Path(d) / "sem-robo.wav")) as w:
                self.assertEqual((w.getframerate(), w.getnchannels(), w.getsampwidth()), (8000, 1, 2))
            self.assertEqual(sorted(pedidos), sorted(S.SONS.values()))
            with self.assertRaises(ValueError):
                S.gerar(Path(d), lambda t: _tom(1), {"x": "Consta R$ 1.380,00 da sua dívida."})
            with self.assertRaises(RuntimeError):
                S.gerar(Path(d), lambda t: b"", {"alo": "Alô?"})

    def test_elevenlabs_pede_pcm_16k_e_a_chave_so_no_cabecalho(self):
        visto = {}

        class Resp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self, n):
                return _tom(0.5)

        def abrir(req, timeout):
            visto["url"], visto["corpo"], visto["chave"] = req.full_url, req.data.decode(), req.get_header("Xi-api-key")
            return Resp()
        sint = S.sintetizador_elevenlabs("CHAVE-SECRETA-123", "VozPtBr_01", "eleven_multilingual_v2", abrir=abrir)
        self.assertEqual(len(sint("Alô?")), 16000)
        self.assertIn("/text-to-speech/VozPtBr_01?output_format=pcm_16000", visto["url"])
        self.assertNotIn("CHAVE", visto["url"] + visto["corpo"])
        self.assertEqual(visto["chave"], "CHAVE-SECRETA-123")
        with self.assertRaises(ValueError):
            S.sintetizador_elevenlabs("k", "")

    def test_script_da_vm(self):
        vm = RAIZ / "infra" / "asterisk" / "vm"
        sons = (vm / "motorcx-voz-sons").read_text(encoding="utf-8")
        rodar = (vm / "motorcx-voz-rodar").read_text(encoding="utf-8")
        self.assertIn("motorcx-voz-sons", (vm / "vm_inicio.sh").read_text(encoding="utf-8"))
        self.assertIn("python3 -m voz.sons_sistema --saida /var/motorcx/sons", rodar)
        self.assertIn("-v /var/motorcx/sons:/var/lib/asterisk/sounds/motorcx:ro", rodar)
        self.assertIn("/var/lib/asterisk/sounds/motorcx", sons)
        self.assertNotRegex(sons + rodar, r"(?i)xi-api-key|api_key=|echo .*CHAVE")


if __name__ == "__main__":
    unittest.main()
