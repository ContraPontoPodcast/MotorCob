# Asterisk do MotorCX (telefonia do agente de voz)

O Asterisk do MotorCX roda em 2 VMs em São Paulo, com IP fixo. Ele origina as chamadas pelos troncos de cada
empresa, aplica rota e tech prefix, grava, lê o Q.850 e detecta máquina. Só quando atende uma pessoa ele liga o
provedor de voz. Quando é preciso um humano, transfere por SIP para o discador do cliente.

## 1. Criar a infraestrutura no Google Cloud (uma vez)

1. Peça a cada operadora a lista de IPs do SBC dela, de sinalização e de mídia.
2. Abra o Cloud Shell: em console.cloud.google.com, clique no ícone `>_` no topo.
3. Clone o repositório no Cloud Shell e entre em `infra/asterisk/`. O script precisa da pasta `vm/` ao lado.
4. Abra `criar_gcp.sh` e edite a lista do topo:
   - `IPS_OPERADORAS`: os IPs das operadoras, um por linha. **Pode ficar vazia:** o script cria tudo e deixa
     o SIP e o RTP **fechados**. Quando a operadora mandar os IPs, preencha a lista e rode de novo. IPs de
     exemplo de documentação (192.0.2.x, 198.51.100.x, 203.0.113.x) fazem o script parar, de propósito.
   - `IPS_PROVEDORES_VOZ` e `IPS_DISCADORES_CLIENTES`: preencha se já houver.
5. Rode:

   ```bash
   bash criar_gcp.sh SEU-PROJETO        # o ID ou o número do projeto
   ```

   Opções, sempre antes do `bash`:
   - `USAR_CMEK=1`: cria uma chave própria no Cloud KMS para cifrar os buckets das empresas.
   - `MAQUINA=n2-standard-4`: o padrão é `e2-standard-2`, para o piloto. Antes do volume real, use
     `n2-standard-4`. A troca de uma VM que já existe é feita no console (parar › editar › tipo de máquina).
6. No fim, o script mostra os **2 IPs**. Mande os dois para as operadoras liberarem SIP e RTP (10000–20000).

O script pode rodar de novo. Para incluir uma operadora, edite a lista e rode outra vez: o firewall e os
scripts das VMs são atualizados, e o resto fica como está. Esta versão também roda por cima do que a versão do
piloto criou (a mesma rede, IPs, firewall, conta, segredo e VMs; nas VMs só troca os scripts de início). O
bucket único `<projeto>-motorcx-gravacoes` da versão do piloto não é usado: cada empresa ganha o seu (seção 3).
Ele não pede nem mostra segredos. A senha do ARI é
gerada dentro do Secret Manager (`motorcx-voz-ari-senha`) e não aparece na tela.

**O que é criado:**
- a rede `motorcx-voz`;
- 2 IPs estáticos;
- o firewall: SIP e RTP só das origens da lista, e SSH só pelo IAP;
- a conta `motorcx-asterisk`, que só pode:
  - ler os segredos `motorcx-voz-*`;
  - ler as imagens do Artifact Registry;
  - gravar e ler nos buckets de gravação das empresas;
  - escrever log e métrica;
- as VMs `motorcx-ast-1` (zona a) e `motorcx-ast-2` (zona b): Shielded VM, Debian 12. No boot, o
  `vm/vm_inicio.sh` instala o Docker e os serviços (seção 4). A VM 1 disca para as empresas de id par e a VM 2,
  para as de id ímpar.

## 2. Segredos que o dono cria uma vez

Cada comando abaixo pede o valor sem mostrar na tela:

```bash
criar() { read -r -s -p "$2: " S; echo; printf '%s' "$S" | gcloud secrets create "$1" \
  --replication-policy=user-managed --locations=southamerica-east1 --data-file=-; unset S; }
criar motorcx-voz-supabase-url "URL do Supabase (https://xxxx.supabase.co)"
criar motorcx-voz-supabase-key "Chave do servidor do Supabase"     # só no piloto (seção 7)
```

**Senha de tronco:** o banco guarda só a referência (`voz_troncos.segredo_ref`). Para a referência
`voz/trunk/12-3`, o segredo se chama `motorcx-voz-trunk-12-3`:

