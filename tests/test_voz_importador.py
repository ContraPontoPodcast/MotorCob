"""Importador das gravações do discador do cliente (SQL 64): manifesto, fontes (envio pelo site, SFTP e HTTPS com
fakes), rodada completa (par, bucket, registro, fila do Whisper, reimportação) e o registro da transcrição.
Sem rede, sem banco e sem paramiko. Só dados fictícios (IDs CLI-xxxx, operador OP-7, CPF gerado só para provar a
recusa, telefone (11) 98765-4321 de exemplo)."""
from __future__ import annotations

import io
import json
import socket
import stat
import tempfile
import unittest
import urllib.error
import wave
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from voz import acesso as A
from voz import banco as B
from voz.importador import fontes as F
from voz.importador import manifesto as M
from voz.importador import rotina as R
from voz.transcricao import worker as W

TZ = ZoneInfo("America/Sao_Paulo")
AGORA = datetime(2026, 11, 20, 12, 0, tzinfo=TZ)
ONTEM = (AGORA - timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")


def cpf_ficticio(base9="123456789"):
    d = base9
    for n in (9, 10):
        s = sum(int(d[i]) * (n + 1 - i) for i in range(n))
        d += str((s * 10 % 11) % 10)
    return d


CPF = cpf_ficticio()
FONE = "(11) 98765-4321"


def wav(segundos: float = 2.0) -> bytes:
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(b"\x00\x00" * int(8000 * segundos))
    return b.getvalue()


MP3 = b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\x00" * 64


def csv_(*linhas, cab="id_chamada;inicio;duracao_s;arquivo;operador_ref;id_cliente;carteira;id_chamada_motorcx"):
    return ("\n".join([cab, *linhas]) + "\n").encode()


# ------------------------------------------------------------------ banco falso (mesmas RPCs, regra simplificada)
class BancoFalso:
    def __init__(self, fontes=None, pares=None, apagar=None):
        self.fontes, self.pares, self.apagar = fontes or [], pares or {}, apagar or []
        self.chamadas: list[tuple[str, dict]] = []
        self.gravacoes: dict[str, dict] = {}
        self.arquivos: list[dict] = []
        self.execucoes: dict[int, dict] = {}
        self.storage: dict[str, bytes] = {}
        self.apagados: list[str] = []
        self.transcricoes: dict[int, str] = {}

    def rpc(self, nome, args=None):
        args = args or {}
        self.chamadas.append((nome, json.loads(json.dumps(args, default=str))))
        return getattr(self, "_" + nome)(**args)

    def _importacao_voz_pendente(self, parte):
        return {"fontes": self.fontes, "apagar": self.apagar}

    def _iniciar_importacao_voz(self, fonte, origem, lote=None):
        eid = len(self.execucoes) + 1
        self.execucoes[eid] = {"fonte": fonte, "origem": origem, "lote": lote, "erro": None, "fim": False}
        return eid

    def _arquivos_lidos_importacao_voz(self, fonte, assinaturas):
        lidos = {a["assinatura"] for a in self.arquivos if not a.get("repetir") and not a.get("erro")}
        return [a for a in assinaturas if a in lidos]

    def _preparar_importacao_voz(self, execucao, linhas):
        out = []
        for l in linhas:
            g = self.gravacoes.get(l["chave"])
            r = {"chave": l["chave"], "existe": g is not None}
            if g:
                r.update(gravacao_id=g["id"], caminho=g["caminho"], chamada_atual=g["chamada_id"])
            par = self.pares.get(l.get("id_chamada_motorcx") or "")
            if par:
                r.update(situacao="casada", chamada_id=par["id"], credor_id=par.get("credor_id"),
                         id_cliente=par["id_cliente"], id_acao=par.get("id_acao"))
            elif l.get("id_cliente") and not l.get("id_chamada_motorcx"):
                r.update(situacao="avulsa", id_cliente=l["id_cliente"], credor_id=l.get("credor_id"))
            else:
                r.update(situacao="quarentena", motivo="sem_par")
            out.append(r)
        return out

    def _registrar_importacao_voz(self, execucao, gravacoes):
        out = []
        for g in gravacoes:
            atual = self.gravacoes.get(g["chave"])
            if atual:
                atual["chamada_id"] = atual["chamada_id"] or g.get("chamada_id")
                out.append({"chave": g["chave"], "gravacao_id": atual["id"], "nova": False})
                continue
            gid = 100 + len(self.gravacoes)
            self.gravacoes[g["chave"]] = {**g, "id": gid}
            out.append({"chave": g["chave"], "gravacao_id": gid, "nova": True})
        return out

    def _registrar_arquivo_importacao_voz(self, execucao, arquivo):
        self.arquivos.append({**arquivo, "execucao": execucao})
        return len(self.arquivos)

    def _concluir_importacao_voz(self, execucao, erro=None):
        self.execucoes[execucao].update(erro=erro, fim=True)
        return {}

    def _marcar_envio_gravacoes_apagado(self, lote):
        return None

    def _registrar_transcricao_voz(self, empresa, itens):
        mins = 0.0
        for i in itens:
            if i["situacao"] == "ok" and self.transcricoes.get(i["gravacao_id"]) != "ok":
                mins += (i.get("duracao_s") or 0) / 60
            self.transcricoes[i["gravacao_id"]] = i["situacao"]
        return {"atualizadas": len(itens), "minutos": round(mins, 2)}

    def baixar(self, bucket, caminho):
        assert bucket == "gravacoes-discador"
        return self.storage[caminho]

    def apagar_arquivos(self, bucket, caminhos):
        self.apagados += list(caminhos)

    def tudo(self) -> str:
        return json.dumps(self.chamadas, ensure_ascii=False, default=str)


def fonte_envio(lotes, **kw):
    return {"fonte_id": 7, "empresa_id": 12, "slug": "alfa", "forma": "arquivo", "bucket": "proj-motorcx-grav-e12",
            "transcrever": True, "carteiras": {"cartao": 31}, "so_transferencias": True, "motivo": "envio",
            "lotes": lotes, **kw}


LOTE_PASTA = "alfa/0f8e2a1c-1b2c-4d3e-8f9a-0123456789ab"


# ------------------------------------------------------------------ manifesto
class TestManifesto(unittest.TestCase):
    def ler(self, conteudo, **kw):
        return M.ler(conteudo, kw.pop("nome", "m.csv"), 12, {"cartao": 31}, kw.pop("forma", "arquivo"), AGORA)

    def test_chave_sem_digito_e_estavel(self):
        c = M.chave(12, "88120-17")
        self.assertRegex(c, r"^[a-p]{24}$")
        self.assertEqual(c, M.chave(12, "88120-17"))
        self.assertNotEqual(c, M.chave(13, "88120-17"))           # por empresa

    def test_csv_com_apelidos_e_ponto_e_virgula(self):
        r = self.ler(csv_(f"88120-17;{ONTEM};93;g1.wav;OP-7;CLI-0001;cartao;",
                          cab="Call ID;Data Hora;Duração;Gravação;Operador;Código Cliente;Carteira;id_chamada_motorcx"))
        self.assertEqual(r.rejeicoes, [])
        ln = r.linhas[0]
        self.assertEqual((ln.id_chamada, ln.duracao_s, ln.operador_ref, ln.id_cliente, ln.credor_id, ln.extensao),
                         ("88120-17", 93, "OP-7", "CLI-0001", 31, "wav"))
        self.assertEqual(ln.inicio.tzinfo, TZ)
        self.assertEqual(ln.ref, "88120-17")

    def test_json_lista_ou_objeto(self):
        corpo = json.dumps({"gravacoes": [{"id_chamada": "c-1", "inicio": "2026-11-19T10:00:00-03:00",
                                           "duracao_s": 12, "url": "https://grav.exemplo.com.br/a/c-1.mp3"}]}).encode()
        r = self.ler(corpo, nome="lista.json", forma="url")
        self.assertEqual((len(r.linhas), r.linhas[0].url, r.linhas[0].extensao), (1, "https://grav.exemplo.com.br/a/c-1.mp3", "mp3"))

    def test_coluna_de_dado_pessoal_recusa_o_arquivo(self):
        for col in ("cpf", "Nome do Cliente", "telefone", "E-mail", "numero_discado", "CPF/CNPJ"):
            with self.assertRaises(M.ErroManifesto) as cm:
                self.ler(csv_(f"c-1;{ONTEM};10;a.wav;x", cab=f"id_chamada;inicio;duracao_s;arquivo;{col}"))
            self.assertIn("dado pessoal", str(cm.exception))

    def test_estrito_coluna_desconhecida_ou_faltando(self):
        with self.assertRaises(M.ErroManifesto):
            self.ler(csv_(f"c-1;{ONTEM};10;a.wav;x", cab="id_chamada;inicio;duracao_s;arquivo;observacao"))
        with self.assertRaises(M.ErroManifesto):
            self.ler(csv_(f"c-1;{ONTEM};a.wav", cab="id_chamada;inicio;arquivo"))
        with self.assertRaises(M.ErroManifesto):                       # HTTPS precisa da url
            self.ler(csv_(f"c-1;{ONTEM};10;a.wav", cab="id_chamada;inicio;duracao_s;arquivo"), forma="url")
        with self.assertRaises(M.ErroManifesto):
            self.ler(b"[1, 2]", nome="x.json")

    def test_linhas_com_dado_pessoal_ou_invalidas_vao_para_a_quarentena(self):
        r = self.ler(csv_(
            f"c-1;{ONTEM};10;a.wav;OP-7;{CPF};;",                                   # CPF no id_cliente
            f"c-2;{ONTEM};10;a.wav;{FONE};CLI-2;;",                                  # telefone no operador
            f"c-3;{ONTEM};10;a.wav;OP-7;fulano@exemplo.com;;",                       # e-mail
            f"c-4;31/02/2026 10:00;10;a.wav;OP-7;CLI-4;;",                           # data impossível
            f"c-5;2025-01-01 10:00;10;a.wav;OP-7;CLI-5;;",                           # fora da janela
            f"c-6;{ONTEM};-1;a.wav;OP-7;CLI-6;;",                                    # duração
            f"c-7;{ONTEM};10;a.wav;OP-7;CLI-7;outra;",                               # carteira de outra empresa
            f"c-8;{ONTEM};10;grav_{CPF}.wav;OP-7;CLI-8;;",                           # CPF no nome do arquivo
            f"c-9;{ONTEM};10;a.gsm;OP-7;CLI-9;;",                                    # formato
            f"c-1;{ONTEM};10;b.wav;OP-7;CLI-1;;",                                    # repetida (a 1ª foi recusada)
            f"c-10;{ONTEM};10;../fora.wav;OP-7;CLI-10;;",                            # caminho para fora
            f"c-11;{ONTEM};10;b.wav;OP-7;Maria Silva;;",                             # nome (espaço) não é código
            f"c-12;{ONTEM};10;c.wav;OP-7;CLI-12;;",                                  # boa
        ))
        motivos = [x.motivo for x in r.rejeicoes]
        self.assertEqual(motivos, ["dado_pessoal", "dado_pessoal", "dado_pessoal", "campo_invalido", "campo_invalido",
                                   "campo_invalido", "carteira_desconhecida", "nome_com_dado_pessoal", "formato",
                                   "audio_ausente", "campo_invalido"])
        self.assertEqual([l.id_chamada for l in r.linhas], ["c-1", "c-12"])      # c-1 da 10ª linha (a 1ª foi recusada)
        self.assertEqual(r.total, 13)
        tudo = json.dumps([x.para_banco() for x in r.rejeicoes], ensure_ascii=False)
        for proibido in (CPF, "98765", "fulano@", "Maria"):
            self.assertNotIn(proibido, tudo)

    def test_id_com_10_digitos_vira_referencia_mascarada(self):
        r = self.ler(csv_(f"1698765432.123;{ONTEM};10;x.wav;OP-7;CLI-1;;"))
        self.assertEqual(r.linhas[0].id_chamada, "1698765432.123")
        self.assertRegex(r.linhas[0].ref, r"^h-[a-p]{10}$")

    def test_duplicada_no_arquivo(self):
        r = self.ler(csv_(f"c-1;{ONTEM};10;a.wav;;CLI-1;;", f"c-1;{ONTEM};10;b.wav;;CLI-1;;"))
        self.assertEqual([x.motivo for x in r.rejeicoes], ["duplicada_no_arquivo"])

    def test_audio_pelo_conteudo(self):
        self.assertTrue(M.audio_confere("wav", wav()))
        self.assertTrue(M.audio_confere("mp3", MP3))
        self.assertTrue(M.audio_confere("opus", b"OggS" + b"\x00" * 20))
        self.assertFalse(M.audio_confere("wav", MP3))
        self.assertFalse(M.audio_confere("wav", b"MZ" + b"\x00" * 30))

    def test_dado_pessoal(self):
        for v in (CPF, f"{CPF[:3]}.{CPF[3:6]}.{CPF[6:9]}-{CPF[9:]}", FONE, "11987654321", "a@b.com.br"):
            self.assertTrue(M.tem_dado_pessoal(v), v)
        for v in ("OP-7", "CLI-0001", "acao-2026-11-19", "88120-17"):
            self.assertFalse(M.tem_dado_pessoal(v), v)


# ------------------------------------------------------------------ rodada completa: envio pelo site
class TestEnvioPeloSite(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.saida = Path(self.tmp.name) / "importadas"
        self.bucket = R.BucketLocal(Path(self.tmp.name) / "gcs")

    def montar(self, manifesto: bytes, audios: dict[str, bytes], zip_: dict[str, bytes] | None = None):
        sb = BancoFalso(pares={"mcx-1": {"id": 501, "id_cliente": "CLI-0001", "id_acao": "A-9", "credor_id": 31}})
        arquivos = [{"caminho": f"{LOTE_PASTA}/1.csv", "nome_hash": F.hash_nome("manifesto.csv"), "tamanho": len(manifesto)}]
        sb.storage[f"{LOTE_PASTA}/1.csv"] = manifesto
        for i, (nome, dados) in enumerate(audios.items(), start=2):
            cam = f"{LOTE_PASTA}/{i}.{nome.rsplit('.', 1)[1]}"
            sb.storage[cam] = dados
            arquivos.append({"caminho": cam, "nome_hash": F.hash_nome(nome), "tamanho": len(dados)})
        if zip_:
            b = io.BytesIO()
            with zipfile.ZipFile(b, "w") as z:
                for nome, dados in zip_.items():
                    z.writestr(nome, dados)
            sb.storage[f"{LOTE_PASTA}/99.zip"] = b.getvalue()
            arquivos.append({"caminho": f"{LOTE_PASTA}/99.zip", "nome_hash": F.hash_nome("pacote.zip"), "tamanho": 1})
        sb.fontes = [fonte_envio([{"id": 3, "arquivos": arquivos}])]
        return sb

    def test_casada_quarentena_avulsa_bucket_fila_e_registro(self):
        man = csv_(f"88120-17;{ONTEM};93;Gravacao A.WAV;OP-7;;cartao;mcx-1",       # casada pela transferência
                   f"88121-02;{ONTEM};40;b.wav;;CLI-0002;;mcx-desconhecida",        # sem par -> quarentena
                   f"88122-03;{ONTEM};30;faltando.wav;OP-8;CLI-0003;;",              # avulsa, mas sem áudio
                   f"88123-04;{ONTEM};20;falso.wav;OP-8;CLI-0004;;",                 # avulsa com áudio que não é wav
                   f"88124-05;{ONTEM};25;pasta/c.mp3;OP-9;CLI-0005;;")               # avulsa ok (mp3)
        sb = self.montar(man, {"gravacao a.wav": wav(3), "b.wav": wav(), "falso.wav": MP3, "c.mp3": MP3})
        out = R.Importador(sb, self.bucket, self.saida, AGORA).rodar("1/2")
        self.assertEqual((out["importadas"], out["casadas"], out["rejeitadas"], out["execucoes"]), (2, 1, 3, 1))
        rel = sb.arquivos[0]
        self.assertEqual((rel["linhas"], rel["importadas"], rel["casadas"], rel["rejeitadas"], rel["sem_operador"]),
                         (5, 2, 1, 3, 0))
        self.assertEqual(rel["motivos"], {"sem_par": 1, "audio_ausente": 1, "audio_invalido": 1})
        self.assertEqual(sorted(q["motivo"] for q in rel["quarentena"]), ["audio_ausente", "audio_invalido", "sem_par"])
        self.assertEqual(rel["nome"], "envio 3 · manifesto 1")
        # bucket da empresa: discador/<AAAA>/<MM>/<DD>/<chave>.<ext>, sem o nome original
        ch = M.chave(12, "88120-17")
        dia = (AGORA - timedelta(days=1)).strftime("%Y/%m/%d")
        self.assertTrue((Path(self.tmp.name) / "gcs" / "proj-motorcx-grav-e12" / "discador" / dia / f"{ch}.wav").exists())
        g = sb.gravacoes[ch]
        self.assertEqual((g["chamada_id"], g["id_cliente"], g["id_acao"], g["operador_ref"], g["credor_id"]),
                         (501, "CLI-0001", "A-9", "OP-7", 31))
        # fila do Whisper: <gravacao>.<ext> + <gravacao>.json (duração do manifesto), 0600
        a = self.saida / "empresa_12" / f"{g['id']}.wav"
        self.assertTrue(a.exists())
        self.assertEqual(oct(a.stat().st_mode & 0o777), "0o600")
        self.assertEqual(json.loads((self.saida / "empresa_12" / f"{g['id']}.json").read_text()), {"duracao_s": 93})
        self.assertEqual(sb.execucoes[1], {"fonte": 7, "origem": "envio", "lote": 3, "erro": None, "fim": True})

    def test_reimportar_nao_duplica(self):
        man = csv_(f"88120-17;{ONTEM};93;a.wav;OP-7;;cartao;mcx-1")
        sb = self.montar(man, {"a.wav": wav()})
        imp = R.Importador(sb, self.bucket, self.saida, AGORA)
        imp.rodar()
        out = imp.rodar()                                             # o mesmo lote de novo (ex.: reprocessado)
        self.assertEqual((out.get("importadas", 0), out["duplicadas"]), (0, 1))
        self.assertEqual(len(sb.gravacoes), 1)
        self.assertEqual(len(list((self.saida / "empresa_12").glob("*.wav"))), 1)

    def test_zip_com_manifesto_e_audios(self):
        sb = self.montar(csv_(f"88120-17;{ONTEM};93;a.wav;OP-7;;cartao;mcx-1"), {"a.wav": wav()},
                         zip_={"lote/indice.csv": csv_(f"z-1;{ONTEM};12;sub/z1.wav;OP-1;CLI-9;;"),
                               "lote/sub/z1.wav": wav(), "../fora.csv": b"x"})
        out = R.Importador(sb, self.bucket, self.saida, AGORA).rodar()
        self.assertEqual((out["arquivos"], out["importadas"]), (2, 2))
        self.assertIn("indice.csv", sb.arquivos[1]["nome"])

    def test_lgpd_nada_pessoal_vai_ao_banco(self):
        man = csv_(f"88120-17;{ONTEM};93;a.wav;OP-7;{CPF};;", f"c-2;{ONTEM};10;b.wav;{FONE};CLI-2;;",
                   f"{CPF};{ONTEM};10;c.wav;OP-7;CLI-3;;")
        sb = self.montar(man, {"a.wav": wav(), "b.wav": wav(), "c.wav": wav()})
        R.Importador(sb, self.bucket, self.saida, AGORA).rodar()
        tudo = sb.tudo()
        for proibido in (CPF, "98765-4321", "(11)"):
            self.assertNotIn(proibido, tudo)
        self.assertEqual(sb.arquivos[0]["motivos"].get("dado_pessoal"), 2)

    def test_sem_bucket_fecha_com_erro(self):
        sb = self.montar(csv_(f"c-1;{ONTEM};10;a.wav;;CLI-1;;"), {"a.wav": wav()})
        sb.fontes[0]["bucket"] = None
        R.Importador(sb, self.bucket, self.saida, AGORA).rodar()
        self.assertIn("bucket", sb.execucoes[1]["erro"])
        self.assertEqual(sb.gravacoes, {})

    def test_manifesto_recusado_vai_para_o_registro(self):
        sb = self.montar(csv_(f"c-1;{ONTEM};10;a.wav;x", cab="id_chamada;inicio;duracao_s;arquivo;cpf"), {})
        out = R.Importador(sb, self.bucket, self.saida, AGORA).rodar()
        self.assertEqual(out["arquivos_recusados"], 1)
        self.assertIn("dado pessoal", sb.arquivos[0]["erro"])

    def test_sem_transcricao_nao_deixa_audio_na_vm(self):
        sb = self.montar(csv_(f"88120-17;{ONTEM};93;a.wav;OP-7;;cartao;mcx-1"), {"a.wav": wav()})
        sb.fontes[0]["transcrever"] = False
        R.Importador(sb, self.bucket, self.saida, AGORA).rodar()
        self.assertEqual(len(sb.gravacoes), 1)
        self.assertFalse(self.saida.exists())
        self.assertFalse(next(iter(sb.gravacoes.values()))["transcrever"])

    def test_apaga_lotes_concluidos(self):
        sb = BancoFalso(apagar=[{"lote": 3, "caminhos": [f"{LOTE_PASTA}/1.csv"]}])
        out = R.Importador(sb, self.bucket, self.saida, AGORA).rodar()
        self.assertEqual((out["lotes_apagados"], sb.apagados), (1, [f"{LOTE_PASTA}/1.csv"]))
        self.assertIn(("marcar_envio_gravacoes_apagado", {"lote": 3}), sb.chamadas)


# ------------------------------------------------------------------ SFTP (cliente falso)
class SFTPFalso:
    def __init__(self, arquivos: dict[str, tuple[bytes, int]]):
        self.arquivos = arquivos          # caminho -> (conteúdo, mtime)
        self.fechado = False

    def _filhos(self, pasta):
        pasta = pasta.rstrip("/")
        nomes = {}
        for c, (d, mt) in self.arquivos.items():
            if c.startswith(pasta + "/"):
                resto = c[len(pasta) + 1:]
                if "/" in resto:
                    nomes.setdefault(resto.split("/")[0], ("dir", mt))
                else:
                    nomes[resto] = (d, mt)
        return nomes

    def listdir_attr(self, pasta):
        filhos = self._filhos(pasta)
        if not filhos:
            raise IOError("sem pasta")
        out = []
        for nome, (d, mt) in filhos.items():
            modo = stat.S_IFDIR if d == "dir" else stat.S_IFREG
            out.append(SimpleNamespace(filename=nome, st_mode=modo, st_mtime=mt, st_size=0 if d == "dir" else len(d)))
        return out

    def stat(self, caminho):
        if caminho not in self.arquivos:
            raise IOError("não existe")
        return SimpleNamespace(st_size=len(self.arquivos[caminho][0]))

    def open(self, caminho, modo="rb"):
        return io.BytesIO(self.arquivos[caminho][0])

    def close(self):
        self.fechado = True


class TestSFTP(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.saida = Path(self.tmp.name) / "importadas"
        self.bucket = R.BucketLocal(Path(self.tmp.name) / "gcs")
        self.mt = AGORA.timestamp() - 3600
        self.cfg = {"fonte_id": 8, "empresa_id": 12, "forma": "sftp", "bucket": "b-e12", "transcrever": False,
                    "carteiras": {}, "pasta": "/gravacoes", "dias_busca": 7, "motivo": "agendada", "host": "sftp.exemplo.com.br"}

    def rodar(self, sftp, sb=None):
        sb = sb or BancoFalso(fontes=[self.cfg])
        imp = R.Importador(sb, self.bucket, self.saida, AGORA)
        out = imp.rodar(abrir_fonte=lambda _sb, f, _l: F.FonteSFTP(f, sftp, agora_s=AGORA.timestamp()))
        return sb, out

    def test_le_subpasta_relativo_ao_manifesto_e_nao_le_de_novo(self):
        sftp = SFTPFalso({
            "/gravacoes/2026-11-19/indice.csv": (csv_(f"s-1;{ONTEM};30;s1.wav;OP-1;CLI-1;;",
                                                      f"s-2;{ONTEM};30;../../etc/passwd.wav;OP-1;CLI-2;;",
                                                      f"s-3;{ONTEM};30;x/../../fora.wav;OP-1;CLI-3;;"), self.mt),
            "/gravacoes/2026-11-19/s1.wav": (wav(), self.mt),
            "/gravacoes/antigo.csv": (csv_(f"s-9;{ONTEM};30;s9.wav;OP-1;CLI-9;;"), self.mt - 30 * 86400),
        })
        sb, out = self.rodar(sftp)
        self.assertEqual((out["importadas"], out["rejeitadas"]), (1, 2))   # o antigo (fora de dias_busca) fica
        self.assertTrue(sftp.fechado)
        self.assertEqual(sb.arquivos[0]["nome"], "2026-11-19/indice.csv")
        sb.fontes = [self.cfg]
        _, out2 = self.rodar(sftp, sb)
        self.assertEqual((out2.get("arquivos", 0), out2["ja_lidos"]), (0, 1))
        sb.fontes = [{**self.cfg, "reprocessar": True}]
        _, out3 = self.rodar(sftp, sb)
        self.assertEqual((out3["arquivos"], out3["duplicadas"]), (1, 1))

    def test_pasta_inexistente_fecha_com_erro(self):
        sb, out = self.rodar(SFTPFalso({}))
        self.assertIn("pasta do SFTP", sb.execucoes[1]["erro"])
        self.assertEqual(out["erros"], 1)


# ------------------------------------------------------------------ HTTPS (abridor falso)
class Resp:
    def __init__(self, corpo: bytes, tam=None):
        self.corpo = corpo
        self.headers = {"Content-Length": str(tam if tam is not None else len(corpo))}

    def read(self, n=-1):
        return self.corpo if n < 0 else self.corpo[:n]

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def resolver_publico(host, porta):
    ips = {"interno.exemplo.com.br": "10.0.0.5"}
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ips.get(host, "34.39.0.10"), 0))]


