# MotorCob em produção no Mac

## Como a operação funciona

1. **Carga do credor, todo dia.** A base de devedores com dívida e contatos (a carteira
   toda, o colchão ou o preventivo). Só quem está na carga do dia recebe ação; quem saiu
   não é acionado, mas não perde o histórico.
2. **Lista do dia.** Um contato por cliente em cada canal (WhatsApp, RCS, SMS, e-mail,
   agente virtual, discador), com o contato **Hot** sempre primeiro.
3. **Ocorrência.** A empresa diz só se cada cliente deu CPC ou não. O motor sabe qual
   contato e qual canal foram usados na ação.
4. **CPC → Hot.** O contato que deu CPC vira Hot (prioritário em toda exportação) e o
   canal do CPC fica marcado: o cliente vai para CPC A e as ações seguintes saem por ali.

**Rotação até achar o Hot:** com 1 telefone por cliente, cada passagem usa o próximo
telefone ainda não tentado — 1ª passagem o telefone 1, 2ª o 2, 3ª o 3, 4ª o 4, e então
recomeça pelo tentado há mais tempo. A rotação conta pelo que foi exportado, mesmo que a
ocorrência atrase. No primeiro CPC, o telefone exportado vira Hot e o motor fica fiel a
ele em todos os canais.

**Mais de um telefone por cliente:** em cada canal a empresa escolhe 1 contato (padrão)
ou mais (2, 3, todos) na Lista do dia. Com mais de um, o CPC vale para o cliente na hora
(CPC A, canal marcado) e os telefones enviados viram candidatos: as próximas ações vão a
um candidato por vez; o que der CPC sozinho vira Hot, o que não atender sai da lista.

**Personas (aprendizado automático):** a cada rotina o motor cruza as características dos
clientes (colunas da carga, faixa de saldo e atraso, DDD, tem WhatsApp/RCS) com as
ocorrências e escolhe sozinho as que mais mudam a resposta por canal. Na esteira, "★
melhor canal da persona" usa, para cada cliente, o canal com mais CPC por real gasto entre
clientes parecidos (10% exploram outro canal). Mudanças de régua viram sugestões com
evidência na página Personas; aprovadas, entram na rotina seguinte como um segmento novo
na Orquestração. Sem histórico suficiente, vale a média da carteira.

Status do contato: **HOT** (deu CPC ou veio marcado como preferencial na carga) ·
**WHATSAPP** · **RCS** · **NEUTRO** (sem validação) · **INVÁLIDO**. O retorno do bureau
só atualiza esses status e traz números novos.

## 1. Instalar (uma vez)

