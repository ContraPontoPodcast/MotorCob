"""Operação da voz na VM: configuração do banco -> voz.json, voz_chamadas e consumo_voz, publicação dos eventos
como retorno (envios), plantão com a Lista do dia do bucket saidas e o modo simulado (AriSimulado). Banco falso
em memória; nada de rede. Só dados fictícios."""
import csv
import json
import os
import queue
import tempfile
import threading
import unittest
from datetime import date, datetime, time, timedelta
from pathlib import Path

from motor.discagem import CAMPOS_MAILING
from tests.test_voz_gerador import dados_exemplo
from tests.test_voz_orquestrador import D0, Relogio
from voz import banco as B
from voz import configuracao as CF
from voz.orquestrador import principal as P
from voz.orquestrador.agendador import Agendador
from voz.orquestrador.ari import AriSimulado
from voz.orquestrador.eventos import EscritorEventos, EventoChamada
from voz.orquestrador.nucleo import Orquestrador
from voz.provedores.simulador import Simulador
from voz.publicacao import Publicador
from voz.registro import RegistroBanco

USUARIO = "00000000-0000-4000-8000-000000000001"


class SbFalso:
    """O pedaço de nuvem/supabase_api.Supabase que a voz usa, em memória."""

    def __init__(self, tabelas=None, arquivos=None):
        self.tabelas = {k: list(v) for k, v in (tabelas or {}).items()}
        self.arquivos = dict(arquivos or {})     # (bucket, caminho) -> bytes
        self.inseridos: list[tuple] = []
        self.falhar_inserir = False

    def selecionar(self, tabela, filtros=None, ordem=None, limite=None):
        linhas = list(self.tabelas.get(tabela, []))
        for k, v in (filtros or {}).items():
            if k in ("and", "offset"):
                continue
            op, val = v.split(".", 1)
            if op == "eq":
                linhas = [l for l in linhas if str(l.get(k)).lower() == val.lower()]
        if filtros and "and" in filtros:      # ocorrido_em.gte.X,ocorrido_em.lt.Y
            partes = filtros["and"].strip("()").split(",")
            ini, fim = partes[0].split(".gte.")[1], partes[1].split(".lt.")[1]
            linhas = [l for l in linhas if ini <= l["ocorrido_em"] < fim]
        off = int((filtros or {}).get("offset", 0))
        return linhas[off:off + limite] if limite else linhas

    def inserir(self, tabela, linhas, conflito=None, retornar=False, lote=1000):
        if self.falhar_inserir:
            raise RuntimeError("banco fora")
        linhas = linhas if isinstance(linhas, list) else [linhas]
        self.inseridos.append((tabela, conflito, linhas))
        t = self.tabelas.setdefault(tabela, [])
        chaves = conflito.split(",") if conflito else None
        for l in linhas:
            if chaves:
                t[:] = [x for x in t if any(x.get(k) != l.get(k) for k in chaves)]
            t.append(dict(l))
        return []

    def enviar(self, bucket, caminho, conteudo, tipo="text/csv"):
        self.arquivos[(bucket, caminho)] = conteudo

    def baixar(self, bucket, caminho):
        if (bucket, caminho) not in self.arquivos:
            raise RuntimeError("404")
        return self.arquivos[(bucket, caminho)]

    def apagar_arquivos(self, bucket, caminhos):
        for c in caminhos:
            self.arquivos.pop((bucket, c), None)


def ev(id_chamada, billsec=31, tp="1010", custo=0.03, hora=time(10, 0), dia=D0.date(), **kw):
    e = EventoChamada(empresa_id=1, id_cliente="C1", numero_discado="11988887770", data=dia, hora=hora,
                      id_chamada=id_chamada, billsec=billsec, tech_prefix=tp, rota_id=1 if tp else None,
                      segundos_tarifados=36 if billsec else 0, custo_operadora=custo, **kw)
    e.desfecho = "cpc"
    return e


