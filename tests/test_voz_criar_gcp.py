"""infra/asterisk/criar_gcp.sh com um gcloud FALSO (nada vai ao Google Cloud): recusa IPs de exemplo, cria o que
falta, atualiza o que já existe (idempotente), não lê nem imprime segredo e cria o bucket por empresa com a
retenção pedida."""
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
               "ESTADO": str(self.estado)}
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
        self.assertIn('resource.name.startsWith("projects/123456789/secrets/motorcx-voz-")', tudo)
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
        self.assertIn("firewall-rules update motorcx-voz-sip --rules=udp:5060,tcp:5060,tcp:5061 "
                      "--source-ranges=100.64.10.1/32,100.64.20.0/28", tudo)
        self.assertNotIn("instances create", tudo)
        self.assertEqual(sum("instances add-metadata" in c for c in chamadas), 2)
        self.assertNotIn("secrets create", tudo)

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
        self.assertNotIn("firewall", tudo)

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
        self.assertEqual(len(servicos), 6)
        for s in servicos:
            txt = s.read_text()
            self.assertIn("ExecStart=", txt, s.name)
            self.assertIn("motorcx-voz-segredos", txt + ("motorcx-voz-segredos" if "atualizar" in s.name else ""))
        # todo arquivo que o vm_inicio.sh instala existe na pasta (vai como metadado pelo criar_gcp.sh)
        inicio = (vm / "vm_inicio.sh").read_text()
        for nome in ("motorcx-voz-comum", "motorcx-voz-segredos", "motorcx-voz-rodar", "motorcx-voz-config",
                     "motorcx-voz-atualizar", "motorcx-voz-config.timer", "motorcx-voz-transcricao.timer"):
            self.assertIn(nome, inicio)
            self.assertTrue((vm / nome).exists(), nome)
        # nenhum segredo escrito nos scripts: só lidos do Secret Manager para /run
        for f in vm.iterdir():
            self.assertNotRegex(f.read_text(), r"(?i)(password|senha)\s*=\s*\S{6,}", f.name)