1. Instale o Homebrew (https://brew.sh) e o Python:
   ```bash
   brew install python@3.12 git
   ```
2. Baixe o MotorCob **na sua pasta de usuário** (não em Documentos, Mesa ou Downloads — o
   macOS bloqueia o agendamento automático nessas pastas):
   ```bash
   cd ~
   git clone https://github.com/ContraPontoPodcast/MotorCob.git
   cd MotorCob
   ```
3. Rode o instalador, informando o horário da rotina diária:
   ```bash
   scripts/instalar_mac.sh 06:30
   ```
   Ele cria a pasta de dados `~/MotorCob-dados`, instala o `openpyxl` (Excel do comitê),
   roda os testes e agenda a rotina todo dia às 06:30. Se o Mac estiver dormindo nesse
   horário, a rotina roda quando ele acordar. Sem o horário, nada é agendado.

   **Lista na hora em que a carga chega** (no lugar do horário fixo):
   ```bash
   scripts/instalar_mac.sh vigiar
   ```
   A vigia fica no ar (plantão) e olha o site a cada 5 segundos; quando alguma empresa sobe
   arquivo da carteira (carga, incremental, retirada, acordo, baixa), ela começa na hora:
   baixa, roda o dia dessa carteira e publica a lista (o tempo é o da própria rotina, em geral
   1 a 3 minutos). Também refaz a lista em até 1 minuto quando a orquestração muda no site e,
   **todo dia a partir das 06:00**, roda a rotina do dia das carteiras que ainda não rodaram
   hoje (sem isso, em dia sem carga a esteira não anda). Substitui o agendamento diário (e
   `instalar_mac.sh 06:30` volta para o diário). Enquanto a vigia está no ar o Mac não dorme
   sozinho (`caffeinate`), mas com a tampa fechada ou desligado ela para. Suba a **ocorrência
   antes da carga**:
   assim a lista já sai com os CPCs de ontem. Carga sem as colunas obrigatórias fica com
   erro no site (com o motivo) e não gera lista; envie de novo corrigida.
   Registro: `~/MotorCob-dados/logs/vigia_<data>.log`.

   **Arquivo parado em "pendente"?** Rode `scripts/diagnostico.sh`: confere Python, versão,
   ligação com o Supabase, banco, arquivos pendentes, última rotina e a vigia, e diz o que
   fazer. Carga em Excel (.xlsx) também é aceita (vira CSV ao baixar; .xls antigo não).

   **Empresa nova não precisa de configuração**: sem `empresas/<slug>.json`, o MotorCob
   reconhece as colunas de cada arquivo sozinho e mostra no alerta da rotina (Início do site)
   o que entendeu ("LAYOUT AUTOMÁTICO (confira)"). Se algo estiver errado, mande o cabeçalho
   para criar o `empresas/<slug>.json`, que passa a valer no lugar do automático.

Para atualizar o programa depois: `cd ~/MotorCob && git pull`.

> **Com o site motorcob.online:** depois de instalar, rode `scripts/configurar_nuvem.sh`
> (veja `docs/NUVEM.md`). Os arquivos de entrada passam a ser enviados pelo site e a fila é
> baixada no site. Cada empresa cliente ganha a própria pasta,
> `~/MotorCob-dados/empresas/<slug>/`, com a mesma estrutura abaixo (mais `bruto/` para a
> base bruta e `ocorrencias/` para as ocorrências). Você não precisa mexer nela. A rotina
> diária faz `git pull` antes de rodar, então empresa nova configurada no repositório
> chega sozinha ao Mac.

## 2. A pasta de dados

Fica fora do repositório porque tem dado pessoal. **Nunca coloque esses arquivos no git.**

```
~/MotorCob-dados/
├── base/
│   ├── clientes.csv    id_cliente;data_entrada;saldo;dias_atraso;bloqueio
│   ├── contatos.csv    id_cliente;contato;tipo;origem;cpf;whatsapp_valido;atualizado_em
│   └── parcelas.csv    id_cliente;id_acordo;parcela;vencimento;valor;pago_em   (opcional)
├── retornos/           arquivos de retorno dos fornecedores (vão se acumulando)
├── logs/               portal.csv (opcional) e o log de cada execução
├── estado/             TAG de cada cliente e trilha — criado pelo motor, NÃO apagar
└── saida/              resultado de cada dia
```

- Separador `;`. Datas `AAAA-MM-DD` ou `DD/MM/AAAA`. Valores `1.234,56` ou `1234.56`.
- `clientes.csv`: uma linha por contrato; o motor soma os contratos do mesmo cliente.
  `bloqueio` vazio = cliente liberado (preencha com o motivo: opt-out, óbito, judicial…).
- `contatos.csv`: `tipo` = `telefone` ou `email`. `cpf`, `origem`, `whatsapp_valido`
  (1/0) e `atualizado_em` (data do enriquecimento) são opcionais, mas `whatsapp_valido`
  libera o WhatsApp de localização e `atualizado_em` controla a revalidação.
- Os exemplos em `exemplos/` mostram cada arquivo preenchido.

## 3. O dia a dia

**Antes da rotina** (ou antes do horário agendado): atualize `base/` e copie para
`retornos/` os arquivos de retorno de ontem de cada fornecedor.

**Rodar na mão** (se não agendou, ou para rodar de novo):
```bash
~/MotorCob/scripts/rodar_dia.sh              # hoje
~/MotorCob/scripts/rodar_dia.sh 2026-10-01   # uma data específica
```
Rodar duas vezes no mesmo dia não duplica nada.

**O que sai em `~/MotorCob-dados/saida/AAAA-MM-DD/`:**

| Arquivo | Para quê |
|---|---|
| `ids/whatsapp.csv`, `ids/rcs.csv`, `ids/sms.csv`, `ids/email.csv`, `ids/agente_voz.csv`, `ids/discador.csv` | **ID do cliente + contato a acionar hoje em cada canal** (`id_cliente;contato`). No discador e no agente virtual o cliente pode ter várias linhas, uma por número, na ordem de discagem. Suba na ferramenta do canal. |
| `ids/discador_reserva.csv` | Mesma coisa, para o discador **só se o agente virtual não conseguir contato** hoje. |
| `alertas.txt` | Leia todo dia (ex.: freio do WhatsApp por taxa de bloqueio). |
| `enriquecimento.csv` | Clientes para mandar ao bureau (entrada, revalidação, canais esgotados). |
| `fila_do_dia.csv` | Detalhe completo: régua, passo, TAG e o contato que o motor escolheu. |

O log de cada execução fica em `~/MotorCob-dados/logs/rodar_dia_AAAA-MM-DD.log`.

**Todo mês**, para o comitê:
```bash
~/MotorCob/scripts/relatorio_mes.sh 2026-09
```
Gera o Excel do Real x Previsto e os KPIs em `~/MotorCob-dados/saida/comite/2026-09/`.

## 4. Empresa nova, fornecedor novo ou código novo

- **Empresa cliente nova:** cadastre no site (Empresas) e crie `empresas/<slug>.json` a
  partir de `empresas/exemplo.json`, com os cabeçalhos reais da base bruta e do arquivo de
  ocorrências e o de-para das ocorrências da empresa para os resultados genéricos
  (`cpc`, `sem_contato`, `atendida_sem_cpc`, `terceiro`, `invalido`, `opt_out`).
- **Ocorrência sem contato:** a empresa não precisa dizer qual telefone foi usado. O motor
  guarda em `estado/escolhas.csv` o que mandou acionar em cada dia e liga a ocorrência a
  esse contato (procura até 3 dias antes da data da ocorrência). Quando o canal teve
  vários números no dia (discador, agente virtual) e a ocorrência não diz qual, ela conta
  para a TAG do cliente mas não certifica nenhum número. Mande a ocorrência até a manhã
  seguinte: a TAG de um dia é fechada na rotina do dia seguinte.
- **Clusters da empresa:** definidos no site (página Clusters), sobre qualquer coluna da
  base bruta e sobre saldo, dias de atraso e quantidade de contratos. Vale a primeira
  regra que bate; quem não bate fica no padrão ticket × atraso. Regra com erro ou coluna
  que não existe na base aparece nos alertas da rotina (`CLUSTER: ...`) e não para nada.
  Mudar as regras revisa o cluster atual de todos na rotina seguinte; o de origem não muda.
- **Estratégias:** cada cluster aponta para uma estratégia (página Estratégias do site) que
  diz, fase por fase (cliente novo, CPC, Não CPC, preventivo, quebra), em que dia, por
  qual canal e em quais contatos acionar — um blend por dia: "WhatsApp em número com
  WhatsApp → senão RCS em número que pertence → senão SMS em 2 números + junto e-mail".
  Cluster sem estratégia segue a padrão da empresa; sem padrão, o playbook
  (`regras/regua.json`). Estratégia com erro vira alerta e o cluster segue o playbook.
- **Canais da empresa** (página Canais): ligado/desligado, horário, sábado, capacidade por
  dia (passou, entram primeiro os de maior prioridade e saldo; o resto aparece em alerta),
  custo por ação (usado na ocorrência sem custo) e tentativas por dia na voz.
- **Retorno do enriquecimento:** o arquivo do bureau (tipo "Retorno do enriquecimento" no
  site) liga pelo CPF/CNPJ, traz números novos e as marcas de WhatsApp, RCS, Não Perturbe,
  score e ranking. Tudo é relido a cada rotina (vale o arquivo mais recente). Número no
  Não Perturbe não recebe voz (a empresa pode mudar na página Canais). Cliente parado
  esperando re-enriquecimento volta ao giro quando chega contato novo.
- **Base bruta:** cada arquivo recebido fica em `bruto/` e todos são relidos a cada
  rotina; vale o dado mais recente de cada cliente. Com `"base_completa": true`, quem não
  está no arquivo mais recente sai das ações (bloqueio `fora_da_base`).

- Arquivo de retorno de um fornecedor sem layout aparece no resumo como "arquivos sem
  layout" e não é processado. Crie `layouts/<fornecedor>.json` (veja os existentes).
- Código de retorno que o layout não conhece aparece como "retornos em quarentena".
  Acrescente o código no de-para do layout.
- Mudou uma regra do playbook? Edite `regras/regua.json` e registre no git.

## 5. Cuidados

- **Backup diário de `~/MotorCob-dados/estado/`** (Time Machine já resolve). Sem ele, o
  motor recalcula tudo a partir dos arquivos, mas perde a história da trilha.
- **WhatsApp:** o cliente sai na lista de WhatsApp quando tem um número liberado pelo
  motor (certificado, ou 1 número com WhatsApp válido), e a lista já traz esse número. Se
  a ferramenta do canal mandar para outro número do cliente, a trava contra banimento
  deixa de valer.
- **As listas `ids/` têm telefone e e-mail.** Só para a ferramenta do canal; não repasse.
- Para cancelar o agendamento:
  `launchctl unload ~/Library/LaunchAgents/br.com.contraponto.motorcob.plist`