class TestConfiguracao(unittest.TestCase):
    def test_busca_valida_e_grava_so_se_mudou(self):
        d = dados_exemplo()
        sb = SbFalso({**{t: d[t] for t in CF.TABELAS}, "voz_contrato": [{"concorrencia_contratada": 300}]})
        with tempfile.TemporaryDirectory() as tmp:
            saida = Path(tmp) / "voz.json"
            prov = Path(tmp) / "prov.json"
            prov.write_text(json.dumps(d["provedores_sip"]))
            argv = ["--saida", str(saida), "--provedores-sip", str(prov)]
            self.assertEqual(CF.main(argv, sb=sb), CF.MUDOU)
            gravado = json.loads(saida.read_text())
            self.assertEqual(gravado["voz_contrato"], {"concorrencia_contratada": 300})
            self.assertEqual(gravado["provedores_sip"][0]["nome"], "elevenlabs")
            self.assertEqual(oct(saida.stat().st_mode & 0o777), "0o644")
            self.assertEqual(len(B.carregar(gravado).troncos), 4)
            self.assertEqual(CF.main(argv, sb=sb), 0)                      # nada mudou
            sb.tabelas["voz_rotas"][0]["tipo"] = "satelite"                # quebrado no banco
            antes = saida.read_text()
            self.assertEqual(CF.main(argv, sb=sb), 2)
            self.assertEqual(saida.read_text(), antes)                     # o que está no ar fica
            self.assertNotIn("password", antes)

    def test_sem_voz_contrato(self):
        class SemContrato(SbFalso):
            def selecionar(self, tabela, *a, **k):
                if tabela == "voz_contrato":
                    raise RuntimeError("relation does not exist")
                return super().selecionar(tabela, *a, **k)
        d = CF.buscar(SemContrato({t: dados_exemplo()[t] for t in CF.TABELAS}))
        self.assertEqual(d["voz_contrato"], {"concorrencia_contratada": 0})


class TestRegistro(unittest.TestCase):
    def test_voz_chamadas_e_consumo(self):
        sb = SbFalso()
        r = RegistroBanco(sb)
        r.registrar(ev("a1"))
        r.registrar(ev("a2", billsec=0, custo=0.0))
        r.registrar(ev("a3", tp=None, custo=None, billsec=12))
        self.assertEqual(r.descarregar(), 3)
        self.assertEqual(sb.inseridos[0][1], "id_chamada")
        linha = sb.tabelas["voz_chamadas"][0]
        self.assertEqual(linha["ocorrido_em"], "2026-11-03T10:00:00-03:00")
        self.assertNotIn("numero_discado", linha)
        r.registrar(ev("a1"))                                       # reenvio: upsert, não duplica
        r.descarregar()
        self.assertEqual(len(sb.tabelas["voz_chamadas"]), 3)
        self.assertEqual(r.atualizar_consumo(), 2)
        cons = {c["tech_prefix"]: c for c in sb.tabelas["consumo_voz"]}
        self.assertEqual(cons["1010"], {"empresa_id": 1, "dia": "2026-11-03", "tech_prefix": "1010", "rota_id": 1,
                                        "chamadas": 2, "chamadas_atendidas": 1, "segundos_atendidos": 31,
                                        "segundos_tarifados": 36, "custo_estimado": 0.03, "sem_custo": 0})
        self.assertEqual((cons[""]["custo_estimado"], cons[""]["sem_custo"]), (None, 1))
        self.assertEqual(r.atualizar_consumo(), 0)                   # nada novo

    def test_consumo_nao_mistura_dias_nem_soma_em_dobro(self):
        sb = SbFalso()
        r = RegistroBanco(sb)
        r.registrar(ev("a1", hora=time(23, 59)))
        r.registrar(ev("b1", dia=D0.date() + timedelta(days=1), hora=time(0, 1)))
        r.descarregar()
        r.atualizar_consumo()
        r2 = RegistroBanco(sb)                                       # a outra VM recalcula o mesmo dia
        r2.tocados.add((1, D0.date()))
        r2.atualizar_consumo()
        dias = sorted((c["dia"], c["chamadas"]) for c in sb.tabelas["consumo_voz"])
        self.assertEqual(dias, [("2026-11-03", 1), ("2026-11-04", 1)])

    def test_banco_fora_guarda_na_fila(self):
        sb = SbFalso()
        sb.falhar_inserir = True
        r = RegistroBanco(sb)
        r.registrar(ev("a1"))
        self.assertEqual(r.descarregar(), 0)
        self.assertEqual(len(r.fila), 1)
        sb.falhar_inserir = False
        self.assertEqual(r.descarregar(), 1)

    def test_paginacao(self):
        from voz import registro as RG
        sb = SbFalso({"voz_chamadas": [{"empresa_id": 1, "id_chamada": f"x{i:05d}", "billsec": 1,
                                        "tech_prefix": "1", "segundos_tarifados": 1, "custo_operadora": 0.001,
                                        "rota_id": 1, "ocorrido_em": "2026-11-03T12:00:00-03:00"}
                                       for i in range(RG.PAGINA + 5)]})
        r = RegistroBanco(sb)
        self.assertEqual(len(r._chamadas_do_dia(1, D0.date())), RG.PAGINA + 5)