```bash
criar motorcx-voz-trunk-12-3 "Senha do tronco"
```

Tronco autenticado por IP não tem senha.

**Opcionais:**
- `motorcx-voz-deepgram`, `motorcx-voz-llm` e `motorcx-voz-tts`: chaves da Montagem MotorCX;
- `motorcx-voz-transcricao-api`: chave da reserva da transcrição por API;
- `motorcx-voz-elevenlabs-api` e `motorcx-voz-elevenlabs-webhook`: chave da API de conversas e segredo do webhook
  pós-chamada da ElevenLabs (SQL 63; veja "Webhook da ElevenLabs" na seção 4).

**Usuário dos envios:** no metadado `motorcx-enviado-por` de cada VM, coloque o uuid do usuário da equipe
MotorCX que assina os envios de eventos (`envios.enviado_por`):

```bash
gcloud compute instances add-metadata motorcx-ast-1 --zone=southamerica-east1-a \
  --metadata=motorcx-enviado-por=<uuid>
```

## 3. Bucket de gravações: um por empresa

```bash
bash criar_gcp.sh empresa <id> <dias> SEU-PROJETO      # ex.: empresa 12 1825 = 5 anos
```

O bucket se chama `<projeto>-motorcx-grav-e<id>` e fica privado, em São Paulo. Ele apaga as gravações depois
de `<dias>` dias: o mínimo é 90 e não há teto. A partir de 365 dias, a gravação vai para a classe Coldline aos
90 dias. O bucket usa CMEK se a chave existir. **Grave o nome em `voz_config.bucket_gravacoes` da empresa.**

Empresa sem bucket não tem a chamada gravada, e o orquestrador mostra um alerta. Para mudar a retenção, rode o
mesmo comando com outro número de dias.

## 4. O que roda em cada VM

As imagens são publicadas pelo GitHub (`.github/workflows/imagem-voz.yml`) no Artifact Registry:
`motorcob/asterisk` e `motorcob/voz`. Às 05:35 a VM baixa as imagens novas e reinicia os serviços que mudaram,
antes da janela de discagem.

| Serviço | O que faz |
|---|---|
| `motorcx-asterisk` | Asterisk 22 (PJSIP, ARI, AMD, MixMonitor) na rede do host. SIP em 5060, RTP em 10000–20000, ARI só em `127.0.0.1:8088`. |
| `motorcx-voz-orquestrador` | Plantão das empresas com `voz_config.modo = 'real'`. Só disca com o acesso próprio ao banco (seção 7). Detalhes abaixo da tabela. |
| `motorcx-voz-simulado` | O mesmo plantão para as empresas em modo `simulado`, sem ligação de verdade. |
| `motorcx-voz-config.timer` | A cada 2 min, busca troncos, rotas, transferências e config no banco. Se algo mudou, regera o pjsip e o dialplan dentro do contêiner, com as senhas do cofre, e recarrega. Configuração inválida no banco mantém a que está no ar. |
| `motorcx-voz-transcricao.timer` | A cada 10 min, transcreve com Whisper as gravações importadas do discador do cliente. Só transcreve áudio com pelo menos `transcrever_min_segundos` e redige CPF e cartão. |
| `motorcx-voz-speech.timer` | A cada 15 min, Speech Analytics (SQL 62) das transcrições em `/var/motorcx/transcricoes`: nota do checklist e códigos fechados numa chamada ao LLM da Montagem (`/etc/motorcx/provedores.json`, chave no cofre). Desligado por padrão (veja abaixo). |
| `motorcx-voz-speech-noite.timer` | 02:40, agregados do dia do Speech Analytics (ontem e anteontem, idempotente), recomendações (`motor/retroalimentacao.py`) e impacto de 28 dias. Mesmo interruptor. |
| `motorcx-voz-speech-buscas` | Serviço contínuo da busca semântica do site (SQL 60/63): a cada 2 s pega as buscas pendentes da parte desta VM, calcula o embedding da pergunta na Vertex (São Paulo) e responde. O site consulta até a resposta chegar; a busca vira erro sozinha em 2 min. Custo do embedding na margem (componente `embeddings`). Mesmo interruptor: desligado, sai e fica parado (depois de ligar o metadado, `systemctl restart motorcx-voz-speech-buscas`). |
| `motorcx-voz-speech-temas.timer` | Segunda 03:20, temas novos da semana passada (SQL 63): agrupa os trechos do cliente que ficaram sem tema e sem intenção. Grupo com 30 conversas ou mais vai para a Curadoria com um nome sugerido pela IA; quem dá o nome é uma pessoa. Mesmo interruptor. |

