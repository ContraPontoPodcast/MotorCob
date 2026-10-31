"""Kit demo (scripts/demo/gerar_carga_demo.py): os arquivos fictícios entram pelo caminho do próprio motor
(layout fixo empresas/demo-assessoria-exemplo.json e layout automático) e não têm dado real."""
import csv
import re
import shutil
import tempfile
import unittest
import unicodedata
from collections import Counter
from datetime import date
from pathlib import Path

import rodar_dia
from motor import normalizacao as norm
from motor.detectar import _canal, _resultado, entrada_automatica, layout_bureau, ler
from motor.discagem import DDD_UF
from motor.entrada import carregar_entrada, checar_base
from scripts.demo import gerar_carga_demo as G

RAIZ = Path(__file__).resolve().parent.parent
LAYOUT = RAIZ / "empresas" / "demo-assessoria-exemplo.json"
HOJE = date(2026, 10, 30)          # sexta-feira, dia útil
PASTAS = {"1_carga_geral": "bruto", "2_carga_incremental": "incremental", "3_ocorrencia": "ocorrencias",
          "4_acordo": "acordo", "5_baixa_pagamento": "baixa", "6_retirada": "retirada"}
CELULAR = re.compile(r"^\d{2}90000\d{4}$")
FIXO = re.compile(r"^\d{2}0000\d{4}$")


def _ler(p):
    with open(p, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f, delimiter=";"))


def _arquivos(saida: Path, sub: str) -> list[Path]:
    return sorted((saida / sub).rglob("*.csv"))


def _ficticio(tel: str) -> bool:
    return bool((CELULAR.match(tel) or FIXO.match(tel)) and tel[:2] in DDD_UF)


