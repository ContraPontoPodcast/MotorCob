# MotorCob em produção no Mac

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

Para atualizar o programa depois: `cd ~/MotorCob && git pull`.

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
| `ids/whatsapp.csv`, `ids/rcs.csv`, `ids/sms.csv`, `ids/email.csv`, `ids/agente_voz.csv`, `ids/discador.csv` | **IDs de cliente a acionar hoje em cada canal.** Suba na ferramenta do canal, que monta o mailing pelo ID. |
| `ids/discador_reserva.csv` | IDs para o discador **só se o agente virtual não conseguir contato** hoje. |
| `alertas.txt` | Leia todo dia (ex.: freio do WhatsApp por taxa de bloqueio). |
| `enriquecimento.csv` | Clientes para mandar ao bureau (entrada, revalidação, canais esgotados). |
| `fila_do_dia.csv` | Detalhe completo: régua, passo, TAG e o contato que o motor escolheu. |

O log de cada execução fica em `~/MotorCob-dados/logs/rodar_dia_AAAA-MM-DD.log`.

**Todo mês**, para o comitê:
```bash
~/MotorCob/scripts/relatorio_mes.sh 2026-09
```
Gera o Excel do Real x Previsto e os KPIs em `~/MotorCob-dados/saida/comite/2026-09/`.

## 4. Fornecedor novo ou código de retorno novo

- Arquivo de retorno de um fornecedor sem layout aparece no resumo como "arquivos sem
  layout" e não é processado. Crie `layouts/<fornecedor>.json` (veja os existentes).
- Código de retorno que o layout não conhece aparece como "retornos em quarentena".
  Acrescente o código no de-para do layout.
- Mudou uma regra do playbook? Edite `regras/regua.json` e registre no git.

## 5. Cuidados

- **Backup diário de `~/MotorCob-dados/estado/`** (Time Machine já resolve). Sem ele, o
  motor recalcula tudo a partir dos arquivos, mas perde a história da trilha.
- **WhatsApp:** o ID sai na lista de WhatsApp quando o cliente tem um número liberado pelo
  motor (certificado, ou 1 número com WhatsApp válido). Se a ferramenta do canal mandar
  para outro número do cliente, a trava contra banimento deixa de valer — o número
  escolhido está em `fila_do_dia.csv`, coluna `contato`.
- Para cancelar o agendamento:
  `launchctl unload ~/Library/LaunchAgents/br.com.contraponto.motorcob.plist`