O plantão do orquestrador:
- baixa a Lista do dia que o motor publicou (`saidas/<slug>/<data>[/<credor>]/`);
- disca;
- grava `voz_chamadas` e `consumo_voz`;
- manda os eventos ao motor como **retorno de fornecedor** (envio tipo `retorno`, arquivo
  `motorcx_voz_*.csv` ou `motorcx_discador_*.csv`, lido pelos layouts `layouts/motorcx_*.json`).

As variáveis da fala de cada cliente (primeiro nome, saldo, atraso, vencimento) vêm das colunas extras do
`ids/agente_voz.csv` que o motor gera; `credor` é o nome da carteira (`credores.nome`). O plantão apaga os
arquivos baixados logo depois de ler: os valores ficam só na memória da VM durante o lote e vão ao provedor na
chamada. Vão só as variáveis que a empresa escolheu em `voz_config.variaveis`, sempre dentro de
`variaveis_voz()`, e nunca o CPF. Nada disso vai para o banco, para os eventos ou para o log.

Os segredos ficam só em `/run/motorcx`, que é memória. As gravações ficam em `/var/motorcx/gravacoes` até
subirem para o bucket da empresa.

**Provedores de voz da VM:**
- `/etc/motorcx/provedores.json`: `{"montagem": {...}, "elevenlabs": {"numero_agente": "..."}}` (a chave
  `montagem` atende quem tem `voz_config.provedor = 'montagem_motorcx'`);
- `/etc/motorcx/provedores_sip.json`: o endpoint SIP da ElevenLabs.

**Speech Analytics (SQL 62):** desligado por padrão em dois lugares.
1. Na VM: metadado `motorcx-speech-analytics=1` (sem ele, os dois timers saem sem fazer nada):
   `gcloud compute instances add-metadata "$VM" --zone="$ZONA" --metadata=motorcx-speech-analytics=1`.
2. Por empresa, no banco (o Master): `update public.voz_config set speech_analytics = true where empresa_id = <id>;`.
   Cada minuto analisado entra na fatura no item `ia_speech_analytics` pelo preço da empresa; o custo real do LLM
   (tokens × `custos_ia_voz`, componente `avaliador`) fica só para a margem do Master.
A transcrição de cada gravação é casada com `voz_gravacoes` pelo nome do arquivo em
`/var/motorcx/transcricoes/empresa_<id>/<ref>.json`: `<ref>` = id da gravação (preferido), `transcricao_caminho`,
o nome do arquivo da gravação sem extensão ou o `id_chamada`. Ao lado fica `<ref>.analise.json` (só a situação).

**Ligações da IA (SQL 63):** a transcrição é o texto da própria conversa (sem Whisper e sem custo de transcrição).
O orquestrador grava `ia_<id da chamada>.json` (já mascarado) só quando a ligação é gravada, e a gravação sobe como
`credor_<id>/<AAAA>/<MM>/<DD>/ia_<id da chamada>.wav` e entra em `voz_gravacoes`: o nome sem extensão é o `<ref>`.
As transcrições (da IA e do Whisper) com mais de 90 dias são apagadas pela transcrição e pela análise.
ElevenLabs: para receber a conversa (e o resultado) pela API, ponha no `provedores.json`
`"elevenlabs": {"numero_agente": "...", "agent_id": "<id do agente>", "ref_api": "voz/elevenlabs-api"}` e crie o
segredo `motorcx-voz-elevenlabs-api` no Secret Manager (a chave nunca vai para arquivo).

