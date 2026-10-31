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
criar motorcx-voz-supabase-key "Chave do servidor do Supabase"
```

**Senha de tronco:** o banco guarda só a referência (`voz_troncos.segredo_ref`). Para a referência
`voz/trunk/12-3`, o segredo se chama `motorcx-voz-trunk-12-3`:

```bash
criar motorcx-voz-trunk-12-3 "Senha do tronco"
```

Tronco autenticado por IP não tem senha.

**Opcionais:**
- `motorcx-voz-deepgram`, `motorcx-voz-llm` e `motorcx-voz-tts`: chaves da Montagem MotorCX;
- `motorcx-voz-transcricao-api`: chave da reserva da transcrição por API.

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
| `motorcx-voz-orquestrador` | Plantão das empresas com `voz_config.modo = 'real'`. Detalhes abaixo da tabela. |
| `motorcx-voz-simulado` | O mesmo plantão para as empresas em modo `simulado`, sem ligação de verdade. |
| `motorcx-voz-config.timer` | A cada 2 min, busca troncos, rotas, transferências e config no banco. Se algo mudou, regera o pjsip e o dialplan dentro do contêiner, com as senhas do cofre, e recarrega. Configuração inválida no banco mantém a que está no ar. |
| `motorcx-voz-transcricao.timer` | A cada 10 min, transcreve com Whisper as gravações importadas do discador do cliente. Só transcreve áudio com pelo menos `transcrever_min_segundos` e redige CPF e cartão. |

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
