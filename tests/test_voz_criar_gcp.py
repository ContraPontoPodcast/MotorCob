"""infra/asterisk/criar_gcp.sh com um gcloud FALSO (nada vai ao Google Cloud): recusa IPs de exemplo, cria o que
falta, atualiza o que já existe (idempotente), não lê nem imprime segredo e cria o bucket por empresa com a
retenção pedida."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
GCLOUD = r'''#!/bin/bash
echo "$*" >> "$LOG"
case "$*" in
  *"--data-file=-"*) cat > /dev/null ;;
esac
case "$*" in
  "config get-value project"*) echo proj-ficticio ;;
  "projects describe"*projectId*) echo proj-ficticio ;;
  "projects describe"*) echo 123456789 ;;
  "compute addresses describe"*"--format"*) case "$*" in *ast-1*) echo 203.0.113.11 ;; *) echo 203.0.113.12 ;; esac ;;
  "storage service-agent"*) echo service-1@gs-project-accounts.iam.gserviceaccount.com ;;
  *" describe "*|*" describe") [ -f "$ESTADO" ] || exit 1 ;;
  *"--lifecycle-file="*) a="$*"; f="${a##*--lifecycle-file=}"; cat "${f%% *}" >> "$LOG.ciclo" ;;
  "iam service-accounts keys create"*)
    [ -n "${CHAVE_FALHA:-}" ] && exit 1
    a="$*"; f="${a#iam service-accounts keys create }"; f="${f%% *}"
    printf '{"client_email":"x","private_key":"-----BEGIN PRIVATE KEY-----\\nCHAVE-FALSA-NAO-MOSTRAR\\n"}' > "$f" ;;
esac
exit 0
'''


@unittest.skipUnless(shutil.which("bash"), "precisa de bash")
class TestCriarGcp(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.fake = self.tmp / "gcloud_falso.sh"
        self.fake.write_text(GCLOUD)
        self.dir = self.tmp / "asterisk"
        shutil.copytree(RAIZ / "infra" / "asterisk", self.dir)
        self.log = self.tmp / "gcloud.log"
        self.estado = self.tmp / "existe"

    def rodar(self, *args, ips=("100.64.10.1/32", "100.64.20.0/28")):
        script = self.dir / "criar_gcp.sh"
        txt = (RAIZ / "infra" / "asterisk" / "criar_gcp.sh").read_text(encoding="utf-8")
        assert "IPS_OPERADORAS=(\n)" in txt
        script.write_text(txt.replace("IPS_OPERADORAS=(\n)", "IPS_OPERADORAS=(\n" + "".join(f"  {i}\n" for i in ips) + ")"),
                          encoding="utf-8")
        # gcloud falso como função exportada do bash: não precisa de arquivo executável (/tmp noexec no CI)
        env = {**os.environ, "BASH_FUNC_gcloud%%": f'() {{ bash "{self.fake}" "$@"; }}', "LOG": str(self.log),
               "ESTADO": str(self.estado), "HOME": str(self.tmp), **getattr(self, "env_extra", {})}
        r = subprocess.run(["bash", str(script), *args], capture_output=True, text=True, env=env, timeout=60)
        chamadas = self.log.read_text().splitlines() if self.log.exists() else []
        return r, chamadas

    def test_recusa_ips_de_exemplo_sem_chamar_o_gcloud(self):
        r, chamadas = self.rodar("proj-ficticio", ips=("198.51.100.10/32", "203.0.113.0/28"))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("IPs de exemplo", r.stderr)
        self.assertEqual(chamadas, [])

    def test_infra_cria_tudo_e_mostra_os_ips(self):
        r, chamadas = self.rodar("proj-ficticio")
        self.assertEqual(r.returncode, 0, r.stderr)
        tudo = "\n".join(chamadas)
        self.assertIn("compute firewall-rules create motorcx-voz-sip --network=motorcx-voz --direction=INGRESS "
                      "--action=ALLOW --rules=udp:5060,tcp:5060,tcp:5061 --source-ranges=100.64.10.1/32,100.64.20.0/28",
                      tudo)
        self.assertIn("--rules=udp:10000-20000 --source-ranges=100.64.10.1/32,100.64.20.0/28", tudo)
        self.assertIn("--source-ranges=35.235.240.0/20", tudo)
        # proxy HTTPS (Caddy): 8443 das origens do webhook/Edge Functions e 80 só para o Let's Encrypt
        self.assertIn("firewall-rules create motorcx-voz-https --network=motorcx-voz --direction=INGRESS --action=ALLOW "
                      "--rules=tcp:8443 --source-ranges=0.0.0.0/0 --target-tags=motorcx-asterisk", tudo)
        self.assertIn("firewall-rules create motorcx-voz-acme --network=motorcx-voz --direction=INGRESS --action=ALLOW "
                      "--rules=tcp:80 --source-ranges=0.0.0.0/0", tudo)
        self.assertIn("arquivo-motorcx-caddy.Caddyfile=", next(c for c in chamadas if "instances create motorcx-ast-1" in c))
        self.assertIn('resource.name.startsWith("projects/123456789/secrets/motorcx-voz-")', tudo)
        # credenciais dos conectores de CRM (crm/<e>/<c>/<v> -> motorcx-crm-...) na MESMA condição, e nada além
        cond = next(c for c in chamadas if "add-iam-policy-binding" in c and "secretAccessor" in c)
        self.assertIn('resource.name.startsWith("projects/123456789/secrets/motorcx-voz-") || '
                      'resource.name.startsWith("projects/123456789/secrets/motorcx-crm-")', cond)
        self.assertIn("title=motorcx-voz-crm-segredos", cond)
        self.assertEqual(sum("add-iam-policy-binding" in c and "secretAccessor" in c for c in chamadas), 1)
        # a condição antiga (só motorcx-voz-) sai: a nova cobre
        self.assertIn("remove-iam-policy-binding proj-ficticio --member=serviceAccount:motorcx-asterisk@proj-ficticio"
                      ".iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor "
                      '--condition=expression=resource.name.startsWith("projects/123456789/secrets/motorcx-voz-"),'
                      "title=motorcx-voz-segredos", tudo)
        # Vertex AI (Speech Analytics e busca semântica): API ligada e o papel mínimo para o predict
        self.assertIn("aiplatform.googleapis.com", next(c for c in chamadas if c.startswith("services enable")))
        self.assertIn("projects add-iam-policy-binding proj-ficticio --member=serviceAccount:motorcx-asterisk@"
                      "proj-ficticio.iam.gserviceaccount.com --role=roles/aiplatform.user --condition=None", tudo)
        # conta de leitura das gravações: criada, sem papel nenhum no projeto e sem chave aqui
        self.assertIn("iam service-accounts create motorcx-gravacoes-leitura", tudo)
        self.assertFalse([c for c in chamadas if "projects add-iam-policy-binding" in c and "gravacoes-leitura" in c])
        self.assertNotIn("keys create", tudo)
        self.assertIn("secrets create motorcx-voz-ari-senha", tudo)
        self.assertNotIn("versions access", tudo)                       # não lê segredo
        self.assertEqual(sum("instances create" in c for c in chamadas), 2)
        criar = next(c for c in chamadas if "instances create motorcx-ast-1" in c)
        self.assertIn("arquivo-motorcx-voz-rodar=", criar)
        self.assertIn("motorcx-parte=1/2", criar)
        self.assertIn("--zone=southamerica-east1-a", criar)
        self.assertIn("--shielded-secure-boot", criar)
        self.assertNotIn("buckets create", tudo)                        # bucket é por empresa
        self.assertIn("motorcx-ast-1  203.0.113.11", r.stdout)
        self.assertIn("motorcx-ast-2  203.0.113.12", r.stdout)

    def test_lista_vazia_cria_tudo_com_sip_fechado(self):
        r, chamadas = self.rodar("proj-ficticio", ips=())
        self.assertEqual(r.returncode, 0, r.stderr)
        tudo = "\n".join(chamadas)
        self.assertNotIn("motorcx-voz-sip", tudo)
        self.assertNotIn("motorcx-voz-rtp", tudo)
        self.assertIn("motorcx-voz-ssh-iap", tudo)
        self.assertEqual(sum("instances create" in c for c in chamadas), 2)
        self.assertIn("SIP e RTP continuam FECHADOS", r.stdout)

    def test_projeto_pelo_numero_e_maquina_do_piloto(self):
        r, chamadas = self.rodar("1066520898298")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Projeto: proj-ficticio", r.stdout)
        self.assertIn("config set project proj-ficticio", "\n".join(chamadas))
        criar = next(c for c in chamadas if "instances create motorcx-ast-1" in c)
        self.assertIn("--machine-type=e2-standard-2", criar)

    def test_segunda_vez_atualiza_em_vez_de_criar(self):
        self.estado.write_text("1")
        r, chamadas = self.rodar("proj-ficticio")
        self.assertEqual(r.returncode, 0, r.stderr)
        tudo = "\n".join(chamadas)
        self.assertNotIn("firewall-rules create", tudo)
        self.assertIn("firewall-rules update motorcx-voz-https --rules=tcp:8443 --source-ranges=0.0.0.0/0", tudo)
        self.assertIn("firewall-rules update motorcx-voz-sip --rules=udp:5060,tcp:5060,tcp:5061 "
                      "--source-ranges=100.64.10.1/32,100.64.20.0/28", tudo)
        self.assertNotIn("instances create", tudo)
        self.assertEqual(sum("instances add-metadata" in c for c in chamadas), 2)
        self.assertNotIn("secrets create", tudo)
        self.assertNotIn("service-accounts create", tudo)               # as duas contas já existem

    def test_bucket_da_empresa(self):
        self.estado.write_text("1")                                     # a infraestrutura já existe
        self.log.unlink(missing_ok=True)
        r, chamadas = self.rodar("empresa", "12", "1825", "proj-ficticio")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("proj-ficticio-motorcx-grav-e12", r.stdout)
        ciclo = (self.tmp / "gcloud.log.ciclo").read_text()
        self.assertIn('"age":1825', ciclo)
        self.assertIn("COLDLINE", ciclo)
        tudo = "\n".join(chamadas)
        self.assertIn("buckets add-iam-policy-binding gs://proj-ficticio-motorcx-grav-e12 "
                      "--member=serviceAccount:motorcx-asterisk@proj-ficticio.iam.gserviceaccount.com "
                      "--role=roles/storage.objectCreator", tudo)
        # a conta da Edge Function gravacoes (GCS_GRAVACOES_CHAVE) só lê este bucket
        leitura = [c for c in chamadas if "buckets add-iam-policy-binding" in c and "gravacoes-leitura" in c]
        self.assertEqual(leitura, ["storage buckets add-iam-policy-binding gs://proj-ficticio-motorcx-grav-e12 "
                                   "--member=serviceAccount:motorcx-gravacoes-leitura@proj-ficticio.iam.gserviceaccount.com "
                                   "--role=roles/storage.objectViewer"])
        self.assertNotIn("firewall", tudo)

    def test_bucket_cria_a_conta_de_leitura_se_faltar(self):
        self.estado.write_text("1")
        self.fake.write_text(GCLOUD.replace('  *" describe "*|*" describe")',
                                            '  *"describe motorcx-gravacoes-leitura"*) exit 1 ;;\n  *" describe "*|*" describe")'))
        r, chamadas = self.rodar("empresa", "12", "90", "proj-ficticio")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("iam service-accounts create motorcx-gravacoes-leitura", "\n".join(chamadas))

    def test_chave_de_leitura_vai_so_para_arquivo(self):
        self.estado.write_text("1")
        r, chamadas = self.rodar("chave-leitura", "proj-ficticio")
        self.assertEqual(r.returncode, 0, r.stderr)
        criar = next(c for c in chamadas if "keys create" in c)
        self.assertIn("--iam-account=motorcx-gravacoes-leitura@proj-ficticio.iam.gserviceaccount.com", criar)
        arqs = list(self.tmp.glob("gcs-gravacoes-chave.*.json"))
        self.assertEqual(len(arqs), 1)
        self.assertEqual(arqs[0].stat().st_mode & 0o777, 0o600)
        self.assertIn("CHAVE-FALSA", arqs[0].read_text())
        for saida in (r.stdout, r.stderr):                                  # nunca mostra a chave
            self.assertNotIn("CHAVE-FALSA", saida)
            self.assertNotIn("PRIVATE KEY", saida)
        self.assertIn("GCS_GRAVACOES_CHAVE", r.stdout)
        self.assertIn(f'shred -u "{arqs[0]}"', r.stdout)
        self.assertNotIn("firewall", "\n".join(chamadas))
        self.assertNotIn("buckets", "\n".join(chamadas))

    def test_chave_de_leitura_recusada_apaga_o_arquivo(self):
        self.estado.write_text("1")
        self.env_extra = {"CHAVE_FALHA": "1"}
        r, _ = self.rodar("chave-leitura", "proj-ficticio")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("iam.disableServiceAccountKeyCreation", r.stderr)
        self.assertEqual(list(self.tmp.glob("gcs-gravacoes-chave.*")), [])

    def test_bucket_novo_com_90_dias_e_recusa_menos(self):
        self.estado.write_text("1")
        r, _ = self.rodar("empresa", "12", "30", "proj-ficticio")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("≥ 90", r.stderr)
        r, _ = self.rodar("empresa", "abc", "90", "proj-ficticio")
        self.assertNotEqual(r.returncode, 0)


if __name__ == "__main__":
    unittest.main()


class TestScriptsDaVm(unittest.TestCase):
    def test_sintaxe_e_unidades(self):
        vm = RAIZ / "infra" / "asterisk" / "vm"
        for f in [vm / "vm_inicio.sh", *sorted(vm.glob("motorcx-voz-*"))]:
            if f.suffix in (".service", ".timer"):
                continue
            r = subprocess.run(["bash", "-n", str(f)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, f"{f.name}: {r.stderr}")
        servicos = sorted(vm.glob("*.service"))
        self.assertEqual(len(servicos), 15)
        for s in servicos:
            txt = s.read_text()
            self.assertIn("ExecStart=", txt, s.name)
            self.assertIn("motorcx-voz-segredos", txt + ("motorcx-voz-segredos" if "atualizar" in s.name else ""))
        # todo arquivo que o vm_inicio.sh instala existe na pasta (vai como metadado pelo criar_gcp.sh)
        inicio = (vm / "vm_inicio.sh").read_text()
        for nome in ("motorcx-voz-comum", "motorcx-voz-segredos", "motorcx-voz-rodar", "motorcx-voz-config",
                     "motorcx-voz-atualizar", "motorcx-voz-config.timer", "motorcx-voz-transcricao.timer",
                     "motorcx-voz-speech.timer", "motorcx-voz-speech-noite.timer", "motorcx-voz-speech.service",
                     "motorcx-voz-speech-noite.service", "motorcx-voz-speech-temas.service",
                     "motorcx-voz-speech-temas.timer", "motorcx-voz-speech-buscas.service",
                     "motorcx-voz-simulador.service", "motorcx-voz-https.service", "motorcx-voz-https.timer",
                     "motorcx-voz-https", "motorcx-caddy.Caddyfile", "motorcx-caddy-simulador.caddy",
                     "motorcx-caddy-elevenlabs.caddy", "motorcx-voz-importador.service",
                     "motorcx-voz-importador.timer", "motorcx-voz-fluxo-noite.service",
                     "motorcx-voz-fluxo-noite.timer", "motorcx-voz-gerar-fluxo.service",
                     "motorcx-provedores.padrao.json"):
            self.assertIn(nome, inicio)
            self.assertTrue((vm / nome).exists(), nome)
        # Speech Analytics (SQL 62): desligado por padrão, só liga com o metadado da VM
        rodar = (vm / "motorcx-voz-rodar").read_text()
        self.assertIn('[ "$(meta motorcx-speech-analytics)" != 1 ]', rodar)
        self.assertIn("MOTORCX_SPEECH_ANALYTICS=1", rodar)
        # importador das gravações do discador (SQL 64): desligado por padrão, só liga com o metadado da VM
        self.assertIn('[ "$(meta motorcx-importador-gravacoes)" != 1 ]', rodar)
        self.assertIn("MOTORCX_IMPORTADOR_GRAVACOES=1", rodar)
        self.assertIn("--registrar", rodar)
        self.assertIn("motorcx-voz-importador.timer", inicio.split("systemctl enable --now")[1])
        # nenhum segredo escrito nos scripts: só lidos do Secret Manager para /run
        for f in vm.iterdir():
            self.assertNotRegex(f.read_text(), r"(?i)(password|senha)\s*=\s*\S{6,}", f.name)


VM = RAIZ / "infra" / "asterisk" / "vm"


class TestProxyHttps(unittest.TestCase):
    """Caddyfile e trechos versionados (conteúdo; `caddy validate` quando o caddy existe na máquina) e o
    motorcx-voz-https com metadados, caddy e systemctl FALSOS: liga só as rotas dos recursos ligados."""

    def test_caddyfile_e_trechos(self):
        from voz import simulador_http as SH
        from voz.provedores import elevenlabs as EL
        cf = (VM / "motorcx-caddy.Caddyfile").read_text(encoding="utf-8")
        self.assertIn("https_port 8443", cf)
        self.assertIn("http_port 80", cf)                          # só o desafio do Let's Encrypt e o redirecionamento
        self.assertIn("{$MOTORCX_HTTPS_HOST}:8443 {", cf)
        self.assertIn("import /etc/caddy/motorcx-rotas/*.caddy", cf)
        self.assertRegex(cf, r"handle \{\s*respond 404\s*\}")      # qualquer outro caminho: 404
        self.assertNotRegex(cf, r"(?m)^\s*log\b")                  # sem access log (nada de corpo nem caminho)
        el = (VM / "motorcx-caddy-elevenlabs.caddy").read_text(encoding="utf-8")
        self.assertIn(f"handle {EL.CAMINHO_WEBHOOK} {{", el)
        self.assertIn("max_size 2MB", el)
        self.assertEqual(EL.MAX_CORPO_WEBHOOK, 2 * 1024 * 1024)
        self.assertIn(f"reverse_proxy 127.0.0.1:{EL.ElevenLabs('a1').webhook_porta}", el)
        sim = (VM / "motorcx-caddy-simulador.caddy").read_text(encoding="utf-8")
        self.assertIn("@simulador path /simular /roleplay /ouvir", sim)
        self.assertIn("max_size 256KB", sim)
        self.assertEqual(SH.MAX_CORPO, 256 * 1024)
        self.assertIn("reverse_proxy 127.0.0.1:8091", sim)
        rodar = (VM / "motorcx-voz-rodar").read_text(encoding="utf-8")
        self.assertIn("voz.simulador_http --porta 8091", rodar)
        self.assertIn('[ "$(meta motorcx-simulador-fluxo)" != 1 ]', rodar)
        inicio = (VM / "vm_inicio.sh").read_text(encoding="utf-8")
        self.assertIn("CADDY_VERSAO=2.8.4", inicio)                # pacote oficial, versão fixa
        self.assertIn("dl.cloudsmith.io/public/caddy/stable", inicio)
        self.assertIn("apt-mark hold caddy", inicio)
        self.assertIn("/usr/local/bin/motorcx-voz-https", inicio)

    @unittest.skipUnless(shutil.which("caddy"), "caddy não instalado nesta máquina (o conteúdo é conferido acima)")
    def test_caddy_validate(self):     # pragma: no cover - só onde o caddy existe
        with tempfile.TemporaryDirectory() as d:
            cf = (VM / "motorcx-caddy.Caddyfile").read_text(encoding="utf-8").replace(
                "/etc/caddy/motorcx-rotas", d)
            for f in ("motorcx-caddy-simulador.caddy", "motorcx-caddy-elevenlabs.caddy"):
                shutil.copy(VM / f, Path(d) / f)
            (Path(d) / "00-base.caddy").write_text("tls internal\n")
            (Path(d) / "Caddyfile").write_text(cf)
            r = subprocess.run(["caddy", "validate", "--adapter", "caddyfile", "--config", str(Path(d) / "Caddyfile")],
                               capture_output=True, text=True, env={**os.environ, "MOTORCX_HTTPS_HOST": "localhost"})
            self.assertEqual(r.returncode, 0, r.stderr)

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.fonte = self.tmp / "fonte"
        self.fonte.mkdir()
        for f in ("motorcx-caddy.Caddyfile", "motorcx-caddy-simulador.caddy", "motorcx-caddy-elevenlabs.caddy"):
            shutil.copy(VM / f, self.fonte / f)
        self.etc = self.tmp / "etc"
        self.etc.mkdir()
        self.prov = self.tmp / "provedores.json"
        self.log = self.tmp / "log"
        self.comum = self.tmp / "comum"
        self.comum.write_text('meta() { case "$1" in motorcx-simulador-fluxo) echo "${M_SIM:-}" ;; '
                              'motorcx-https-tls) echo "${M_TLS:-}" ;; motorcx-dominio-https) echo "${M_DOM:-}" ;; esac; }\n'
                              'IP_EXTERNO=203.0.113.11\n')

    def https(self, sim="", tls="", dom="", valida=0, ativo=1):
        env = {**os.environ, "MOTORCX_VOZ_COMUM": str(self.comum), "MOTORCX_CADDY_FONTE": str(self.fonte),
               "MOTORCX_ETC_CADDY": str(self.etc), "MOTORCX_PROVEDORES": str(self.prov), "M_SIM": sim, "M_TLS": tls,
               "M_DOM": dom, "LOG": str(self.log),
               "BASH_FUNC_caddy%%": f'() {{ echo "caddy $* host=$MOTORCX_HTTPS_HOST" >> "$LOG"; return {valida}; }}',
               "BASH_FUNC_systemctl%%": f'() {{ echo "systemctl $*" >> "$LOG"; '
                                        f'[ "$1" = is-active ] && return {0 if ativo else 1}; return 0; }}'}
        r = subprocess.run(["bash", str(VM / "motorcx-voz-https")], capture_output=True, text=True, env=env, timeout=60)
        log = self.log.read_text().splitlines() if self.log.exists() else []
        self.log.unlink(missing_ok=True)
        return r, log, sorted(p.name for p in (self.etc / "motorcx-rotas").glob("*.caddy"))

    def test_desligado_so_404_com_certificado_do_sslip(self):
        r, log, rotas = self.https(ativo=0)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(rotas, ["00-base.caddy"])
        self.assertIn("disable_tlsalpn_challenge", (self.etc / "motorcx-rotas" / "00-base.caddy").read_text())
        self.assertIn("MOTORCX_HTTPS_HOST=203-0-113-11.sslip.io", (self.etc / "motorcx.env").read_text())
        self.assertTrue(any(l.startswith("caddy validate") and "host=203-0-113-11.sslip.io" in l for l in log), log)
        self.assertIn("systemctl restart caddy", log)

    def test_liga_as_rotas_e_so_recarrega_quando_muda(self):
        self.prov.write_text(json.dumps({"elevenlabs": {"numero_agente": "a1", "ref_webhook": "voz/elevenlabs-webhook"}}))
        self.https()
        r, log, rotas = self.https(sim="1")
        self.assertEqual(rotas, ["00-base.caddy", "motorcx-caddy-elevenlabs.caddy", "motorcx-caddy-simulador.caddy"])
        self.assertIn("systemctl reload caddy", log)              # mesmo nome: só recarrega
        r, log, _ = self.https(sim="1")
        self.assertEqual([l for l in log if "reload" in l or "restart" in l], [])     # nada mudou
        self.prov.write_text(json.dumps({"elevenlabs": {"numero_agente": "a1"}}))     # webhook desligado
        r, log, rotas = self.https(sim="")
        self.assertEqual(rotas, ["00-base.caddy"])

    def test_invalido_mantem_o_que_esta_no_ar(self):
        self.https(sim="1")
        r, log, rotas = self.https(sim="", valida=1)
        self.assertEqual(r.returncode, 2)
        self.assertEqual(rotas, ["00-base.caddy", "motorcx-caddy-simulador.caddy"])
        self.assertFalse([l for l in log if "reload" in l or "restart" in l])

    def test_dominio_proprio_e_ca_interna(self):
        r, log, _ = self.https(dom="voz1.motorcob.online", tls="interno")
        self.assertIn("MOTORCX_HTTPS_HOST=voz1.motorcob.online", (self.etc / "motorcx.env").read_text())
        self.assertEqual((self.etc / "motorcx-rotas" / "00-base.caddy").read_text(), "tls internal\n")
        r, _, _ = self.https(dom="x;rm -rf /")
        self.assertEqual(r.returncode, 1)


class TestProvedoresDaVm(unittest.TestCase):
    """/etc/motorcx/provedores.json e provedores_sip.json: exemplos versionados (só referências, sem segredo) no formato
    que voz/provedores e o gerador do Asterisk leem, e o padrão seguro (Montagem) que o vm_inicio.sh instala só quando
    o arquivo não existe."""

    class Cofre:
        def __init__(self):
            self.pedidos = []

        def valor(self, ref):
            self.pedidos.append(ref)
            return "valor-ficticio"

    def test_exemplos_e_padrao_carregam(self):
        from voz import provedores as PV
        from voz.segredos import nome_secret_manager
        padrao = json.loads((VM / "motorcx-provedores.padrao.json").read_text(encoding="utf-8"))
        self.assertEqual(set(padrao), {"montagem"})                          # padrão: só a Montagem
        self.assertEqual(sorted(PV.criar_todos(padrao, self.Cofre())), ["montagem_motorcx", "simulador"])
        exemplo = json.loads((VM / "provedores.exemplo.json").read_text(encoding="utf-8"))
        cofre = self.Cofre()
        self.assertEqual(sorted(PV.criar_todos(exemplo, cofre)), ["elevenlabs", "montagem_motorcx", "simulador"])
        # só referências: toda ref_* vira um segredo que a conta da VM pode ler (motorcx-voz-)
        for cfg in (padrao, exemplo):
            for prov in cfg.values():
                for k, v in prov.items():
                    if k.startswith("ref_"):
                        self.assertTrue(nome_secret_manager(v).startswith("motorcx-voz-"), (k, v))
        for f in ("motorcx-provedores.padrao.json", "provedores.exemplo.json", "provedores_sip.exemplo.json"):
            self.assertNotRegex((VM / f).read_text(encoding="utf-8"), r"(?i)(sk-|xi-api|BEGIN|password|senha)", f)

    def test_exemplo_sip_gera_o_endpoint(self):
        from voz.asterisk import gerador as GER
        from voz import banco as B
        sip = json.loads((VM / "provedores_sip.exemplo.json").read_text(encoding="utf-8"))
        conf = GER.gerar_pjsip(B.DadosVoz(), None, provedores_sip=sip)
        self.assertIn("[pv-elevenlabs]", conf)

    def _instalar(self, etc, metadado):
        """Roda o trecho do vm_inicio.sh que instala os provedores, com /etc/motorcx numa pasta temporária."""
        inicio = (VM / "vm_inicio.sh").read_text(encoding="utf-8")
        trecho = inicio[inicio.index("# provedores de voz: padrão seguro"):inicio.index("systemctl daemon-reload")]
        trecho = trecho.replace("/etc/motorcx", str(etc))
        falso = self.tmp / "metadado.json"
        if metadado is None:
            falso.unlink(missing_ok=True)
        else:
            falso.write_text(metadado, encoding="utf-8")
        script = f'baixar() {{ [ "$1" = arquivo-motorcx-provedores.padrao.json ] && cat "{falso}"; }}\nset -euo pipefail\n' + trecho
        return subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30)

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)

    def test_vm_inicio_instala_o_padrao_sem_sobrescrever(self):
        etc = self.tmp / "etc"
        etc.mkdir()
        padrao = (VM / "motorcx-provedores.padrao.json").read_text(encoding="utf-8")
        r = self._instalar(etc, padrao)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads((etc / "provedores.json").read_text()), json.loads(padrao))
        self.assertEqual((etc / "provedores.json").stat().st_mode & 0o777, 0o644)   # o contêiner (10010) lê
        self.assertEqual(json.loads((etc / "provedores_sip.json").read_text()), [])
        # o que o dono gravou nunca é sobrescrito
        (etc / "provedores.json").write_text('{"elevenlabs": {"numero_agente": "meu"}}')
        (etc / "provedores_sip.json").write_text('[{"nome": "meu"}]')
        r = self._instalar(etc, padrao)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('"meu"', (etc / "provedores.json").read_text())
        self.assertIn('"meu"', (etc / "provedores_sip.json").read_text())

    def test_vm_inicio_sem_metadado_ou_invalido_nao_instala_lixo(self):
        for metadado in (None, "não é json", "[1, 2]"):
            etc = self.tmp / f"etc{len(str(metadado))}"
            etc.mkdir()
            r = self._instalar(etc, metadado)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertFalse((etc / "provedores.json").exists(), metadado)
            self.assertTrue((etc / "provedores_sip.json").exists())


class TestPrefixosDosSegredos(unittest.TestCase):
    """Todo segredo que a VM lê precisa caber na condição do IAM da conta motorcx-asterisk (criar_gcp.sh)."""

    def prefixos(self):
        import re
        txt = (RAIZ / "infra" / "asterisk" / "criar_gcp.sh").read_text(encoding="utf-8")
        linha = next(l for l in txt.splitlines() if l.startswith("CONDICAO_SEGREDOS="))
        return re.findall(r'secrets/(motorcx-[a-z]+-)', linha)

    def test_refs_que_a_vm_le_cabem_na_condicao(self):
        import re
        from voz import gerar_fluxo as G
        from voz.segredos import nome_secret_manager
        prefixos = self.prefixos()
        self.assertEqual(prefixos, ["motorcx-voz-", "motorcx-crm-"])
        # a referência do conector de CRM, exatamente como o SQL 58 gera (crm/<empresa>/<conector>/<versão>)
        sql = (RAIZ / "supabase" / "migrations" / "20261225000001_voz_fluxo.sql").read_text(encoding="utf-8")
        fmt = re.search(r"ref := format\('(crm/[^']+)'", sql).group(1)
        crm = fmt.replace("%s", "12", 2).replace("%s", "20261225103000123")
        refs = [crm, "voz/trunk/12-3", G.REF_LLM, "voz/importador/12/5/20261119103000", "voz/db-senha"]
        for ref in refs:
            nome = nome_secret_manager(ref)
            self.assertTrue(any(nome.startswith(p) for p in prefixos), (ref, nome))
        self.assertEqual(nome_secret_manager(crm), "motorcx-crm-12-12-20261225103000123")
        # o exemplo antigo da tela do tronco (sip/...) ficaria fora: por isso o site e o banco exigem voz/
        self.assertFalse(any(nome_secret_manager("sip/aurora-opc").startswith(p) for p in prefixos))