**Webhook da ElevenLabs (pós-chamada, SQL 63):** só sobe com o provedor ElevenLabs configurado e
`"ref_webhook": "voz/elevenlabs-webhook"` no `provedores.json` (porta interna `"webhook_porta"`, padrão 8092), e só no
plantão real. O receptor roda dentro do orquestrador, escuta só em `127.0.0.1:8092`, aceita só
`POST /elevenlabs/pos-chamada`, confere a assinatura `ElevenLabs-Signature` (HMAC-SHA256 com o segredo do webhook,
carimbo de no máximo 30 min), recusa corpo sem tamanho (411), acima de 2 MB (413) ou que não chega em 10 s (408), não
guarda nem registra o corpo e entrega transcrição e resultado à chamada. O que o dono faz uma vez por VM:
1. `criar motorcx-voz-elevenlabs-webhook "Segredo do webhook da ElevenLabs"` (o valor que a ElevenLabs mostra ao
   criar o webhook);
2. no Caddy da VM (o mesmo TLS da 8443 do simulador), acrescentar a rota:
   ```
   handle /elevenlabs/pos-chamada {
       request_body { max_size 2MB }
       reverse_proxy 127.0.0.1:8092
   }
   ```
   e `systemctl reload caddy`. A 8443 já está aberta no firewall; não precisa abrir outra porta;
3. na ElevenLabs (Conversational AI › Webhooks), apontar o pós-chamada (`post_call_transcription`) para
   `https://<IP da VM>:8443/elevenlabs/pos-chamada` (35.198.40.10 ou 34.39.217.31) e ligar o envio da transcrição.
A ElevenLabs aceita UM endereço de webhook por espaço de trabalho: com as duas VMs, a VM que recebe entrega as chamadas
dela; as da outra VM chegam pela API de conversas (`agent_id` + `ref_api`, ligue as duas coisas).

**Checklist do piloto (ElevenLabs, SQL 63):**
- [ ] a variável dinâmica `motorcx_id` chega na conversa (o `X-MotorCX-Id` do INVITE vira `motorcx_id`);
- [ ] `GET /v1/convai/conversations?agent_id=…&call_start_after_unix=…` lista as conversas do agente e
      `GET /v1/convai/conversations/{id}` traz `transcript` (`role`, `message`, `time_in_call_secs`), `status` = `done`
      e `conversation_initiation_client_data.dynamic_variables.motorcx_id`;
- [ ] o webhook assinado chega na VM (resposta 200; assinatura errada dá 401) e a transcrição aparece em
      `/var/motorcx/transcricoes/empresa_<id>/ia_<id>.json` (mascarada);
- [ ] o campo de análise com o resultado é `data_collection_results.resultado`.

## 5. Transferência para o discador do cliente

**Importante:** a transferência por **REFER** (`voz_transferencias.metodo = 'refer'`) precisa ser validada com
cada discador do cliente pelo botão **"Testar transferência"** antes de entrar em produção. Os discadores tratam
REFER e os cabeçalhos X-MotorCX de jeitos diferentes. Esses cabeçalhos vão no Refer-To. Cada destino escolhe
quais leva (`voz_transferencias.cabecalhos`; o padrão são os quatro):
- `X-MotorCX-Id-Chamada`: o id da chamada;
- `X-MotorCX-Id-Acao`: o id da ação do motor;
- `X-MotorCX-Acao`: o canal da ação (`agente_voz` ou `discador`);
- `X-MotorCX-Motivo`: o motivo da transferência.

Nunca levam CPF, nome ou valor. O destino da carteira vale antes do destino da empresa toda.

Se o REFER falhar, a **ponte** entra automaticamente como alternativa: o MotorCX liga para o destino, com os
mesmos cabeçalhos no INVITE, e junta as duas pernas.

## 6. Testes sem operadora real

```bash
bash infra/asterisk/teste_fumaca.sh             # monta a imagem e confere módulos, endpoints, dialplan e ARI
bash infra/asterisk/teste_ponta_a_ponta.sh      # Asterisk + 3 operadoras SIPp + orquestrador de verdade
```

Na ponta a ponta:
- a operadora A recusa com 503 e a chamada vai para a B (failover);
- a B atende, e a chamada passa pelo AMD, pelo Stasis e pelo provedor (Simulador) e termina com BYE;
- a C responde 404, e o evento sai como número inexistente, com o SIP 404 e o Q.850 1 vindos do ARI.