class TestHTTPS(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.bucket = R.BucketLocal(Path(self.tmp.name) / "gcs")
        self.cfg = {"fonte_id": 9, "empresa_id": 12, "forma": "url", "bucket": "b-e12", "transcrever": False,
                    "carteiras": {}, "motivo": "pedido", "url_lista": "https://api.discador.exemplo.com.br/gravacoes",
                    "dominios_url": ["discador.exemplo.com.br", "interno.exemplo.com.br"]}
        self.pedidos = []

    def abrir(self, paginas, audios):
        def _abrir(req, timeout=None):
            self.pedidos.append((req.full_url, req.get_header("Authorization")))
            if req.full_url in paginas:
                return Resp(paginas[req.full_url])
            if req.full_url in audios:
                v = audios[req.full_url]
                if isinstance(v, int):
                    raise urllib.error.HTTPError(req.full_url, v, "x", {}, None)
                return Resp(v)
            raise urllib.error.HTTPError(req.full_url, 404, "x", {}, None)
        return _abrir

    def test_lista_paginada_dominios_e_ssrf(self):
        p1 = json.dumps({"gravacoes": [
            {"id_chamada": "h-1", "inicio": ONTEM, "duracao_s": 10, "id_cliente": "CLI-1",
             "url": "https://grav.discador.exemplo.com.br/h1.wav"},
            {"id_chamada": "h-2", "inicio": ONTEM, "duracao_s": 10, "id_cliente": "CLI-2",
             "url": "https://outro.exemplo.net/h2.wav"},                        # domínio fora da lista
            {"id_chamada": "h-3", "inicio": ONTEM, "duracao_s": 10, "id_cliente": "CLI-3",
             "url": "https://interno.exemplo.com.br/h3.wav"},                   # resolve para rede interna
            {"id_chamada": "h-4", "inicio": ONTEM, "duracao_s": 10, "id_cliente": "CLI-4",
             "url": "http://grav.discador.exemplo.com.br/h4.wav"}],             # sem TLS
            "proxima": "https://api.discador.exemplo.com.br/gravacoes?p=2"}).encode()
        p2 = json.dumps([{"id_chamada": "h-5", "inicio": ONTEM, "duracao_s": 10, "id_cliente": "CLI-5",
                          "url": "https://grav.discador.exemplo.com.br/h5.mp3"}]).encode()
        abrir = self.abrir({self.cfg["url_lista"]: p1, "https://api.discador.exemplo.com.br/gravacoes?p=2": p2},
                           {"https://grav.discador.exemplo.com.br/h1.wav": wav(),
                            "https://grav.discador.exemplo.com.br/h5.mp3": 503})
        sb = BancoFalso(fontes=[self.cfg])
        out = R.Importador(sb, self.bucket, Path(self.tmp.name), AGORA).rodar(
            abrir_fonte=lambda _sb, f, _l: F.FonteHTTPS(f, token="token-ficticio", abrir=abrir, resolver=resolver_publico))
        self.assertEqual((out["arquivos"], out["importadas"]), (2, 1))
        self.assertEqual(sb.arquivos[0]["motivos"], {"url_nao_permitida": 3})
        self.assertEqual(sb.arquivos[1]["motivos"], {"download": 1})
        self.assertTrue(all(a == "Bearer token-ficticio" for _, a in self.pedidos))
        self.assertNotIn("token-ficticio", sb.tudo())
        self.assertNotIn("https://interno.exemplo.com.br/h3.wav", [u for u, _ in self.pedidos])

    def test_lista_fora_do_ar_fecha_com_erro(self):
        sb = BancoFalso(fontes=[self.cfg])
        R.Importador(sb, self.bucket, Path(self.tmp.name), AGORA).rodar(
            abrir_fonte=lambda _sb, f, _l: F.FonteHTTPS(f, abrir=self.abrir({}, {}), resolver=resolver_publico))
        self.assertIn("HTTP 404", sb.execucoes[1]["erro"])

    def test_dominio(self):
        self.assertTrue(F.dominio_autorizado("grav.discador.exemplo.com.br", ["discador.exemplo.com.br"]))
        self.assertFalse(F.dominio_autorizado("discador.exemplo.com.br.mal.net", ["discador.exemplo.com.br"]))
        self.assertFalse(F.endereco_publico("x", lambda h, p: [(0, 0, 0, "", ("169.254.169.254", 0))]))
        self.assertFalse(F.endereco_publico("x", lambda h, p: [(0, 0, 0, "", ("127.0.0.1", 0))]))


# ------------------------------------------------------------------ bucket GCS: 412 = já existia
class TestBucketGCS(unittest.TestCase):
    def test_412_conta_como_ja_importado(self):
        def abrir(req, timeout=None):
            raise urllib.error.HTTPError(req.full_url, 412, "x", {}, None)
        b = R.BucketGCS(token=lambda: "t", abrir=abrir)
        self.assertFalse(b.enviar("b-e12", "discador/2026/11/19/abc.wav", wav(), "audio/wav"))

        def abrir_ok(req, timeout=None):
            self.assertIn("ifGenerationMatch=0", req.full_url)
            self.assertIn("name=discador%2F2026%2F11%2F19%2Fabc.wav", req.full_url)
            return Resp(b"{}")
        self.assertTrue(R.BucketGCS(token=lambda: "t", abrir=abrir_ok).enviar("b-e12", "discador/2026/11/19/abc.wav",
                                                                              wav(), "audio/wav"))


# ------------------------------------------------------------------ worker: fila, apaga o áudio e registra
class TestWorkerRegistro(unittest.TestCase):
    def test_transcreve_mp3_apaga_audio_e_registra_uma_vez(self):
        with tempfile.TemporaryDirectory() as tmp:
            ent, sai = Path(tmp) / "ent", Path(tmp) / "sai"
            R.deixar_para_transcrever(ent, 12, 101, "mp3", MP3, 90)
            R.deixar_para_transcrever(ent, 12, 102, "wav", wav(1), 1)

            class T:
                codigo = "whisper"

                def transcrever(self, caminho, idioma="pt"):
                    from voz.transcricao.transcritores import Transcricao
                    return Transcricao("bom dia", [], idioma, "whisper")
            dados = B.carregar({"voz_config": [{"empresa_id": 12, "transcrever": True, "transcrever_min_segundos": 5}]})
            fonte = W.FontePasta(ent)
            self.assertEqual(W.Worker(dados, fonte, W.DestinoPasta(sai), T()).processar(),
                             {"ok": 1, "abaixo_limiar": 1, "desligada": 0, "erro": 0})
            self.assertEqual(sorted(p.name for p in (ent / "empresa_12").iterdir()),
                             ["101.situacao.json", "102.situacao.json"])        # áudio fora da VM
            self.assertTrue((sai / "empresa_12" / "101.json").exists())
            sb = BancoFalso()
            r = W.registrar_no_banco(sb, fonte)
            self.assertEqual((r["registradas"], r["minutos"]), (2, 1.5))
            self.assertEqual(sb.transcricoes, {101: "ok", 102: "abaixo_limiar"})
            self.assertEqual(W.registrar_no_banco(sb, fonte)["registradas"], 0)   # não manda de novo

    def test_banco_fora_fica_para_a_proxima(self):
        with tempfile.TemporaryDirectory() as tmp:
            ent = Path(tmp)
            (ent / "empresa_12").mkdir()
            (ent / "empresa_12" / "7.situacao.json").write_text(json.dumps({"situacao": "ok", "final": True,
                                                                           "registrado": False, "duracao_s": 60}))

            class Fora:
                def rpc(self, *a, **k):
                    raise OSError("fora")
            self.assertEqual(W.registrar_no_banco(Fora(), W.FontePasta(ent))["erros"], 1)
            self.assertEqual(len(W.FontePasta(ent).nao_registrados()[12]), 1)


# ------------------------------------------------------------------ os dois acessos da VM
class TestAcesso(unittest.TestCase):
    def test_rpcs_do_importador_pelo_voz_vm(self):
        for pub, vm in (("importacao_voz_pendente", "importacao_pendente"), ("iniciar_importacao_voz", "iniciar_importacao"),
                        ("arquivos_lidos_importacao_voz", "arquivos_lidos_importacao"),
                        ("preparar_importacao_voz", "preparar_importacao"),
                        ("registrar_importacao_voz", "registrar_importacao"),
                        ("registrar_arquivo_importacao_voz", "registrar_arquivo_importacao"),
                        ("concluir_importacao_voz", "concluir_importacao"),
                        ("marcar_envio_gravacoes_apagado", "marcar_envio_apagado"),
                        ("registrar_transcricao_voz", "registrar_transcricao")):
            self.assertEqual(A.RPC[pub], vm)

    def test_cada_rpc_tem_funcao_de_voz_vm_e_grant_no_sql_64(self):
        sql = (Path(__file__).resolve().parents[1] / "supabase" / "migrations" / "20261231000001_voz_importador.sql").read_text()
        for pub in ("importacao_voz_pendente", "iniciar_importacao_voz", "arquivos_lidos_importacao_voz",
                    "preparar_importacao_voz", "registrar_importacao_voz", "registrar_arquivo_importacao_voz",
                    "concluir_importacao_voz", "marcar_envio_gravacoes_apagado", "registrar_transcricao_voz"):
            self.assertIn(f"function voz_vm.{A.RPC[pub]}(args jsonb)", sql)
            self.assertIn(f"function public.{pub}(", sql)
            self.assertRegex(sql, rf"grant execute on function[^;]*voz_vm\.{A.RPC[pub]}\(jsonb\)[^;]*to motorcx_voz;")

    def test_desligado_por_padrao(self):
        self.assertEqual(R.main(["--parte", "1/2"], ambiente={}), 0)
        self.assertFalse(R.ligado({}))
        self.assertTrue(R.ligado({"MOTORCX_IMPORTADOR_GRAVACOES": "1"}))


if __name__ == "__main__":
    unittest.main()