class TestKitDemo(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.tmp = Path(cls._tmp.name)
        cls.saida = cls.tmp / "demo_saida"
        cls.resumo = G.gerar(cls.saida, clientes=160, seed=7, hoje=HOJE, dias_historico=60)

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def _pasta_credor(self, cart: str, nome: str, tipos=tuple(PASTAS)) -> Path:
        """Monta a pasta do credor como a nuvem monta (nuvem/sincronizar.py PASTA_DO_TIPO)."""
        pasta = self.tmp / nome
        shutil.rmtree(pasta, ignore_errors=True)
        for sub in tipos:
            shutil.copytree(self.saida / cart / sub, pasta / PASTAS[sub], dirs_exist_ok=True)
        (pasta / "ocorrencias").mkdir(exist_ok=True)
        return pasta

    # ------------------------------------------------------------------ nenhum dado real
    def test_cpfs_nunca_sao_validos(self):
        cpfs = [l["CPF"] for a in _arquivos(self.saida, "cartoes") + _arquivos(self.saida, "veiculos")
                if "carga" in a.name for l in _ler(a)]
        cpfs += [l["CPF/CNPJ"] for a in _arquivos(self.saida, "7_atualizacao_contatos_bureau") for l in _ler(a)]
        self.assertGreater(len(cpfs), 160)
        for c in cpfs:
            self.assertIsNone(norm.cpf(c), c)                     # o validador do próprio motor recusa
            self.assertFalse(G.cpf_valido(c), c)
            self.assertTrue(re.sub(r"\D", "", c).startswith("000"), c)
        for n in range(1, 3000):                                  # a regra vale para qualquer sequência
            self.assertIsNone(norm.cpf(G.cpf_ficticio(n)))

    def test_telefones_emails_e_nomes_ficticios(self):
        tels, emails, nomes = [], [], []
        for cart in ("cartoes", "veiculos"):
            for a in _arquivos(self.saida, cart):
                if "carga" not in a.name:
                    continue
                for l in _ler(a):
                    tels += [norm.telefone(l[c]) for c in ("TEL1", "TEL2", "TEL3") if l[c]]
                    emails += [l["EMAIL"]] if l["EMAIL"] else []
                    nomes.append(l["NOME"])
        for a in _arquivos(self.saida, "7_atualizacao_contatos_bureau"):
            with open(a, newline="", encoding="utf-8") as f:
                linhas = list(csv.reader(f, delimiter=";"))
            cab = linhas[0]
            ddd = [i for i, c in enumerate(cab) if c == "DDD"]
            for l in linhas[1:]:
                tels += [norm.telefone(l[i] + l[i + 1]) for i in ddd if l[i + 1]]
                emails += [l[i] for i, c in enumerate(cab) if c.startswith("EMAIL") and l[i]]
                nomes.append(l[0])
        self.assertTrue(tels and emails and nomes)
        self.assertNotIn(None, tels)
        fora = [t for t in tels if not _ficticio(t)]
        self.assertEqual(fora, [], "telefone fora das faixas fictícias (DDD) 90000-NNNN / (DDD) 0000-NNNN")
        self.assertEqual(len(set(t for t in tels)), len(set(tels)))
        self.assertTrue(all(e.endswith("@exemplo.invalid") for e in emails), emails[:3])
        self.assertTrue(all(re.fullmatch(r"Cliente Demo \d{4}", n) for n in nomes), nomes[:3])

    def test_mesma_seed_mesmos_arquivos(self):
        outra = self.tmp / "de_novo"
        G.gerar(outra, clientes=160, seed=7, hoje=HOJE, dias_historico=60)
        a = {p.relative_to(self.saida): p.read_bytes() for p in self.saida.rglob("*") if p.is_file()}
        b = {p.relative_to(outra): p.read_bytes() for p in outra.rglob("*") if p.is_file()}
        self.assertEqual(a, b)
        with self.assertRaises(FileExistsError):              # não apaga uma carga sem pedir
            G.gerar(outra, clientes=160, seed=7, hoje=HOJE, dias_historico=60)

    def test_saida_padrao_fora_do_git(self):
        self.assertIn("demo_saida/", (RAIZ / ".gitignore").read_text(encoding="utf-8").splitlines())

    # ------------------------------------------------------------------ o motor entende
    def test_layout_automatico_reconhece_todos_os_arquivos(self):
        """Sem empresas/<slug>.json (site com o mapeamento a confirmar): o motor sugere tudo certo."""
        for cart in ("cartoes", "veiculos"):
            pasta = self._pasta_credor(cart, f"auto_{cart}")
            shutil.copytree(self.saida / "7_atualizacao_contatos_bureau", pasta / "enriquecimento")
            ent, info = entrada_automatica(pasta)
            lay = info["layout"]
            self.assertFalse([k for k, v in info["entendido"].items() if "erro" in v], info["entendido"])
            self.assertEqual(lay["base"]["colunas"], {
                "id_cliente": "COD_CLIENTE", "saldo": "SALDO_DEVEDOR", "id_contrato": "CONTRATO", "cpf": "CPF",
                "vencimento": "DT_VENCIMENTO", "data_entrada": "DATA_ENTRADA"})
            self.assertEqual([t["coluna"] for t in lay["base"]["telefones"]], ["TEL1", "TEL2", "TEL3"])
            self.assertEqual(lay["base"]["telefones"][0].get("whatsapp"), "WHATS_TEL1")
            self.assertEqual(lay["base"]["telefones"][0].get("rcs"), "RCS_TEL1")
            self.assertEqual(lay["base"]["emails"], ["EMAIL"])
            for tipo in ("ocorrencia", "acordo", "baixa", "retirada", "enriquecimento"):
                self.assertIn(tipo, lay, tipo)
            self.assertEqual(set(lay["baixa"]["colunas"]), {"id_cliente", "id_contrato", "id_acordo", "parcela",
                                                            "data", "valor", "tipo"})
            # tipo por extenso: mesmo fora da amostra do de-para o motor entende (motor/carteira.ler)
            self.assertLessEqual(lay["baixa"]["tipos"].items(),
                                 {"QUITACAO": "quitacao", "PARCIAL": "parcial", "PARCELA": "parcela"}.items())
            tipos = {l["TIPO"] for a in _arquivos(self.saida / cart, "5_baixa_pagamento") for l in _ler(a)}
            self.assertLessEqual({t.lower() for t in tipos}, {"quitacao", "parcial", "parcela"})
            self.assertEqual(set(lay["acordo"]["colunas"]), {"id_cliente", "id_acordo", "parcela", "vencimento",
                                                             "valor"})
            self.assertIsNotNone(layout_bureau(next((pasta / "enriquecimento").iterdir())))
            for a in sorted((pasta / "bruto").iterdir()) + sorted((pasta / "incremental").iterdir()):
                self.assertEqual(checar_base(a, ent.base), [])

    def test_codigos_e_canais_iguais_no_automatico_e_no_layout_fixo(self):
        """A sugestão do site (detectar) e o layout fixo dão o mesmo sentido a cada código e canal."""
        fixo = carregar_entrada(LAYOUT).ocorrencias[0]
        cpc = {"cpc", "promessa", "recusa"}
        for cod, generico in fixo.resultados.items():
            auto = _resultado(cod)
            self.assertEqual(auto == "cpc", generico in cpc, cod)
            if generico not in cpc:
                self.assertEqual(auto, generico, cod)
        for valor, canal in fixo.canais.items():
            self.assertEqual(_canal(valor), canal, valor)
        usados = Counter()
        for cart in ("cartoes", "veiculos"):
            for a in _arquivos(self.saida / cart, "3_ocorrencia"):
                usados.update(l["OCORRENCIA"] for l in _ler(a))
        self.assertLessEqual(set(usados), set(fixo.resultados))
        self.assertEqual(set(G.CANAL_CODIGO.values()), set(fixo.canais))

    def test_canais_aparecem_na_amostra_do_mapeamento(self):
        """O site monta o de-para dos canais com as 300 primeiras linhas (motor/detectar.AMOSTRA): na carga
        padrão (2.000 clientes) os seis canais precisam estar lá, senão as linhas do canal ficam de fora."""
        saida = self.tmp / "padrao"
        G.gerar(saida, hoje=HOJE)
        for cart in ("cartoes", "veiculos"):
            arq = _arquivos(saida / cart, "3_ocorrencia")[0]
            amostra = ler(arq)[3]
            self.assertEqual({l["CANAL"] for l in amostra}, set(G.CANAL_CODIGO.values()), cart)

    def test_rotina_com_layout_fixo_como_na_nuvem(self):
        """Passo 1 do LEIA_DEMO (cargas) e passo 2 (o resto), como a vigia faz: rodar_dia de verdade."""
        ent = carregar_entrada(LAYOUT)
        for cart in ("cartoes", "veiculos"):
            pasta = self._pasta_credor(cart, f"fixo_{cart}", ("1_carga_geral", "2_carga_incremental"))
            base = pasta / "base"

            def rodada():
                rel = rodar_dia.preparar_carteira(ent, pasta)
                enr = rodar_dia.preparar_enriquecimento(ent, pasta / "enriquecimento", base)
                parcelas = base / "parcelas.csv"
                r = rodar_dia.rodar_dia(base / "clientes.csv", base / "contatos.csv", pasta / "retornos", HOJE,
                                        parcelas_csv=parcelas if parcelas.exists() else None,
                                        pasta_estado=pasta / "estado", pasta_saida=pasta / "saida",
                                        ocorrencias=pasta / "ocorrencias", entrada=ent,
                                        atributos=base / "atributos.csv", out=lambda *a: None)
                return rel, enr, r

            rel, _, r1 = rodada()
            n = self.resumo["carteiras"]["Cartões" if cart == "cartoes" else "Veículos"]
            self.assertEqual(rel["clientes"], n["clientes"])
            self.assertFalse(rel.get("rejeitadas"), rel.get("rejeitadas"))
            self.assertTrue(r1["fila"], "a lista do dia sai já com a carga")

            for sub in ("3_ocorrencia", "4_acordo", "5_baixa_pagamento", "6_retirada"):
                shutil.copytree(self.saida / cart / sub, pasta / PASTAS[sub], dirs_exist_ok=True)
            shutil.copytree(self.saida / "7_atualizacao_contatos_bureau", pasta / "enriquecimento")
            rel, enr, r = rodada()
            self.assertFalse(rel["avisos"], rel["avisos"])          # todo acordo/baixa/retirada achou o cliente
            self.assertGreater(rel["acordos"], 0)
            self.assertGreater(rel["clientes_que_pagaram"], 0)
            self.assertGreater(sum(rel["retirados"].values()), 0)
            self.assertGreater(enr["arquivos"][0]["clientes_encontrados"], 0)
            for o in r["relatorios_ocorrencia"]:
                self.assertEqual(dict(o.desconhecidos), {}, "código fora do de-para (iria para a quarentena)")
                self.assertEqual(dict(o.rejeitadas), {})
                self.assertGreater(o.linhas, 0)
            self.assertFalse(r["quarentena"])
            estados = Counter(e.estado for e in r["estados"].values())
            self.assertGreaterEqual(len(estados), 4, estados)        # LOC, CPA, COL/PRE, LIQ...
            self.assertIn("LIQ", estados)
            self.assertTrue(r["fila"])
            self.assertGreater(len({l["canal"] for l in r["fila"]}), 2)

            # o que o motor gravou e exportou continua fictício
            contatos = _ler(base / "contatos.csv")
            self.assertTrue(contatos)
            for c in contatos:
                if c["tipo"] == "telefone":
                    self.assertTrue(_ficticio(c["contato"]), c["contato"])
                else:
                    self.assertTrue(c["contato"].endswith("@exemplo.invalid"), c["contato"])
                self.assertEqual(c["cpf"], "")                      # CPF inválido não vira chave de pessoa
            for arq in (pasta / "saida" / HOJE.isoformat() / "ids").glob("*.csv"):
                for l in _ler(arq):
                    contato = l["contato"]
                    self.assertTrue(_ficticio(contato) or contato.endswith("@exemplo.invalid"), (arq.name, contato))

    def test_layout_fixo_vale_para_a_empresa_do_console(self):
        """O nome sugerido no LEIA_DEMO vira o slug do arquivo (mesma regra de slugEmpresa no site)."""
        from nuvem.sincronizar import arquivo_entrada
        nome = "Demo · Assessoria Exemplo"
        slug = unicodedata.normalize("NFD", nome).encode("ascii", "ignore").decode().lower()
        slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-")
        self.assertEqual(slug, "demo-assessoria-exemplo")
        self.assertEqual(arquivo_entrada({"slug": slug}), LAYOUT)
        self.assertEqual(carregar_entrada(LAYOUT).empresa, slug)


if __name__ == "__main__":
    unittest.main()