O teste também confere o Request-URI de cada operadora (tech prefix + DDD + número).

## 7. Acesso próprio ao banco (obrigatório antes do modo real)

No piloto (modo simulado), as VMs usam a chave do servidor do Supabase. Antes do modo real, elas passam a entrar no
banco com o papel **`motorcx_voz`** (SQL 57), que só enxerga a voz: lê a configuração, grava chamadas, gravações,
consumo, lotes, ondas e saúde, e publica o retorno. Não lê clientes, carteiras, perfis nem faturas, e não faz DDL.
**Enquanto a VM estiver com a chave do servidor, o plantão do modo real fica parado** (o simulado segue normal).

Faça uma vez, no Cloud Shell, com o projeto do GCP selecionado. Nenhum passo mostra a senha.

1. **Gere a senha direto no Secret Manager:**

   ```bash
   openssl rand -base64 96 | tr -dc 'A-Za-z0-9' | head -c 48 | gcloud secrets create motorcx-voz-db-senha \
     --replication-policy=user-managed --locations=southamerica-east1 --data-file=-
   ```

2. **Rode o SQL 57** (`supabase/migrations/20261224000001_voz_acesso_proprio.sql`) no SQL Editor do Supabase.

3. **Defina a senha do papel** lendo o segredo. O script manda ao banco só o verificador SCRAM, nunca a senha.
   Antes, baixe o certificado da CA em **Database Settings › SSL Configuration** (arquivo `prod-ca-2021.crt`,
   público) para a pasta atual. Troque `<ref>` pela referência do projeto e `<host-do-pooler>` pelo host do pooler,
   que aparece no Supabase em **Connect › Session pooler** (ex.: `aws-0-sa-east-1.pooler.supabase.com`). O psql
   pede a senha do `postgres`.

   ```bash
   gcloud secrets versions access latest --secret=motorcx-voz-db-senha \
     | python3 infra/asterisk/senha_motorcx_voz.py \
     | psql "host=<host-do-pooler> port=5432 dbname=postgres user=postgres.<ref> sslmode=verify-full sslrootcert=prod-ca-2021.crt" \
       -v ON_ERROR_STOP=1 -q
   ```

4. **Publique a Edge Function de arquivos**, com "Verify JWT" desligado (quem autoriza é o bilhete do banco):

   ```bash
   supabase functions deploy voz-arquivos --no-verify-jwt --project-ref <ref>
   ```

5. **Troque o modo das VMs.** Na mesma pasta do certificado, rode para cada VM (`motorcx-ast-1` na zona `a` e
   `motorcx-ast-2` na zona `b`):

   ```bash
   VM=motorcx-ast-1; ZONA=southamerica-east1-a
   gcloud compute instances add-metadata "$VM" --zone="$ZONA" \
     --metadata=motorcx-voz-acesso=acesso_proprio,motorcx-voz-db-host=<host-do-pooler>,motorcx-voz-db-usuario=motorcx_voz.<ref> \
     --metadata-from-file=motorcx-voz-db-ca=prod-ca-2021.crt
   gcloud compute ssh "$VM" --zone="$ZONA" --tunnel-through-iap -- \
     'sudo systemctl restart motorcx-voz-config motorcx-voz-simulado motorcx-voz-orquestrador'
   ```

   Confira no journal da VM (`journalctl -u motorcx-voz-config -n 20`) que a configuração foi lida sem erro.

6. **Tire a chave do servidor do alcance das VMs.** Com as duas VMs no acesso próprio, desative o segredo
   (volta com `enable` se precisar voltar ao piloto):

   ```bash
   gcloud secrets versions disable latest --secret=motorcx-voz-supabase-key
   ```

**Conferência:** a consulta do topo do SQL 57, no SQL Editor. O esperado é: `entra` true; `herda`, `fura_rls`,
`super` e `cria` false; `membro_de`, `tabelas_fora_da_voz`, `definer_fora_da_voz` e `schemas_com_create` 0;
`le_config` e `grava_chamadas` true; `tem_senha` true depois do passo 3.

**Para voltar ao piloto:** `motorcx-voz-acesso=supabase_chave` no metadado, reative o segredo da chave e reinicie
os serviços. O modo real volta a ficar parado.