class TestPublicacao(unittest.TestCase):
    def test_sobe_so_o_novo_como_retorno(self):
        sb = SbFalso({"empresas": [{"id": 1, "slug": "credora-ficticia"}]})
        with tempfile.TemporaryDirectory() as tmp:
            esc = EscritorEventos(tmp)
            e = ev("a1")
            e.credor_id = 7
            esc.escrever(e)
            relogio = Relogio(datetime(2026, 11, 3, 10, 5, 0))
            pub = Publicador(sb, tmp, USUARIO, relogio=relogio)
            r = pub.publicar()
            self.assertEqual(r, [{"empresa_id": 1, "credor_id": 7, "nome": "motorcx_voz_2026-11-03_100500.csv",
                                  "linhas": 1}])
            envio = sb.tabelas["envios"][0]
            self.assertEqual((envio["tipo"], envio["credor_id"], envio["enviado_por"], envio["status"]),
                             ("retorno", 7, USUARIO, "pendente"))
            self.assertTrue(envio["caminho"].startswith("credora-ficticia/retorno/2026-11-03/"))
            self.assertTrue(envio["caminho"].endswith("_motorcx_voz_2026-11-03_100500.csv"))
            self.assertEqual(pub.publicar(), [])                     # nada novo
            e2 = ev("a2")
            e2.credor_id = 7
            esc.escrever(e2)
            relogio.andar(60)
            r = pub.publicar()
            self.assertEqual(r[0]["linhas"], 1)
            conteudo = sb.arquivos[("entradas", sb.tabelas["envios"][1]["caminho"])].decode()
            self.assertEqual(len(conteudo.splitlines()), 2)          # cabeçalho + a linha nova
            self.assertIn(";a2;", conteudo)
            self.assertNotIn(";a1;", conteudo)

    def test_envio_falhou_apaga_o_arquivo_e_tenta_de_novo(self):
        sb = SbFalso({"empresas": [{"id": 1, "slug": "credora-ficticia"}]})
        with tempfile.TemporaryDirectory() as tmp:
            EscritorEventos(tmp).escrever(ev("a1"))
            sb.falhar_inserir = True
            self.assertEqual(Publicador(sb, tmp, USUARIO).publicar(), [])
            self.assertEqual(sb.arquivos, {})
            sb.falhar_inserir = False
            self.assertEqual(len(Publicador(sb, tmp, USUARIO).publicar()), 1)

    def test_usuario_obrigatorio(self):
        with self.assertRaises(ValueError):
            Publicador(SbFalso(), "/tmp", "")


def _mailing(linhas):
    import io
    f = io.StringIO()
    w = csv.writer(f, delimiter=";", lineterminator="\n")
    w.writerow(CAMPOS_MAILING)
    w.writerows(linhas)
    return f.getvalue().encode()


