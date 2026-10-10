# MotorCob no Google Cloud (São Paulo)

O motor sai do Mac e passa a rodar 24h numa VM do Google Cloud em São Paulo. É o mesmo plantão do Mac: olha o
site a cada 5 s, gera a lista quando chega arquivo e faz a rotina do dia às 06:00. O comitê sai sozinho todo
dia 1º. O site (Hostinger) e o banco (Supabase) não mudam.

```
GitHub (main) ──imagem──> Artifact Registry ──05:20──> VM motorcob (sem IP público, Shielded VM)
                                                        ├─ contêiner do motor (somente leitura, sem privilégios)
Secret Manager (chave service_role) ───────────────────>├─ chave só em memória (/run)
                                                        └─ disco de dados /var/motorcob (snapshot diário, 14 dias)
VM ──saída pela Cloud NAT──> Supabase (motorcob.online)
```

Segurança: nenhuma porta aberta para a internet (só SSH pelo IAP do Google, com a sua conta); a chave do Supabase
fica no Secret Manager e nunca em arquivo de disco, imagem, git ou mensagem; o GitHub publica a imagem sem chave
guardada (Workload Identity Federation, só o repositório e o branch main); o motor roda como usuário comum, com o
sistema de arquivos somente leitura e sem privilégios; atualizações de segurança do sistema automáticas; logs no
Cloud Logging; disco criptografado pelo Google.

Custo aproximado (confirme em cloud.google.com/products/calculator): VM e2-medium em São Paulo + discos (50 GB) +
Cloud NAT + snapshots ≈ US$ 40–50/mês; com e2-small (`MOTORCOB_MAQUINA=e2-small`) ≈ US$ 25/mês. Conta nova costuma
ter crédito de teste do Google.

## 1. Projeto e faturamento (no navegador)
1. console.cloud.google.com › seletor de projeto (topo) › **Novo projeto** › nome `motorcob` › Criar.
2. **Faturamento** › vincule a conta de faturamento ao projeto (sem isso as APIs não ligam).
3. Anote o **ID do projeto** (ex.: `motorcob-123456`).

## 2. Preparar tudo (Cloud Shell, ~5 minutos)
1. No console, clique no ícone **>_** (Ativar Cloud Shell), no topo à direita.
2. No Cloud Shell: **⋮ › Fazer upload** › envie `preparar_projeto.sh` e `vm_inicio.sh` (pasta `nuvem/gcp/` do
   repositório).
3. Rode:
   ```bash
   bash preparar_projeto.sh motorcob-123456
   ```
   Ele pede a URL do Supabase e a **chave service_role** (Supabase › Project Settings › API Keys) — digitada no
   Cloud Shell, não aparece na tela e vai direto para o Secret Manager. Nunca cole a chave em chat ou e-mail.
4. No fim ele mostra 3 variáveis do GitHub (não são segredos).

## 3. Publicar a imagem do motor (GitHub)
O workflow `imagem` (`.github/workflows/imagem.yml`) já tem o projeto `motorcob`, o provedor WIF e a conta
`motorcob-ci` (não são segredos). Todo merge no main monta a imagem, roda os testes dentro dela e publica (~3 min).
Para publicar na hora: **Actions › imagem › Run workflow**. Se um dia mudar de projeto, crie as variáveis
`GCP_PROJETO`, `GCP_WIF_PROVIDER` e `GCP_SA_CI` em Settings › Secrets and variables › Actions › Variables (elas
têm prioridade sobre o que está no arquivo).

## 4. Conferir que o plantão subiu
No Cloud Shell:
```bash
gcloud compute ssh motorcob --zone=southamerica-east1-a --tunnel-through-iap \
  --command='sudo systemctl start motorcob-atualizar; sudo journalctl -u motorcob -n 30 --no-pager; sudo docker ps'
```
Esperado: `plantão no ar: olha o site a cada 5 s` e o contêiner `motorcob` em execução. Os logs também ficam em
**Logging › Explorador de registros** (filtro: `labels.motorcob`).

## 5. Trazer os dados do Mac (uma vez)
Os dados do motor (estado dos clientes, histórico, bases) estão em `~/MotorCob-dados` no Mac.
1. No Mac:
   ```bash
   cd ~/MotorCob && git pull && scripts/exportar_dados_mac.sh
   ```
   Ele **desliga o plantão do Mac** (os dois não podem rodar juntos) e gera `~/MotorCob-dados.tgz` sem a chave.
2. No Cloud Shell: **⋮ › Fazer upload** › `MotorCob-dados.tgz`. Depois:
   ```bash
   gcloud compute scp MotorCob-dados.tgz motorcob:/tmp/ --zone=southamerica-east1-a --tunnel-through-iap
   gcloud compute ssh motorcob --zone=southamerica-east1-a --tunnel-through-iap \
     --command='sudo motorcob-restaurar /tmp/MotorCob-dados.tgz && rm /tmp/MotorCob-dados.tgz'
   rm MotorCob-dados.tgz
   ```
3. Apague o `~/MotorCob-dados.tgz` do Mac (tem dado pessoal). A pasta `~/MotorCob-dados` do Mac fica como cópia
   até você confirmar que a nuvem está rodando bem.
4. Teste: suba um arquivo no site e confira a Lista do dia e a execução em minutos.

## Operação do dia a dia
Comandos no Cloud Shell (troque `CMD`):
`gcloud compute ssh motorcob --zone=southamerica-east1-a --tunnel-through-iap --command='sudo CMD'`

| Para | CMD |
|---|---|
| Ver o que o motor está fazendo | `journalctl -u motorcob -f` |
| Atualizar o motor agora (sem esperar 05:20) | `systemctl start motorcob-atualizar` |
| Reiniciar o plantão | `systemctl restart motorcob` |
| Parar o plantão | `systemctl stop motorcob` |
| Rodar o comitê de um mês | `docker exec motorcob scripts/relatorio_mes.sh 2026-10` |
| Diagnóstico (mesmo do Mac) | `docker exec motorcob scripts/diagnostico.sh` |

- **Trocar a chave do Supabase:** no Cloud Shell, `MOTORCOB_TROCAR_CHAVE=1 bash preparar_projeto.sh ID` e depois
  `systemctl restart motorcob`.
- **Voltar um backup:** Compute Engine › Snapshots › escolha o do dia › Criar disco › troque o disco
  `motorcob-dados` da VM pelo novo (VM parada).
- **Voltar para o Mac (emergência):** pare a VM (Compute Engine › VM › Parar) e religue o plantão do Mac com o
  comando que o `exportar_dados_mac.sh` mostrou. Nunca deixe os dois ligados ao mesmo tempo.
