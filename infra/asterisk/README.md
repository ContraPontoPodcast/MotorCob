# Asterisk do MotorCX (telefonia do agente de voz)

O Asterisk do MotorCX roda em 2 VMs em São Paulo, com IP fixo. Ele origina as chamadas pelos troncos de cada
empresa, aplica rota e tech prefix, grava, lê o Q.850 e detecta máquina. Só quando atende uma pessoa ele liga o
provedor de voz. Quando é preciso um humano, transfere por SIP para o discador do cliente.

## 1. Criar a infraestrutura no Google Cloud (uma vez)

1. Peça a cada operadora a lista de IPs do SBC dela, de sinalização e de mídia.
2. Abra o Cloud Shell: em console.cloud.google.com, clique no ícone `>_` no topo.
3. Envie o `criar_gcp.sh` para o Cloud Shell (menu ⋮ › Fazer upload) ou clone o repositório.
4. Abra o script e edite a lista do topo:
   - `IPS_OPERADORAS`: os IPs das operadoras, um por linha (obrigatório). Os IPs de exemplo que vêm no
     arquivo fazem o script parar, de propósito.
   - `IPS_PROVEDORES_VOZ` e `IPS_DISCADORES_CLIENTES`: preencha se já houver.
5. Rode:

   ```bash
   bash criar_gcp.sh SEU-PROJETO
   ```

   Opções, sempre antes do `bash`:
   - `RETENCAO_DIAS=1825`: guarda 5 anos. O mínimo é 90 e não há teto. A partir de 365 dias, a gravação vai
     para a classe Coldline depois de 90 dias.
   - `USAR_CMEK=1`: cifra o bucket com uma chave própria no Cloud KMS.
   - `MAQUINA=n2-standard-8`: muda o tamanho das VMs.
6. No fim, o script mostra os **2 IPs**. Mande os dois para as operadoras liberarem SIP e RTP (10000–20000).

O script pode rodar de novo. Para incluir uma operadora, edite a lista e rode outra vez: as regras de firewall
e a retenção são atualizadas, e o que já existe fica como está.

O script não pede nem mostra segredos. A senha do ARI é gerada dentro do Secret Manager
(`motorcx-voz-ari-senha`) e não aparece na tela.

**O que é criado:**
- a rede `motorcx-voz`;
- 2 IPs estáticos;
- o firewall: SIP e RTP só das origens da lista, e SSH só pelo IAP;
- a conta `motorcx-asterisk`, que só pode:
  - ler os segredos `motorcx-voz-*`;
  - gravar e ler no bucket de gravações;
  - escrever log e métrica;
- o bucket `<projeto>-motorcx-gravacoes`: privado, em São Paulo, com apagamento automático;
- as VMs `motorcx-ast-1` (zona a) e `motorcx-ast-2` (zona b): Shielded VM, Debian 12, Docker instalado no
  primeiro boot.

## 2. Senha de cada tronco

A senha de cada tronco fica no Secret Manager, e o banco guarda só a referência (`voz_troncos.segredo_ref`).
Para a referência `voz/trunk/12-3`, o nome do segredo é `motorcx-voz-trunk-12-3`.

Quem cadastra o tronco digita a senha sem que ela apareça na tela:

```bash
read -r -s -p "Senha do tronco: " S; printf '%s' "$S" | \
  gcloud secrets create motorcx-voz-trunk-12-3 --replication-policy=user-managed \
  --locations=southamerica-east1 --data-file=-; unset S
```

Tronco autenticado por IP não tem senha.

## 3. Imagem e configuração

**Imagem:** `infra/asterisk/Dockerfile`. É o Asterisk 22.11.0 compilado da fonte oficial, com o SHA-256
conferido. Traz PJSIP, ARI, AMD, MixMonitor e Transfer. Para montar a imagem:

```bash
docker build -f infra/asterisk/Dockerfile -t motorcx-asterisk .
```

**Configuração:** `voz/asterisk/gerador.py` gera dois arquivos a partir do JSON do banco (`voz_troncos`,
`voz_rotas`, `voz_transferencias`):
- `pjsip_motorcx.conf`, com um endpoint por tronco e a senha lida do Secret Manager (arquivo 0600);
- `extensions_motorcx.conf`, com AMD, gravação, transferência e saída por tipo de número (tech prefix,
  prioridade, failover e canais por tronco).

O CPS por tronco é aplicado pelo orquestrador.

**Na VM**, a rede é a do host:
- SIP em 5060;
- RTP em 10000–20000;
- ARI só em `127.0.0.1:8088`.

```bash
gcloud secrets versions access latest --secret=motorcx-voz-ari-senha | \
  install -m 400 -o 10010 -g 10010 /dev/stdin /run/motorcx/ari_senha   # /run é memória; uid do Asterisk
docker run -d --name asterisk --restart=always --network host \
  -e MOTORCX_GCP_PROJETO=SEU-PROJETO -e MOTORCX_IP_EXTERNO=<IP da VM> -e MOTORCX_REDE_LOCAL=10.60.0.0/24 \
  -v /run/motorcx:/run/motorcx:ro -v /var/motorcx/gravacoes:/var/spool/asterisk/motorcx motorcx-asterisk
```

**Orquestrador:** roda na mesma VM. Precisa do `websocket-client` (`voz/requirements.txt`), separado da imagem
do motor:

```bash
python3 -m voz.orquestrador.principal --dados /run/motorcx/voz.json \
  --lista empresa=12:/dados/.../discador_mailing.csv --eventos /var/motorcx/eventos \
  --bucket SEU-PROJETO-motorcx-gravacoes --contratado 300
```

## 4. Teste de fumaça (sem ligar para ninguém)

```bash
bash infra/asterisk/teste_fumaca.sh
```

O teste monta a imagem e sobe o contêiner com troncos fictícios. Depois confere:
- a versão;
- os módulos;
- os endpoints;
- o dialplan;
- o ARI: recusa sem senha e responde com senha;
- as permissões dos arquivos com senha.