class TestPlantao(unittest.TestCase):
    def montar(self, modo="simulado", credores=True):
        d = dados_exemplo()
        d["voz_config"][0].update({"modo": modo, "bucket_gravacoes": None, "gravar": False})
        self.dados = B.carregar(d)
        dia = "2026-11-03"
        arq = {("saidas", f"credora-ficticia/{dia}/principal/discador_mailing.csv"): _mailing([
                   ["C1", "11988887771", 1, 0, 1, 1, 60, 15, "08:00-20:00", "SP", 1, "", "", "", "a1", ""]]),
               ("saidas", f"credora-ficticia/{dia}/principal/ids/agente_voz.csv"):
                   b"id_cliente;contato\nC2;11988887779\nC3;11988887774\n"}
        self.sb = SbFalso({"empresas": [{"id": 1, "slug": "credora-ficticia"}],
                           "credores": [{"id": 7, "empresa_id": 1, "codigo": "principal", "ativo": True}]
                           if credores else []}, arq)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.rel = Relogio()
        self.ari = AriSimulado()
        self.reg = RegistroBanco(self.sb)
        self.orq = Orquestrador(self.ari, self.dados, Agendador(contratado=10), EscritorEventos(self.tmp.name),
                                {"simulador": Simulador()}, self.rel, ao_registrar=self.reg.registrar)
        self.pl = P.Plantao(self.orq, P.FonteListas(self.sb, Path(self.tmp.name) / ".listas"), modo, None, self.reg,
                            Publicador(self.sb, self.tmp.name, USUARIO, relogio=self.rel), relogio=self.rel)

    def girar(self, segundos):
        for _ in range(segundos):
            while not self.ari.fila.empty():
                self.orq.ao_evento(self.ari.fila.get())
            self.orq.tick()
            self.pl.ciclo((self.rel.t - D0).total_seconds())
            self.rel.andar(1)

    def test_modo_simulado_de_ponta_a_ponta(self):
        self.montar()
        self.girar(90)
        self.pl.descarregar_tudo()
        self.assertEqual(sorted(k[2] for k in self.orq.lotes), ["agente_voz", "discador"])
        desf = {l["id_cliente"]: l["resultado"] for l in self.sb.tabelas["voz_chamadas"]}
        self.assertEqual(desf, {"C1": "promessa", "C2": "nao_atendida", "C3": "numero_inexistente"})
        self.assertTrue(all(l["credor_id"] == 7 for l in self.sb.tabelas["voz_chamadas"]))
        nomes = sorted(e["nome_original"].rsplit("_", 1)[0] for e in self.sb.tabelas["envios"])
        self.assertEqual(nomes, ["motorcx_discador_2026-11-03", "motorcx_voz_2026-11-03"])
        self.assertTrue(self.sb.tabelas["consumo_voz"])
        self.assertTrue(all(c[0] in ("originar", "continuar", "desligar", "criar_ponte", "adicionar_na_ponte",
                                     "destruir_ponte") for c in self.ari.comandos))

    def test_parte_da_vm(self):
        self.montar()
        self.pl.parte = (2, 2)            # empresa 1: 1 % 2 == 1 -> parte 2/2
        self.girar(2)
        self.assertTrue(self.orq.lotes)
        self.montar()
        self.pl.parte = (1, 2)
        self.girar(2)
        self.assertEqual(self.orq.lotes, {})

    def test_so_empresas_do_modo(self):
        self.montar(modo="real")
        self.pl.modo = "simulado"
        self.girar(5)
        self.assertEqual(self.orq.lotes, {})

    def test_lista_ainda_nao_publicada_tenta_depois(self):
        self.montar(credores=False)
        self.girar(61)
        self.assertEqual(self.orq.lotes, {})                         # sem credor: caminho sem o código
        self.sb.arquivos[("saidas", "credora-ficticia/2026-11-03/ids/agente_voz.csv")] = \
            b"id_cliente;contato\nC9;11988887770\n"
        self.girar(61)
        self.assertEqual(list(self.orq.lotes), [(1, None, "agente_voz")])

    def test_recarrega_voz_json(self):
        self.montar()
        with tempfile.TemporaryDirectory() as tmp:
            arq = Path(tmp) / "voz.json"
            arq.write_text(json.dumps(dados_exemplo()))
            self.pl.dados_caminho, self.pl._mtime = arq, arq.stat().st_mtime
            d = dados_exemplo()
            d["voz_config"][0]["limite_simultaneas"] = 1
            arq.write_text(json.dumps(d))
            os.utime(arq, (arq.stat().st_atime, arq.stat().st_mtime + 5))
            self.orq.agendador.registrar_empresa(self.dados.config(1), self.dados.troncos_da(1))
            self.pl.ciclo(1000.0)
            self.assertEqual(self.orq.agendador.empresas[1].limite, 1)
            arq.write_text("{quebrado")
            os.utime(arq, (arq.stat().st_atime, arq.stat().st_mtime + 10))
            self.pl._ult["listas"] = -1e9
            self.pl.ciclo(2000.0)                                     # não derruba
            self.assertEqual(self.orq.agendador.empresas[1].limite, 1)

    def test_rodar_plantao_para_no_sinal(self):
        self.montar()
        parar = threading.Event()
        fila = queue.Queue()
        t = threading.Thread(target=P._rodar_plantao, args=(self.pl, fila, parar, 0.01))
        t.start()
        parar.set()
        t.join(5)
        self.assertFalse(t.is_alive())


if __name__ == "__main__":
    unittest.main()
