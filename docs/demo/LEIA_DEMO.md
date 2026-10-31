# Kit demo do MotorCX: empresa de demonstração com dados 100% fictícios

Este roteiro serve para mostrar o MotorCX a um prospect hoje, com uma empresa de mentira, carteiras de mentira e
nenhuma mensagem saindo de verdade. O dono faz cada clique. Este documento não pede nem guarda senha.

> **Regras de ouro**
> 1. Na empresa demo entram só os arquivos do gerador (`scripts/demo/gerar_carga_demo.py`). Nunca use base de cliente,
>    nem "só um pedacinho" dela.
> 2. Na demo nada é enviado: a Mensageria fica desligada ou em **simulação**, não há fornecedor e não há API.
> 3. A pasta gerada (`demo_saida/`) nunca vai para o Git. Ela já está no `.gitignore`.

Os nomes de menu abaixo são os do site em 31/10/2026. Se algum rótulo mudar um pouco, o caminho continua o mesmo.

---

## 0. O que vem no kit

| Peça | Onde | Para quê |
|---|---|---|
| Gerador | `scripts/demo/gerar_carga_demo.py` | Cria as carteiras "Cartões" e "Veículos" (2.000 clientes no padrão) com histórico de cerca de 4 meses |
| Layout fixo | `empresas/demo-assessoria-exemplo.json` | Com ele, o motor lê os arquivos da empresa demo sem esperar o mapeamento no site (vale quando estiver no `main`) |
| Teste | `tests/test_kit_demo.py` | Prova que os arquivos passam pelo caminho do próprio motor e que não há CPF válido nem telefone fora da faixa fictícia |
| Este roteiro | `docs/demo/LEIA_DEMO.md` | Passo a passo |

**Por que os dados são fictícios**

| Dado | Como é gerado | Por que não pode ser de alguém |
|---|---|---|
| Nome | `Cliente Demo 0001`, `Cliente Demo 0002`… | Nome claramente de teste |
| CPF | `000.NNN.NNN-DV`, com o **1º dígito verificador errado de propósito** | Nenhum CPF real tem DV inválido. O motor aceita a linha porque o CPF é opcional: ele só não agrupa IDs pelo CPF |
| Celular | `(DDD) 90000-NNNN` | Faixa 9 0000 fora de uso; DDD real só para UF, horário e persona |
| Fixo | `(DDD) 0000-NNNN` | Número local não começa com 0 no Brasil |
| E-mail | `cliente.demo.NNNN@exemplo.invalid` | `.invalid` é reservado (RFC 2606) e nunca entrega |
| Códigos | `CRT00001` (Cartões), `VEI00001` (Veículos), contratos `CT-…`, acordos `AC-…` | Gerados pelo script |

---

## 1. Antes de começar (5 minutos)

- [ ] Você entra no site com o seu usuário da equipe MotorCX (Master/Admin), com a verificação em duas etapas ligada.
- [ ] Você tem um e-mail que controla para ser o Admin da demo (por exemplo, um alias do seu e-mail). Não use e-mail
      de prospect nem de cliente.
- [ ] Python 3.11 ou mais novo no seu Mac (`python3 --version`).
- [ ] Repositório atualizado: `git pull`. Se quiser o caminho mais rápido, sem mapeamento manual (passo 7A), o branch
      `claude/kit-demo` precisa estar no `main` antes, porque o servidor lê os layouts do `main`.

---

## 2. Criar a empresa demo no Console

1. **Console › Empresas › Nova empresa.**
2. Seção **Empresa**:
   - **Nome fantasia:** `Demo · Assessoria Exemplo`. Use exatamente esse nome: o site gera o identificador
     `demo-assessoria-exemplo`, que é o nome do layout fixo. Com outro nome tudo funciona, mas você faz o mapeamento
     manual do passo 7B.
   - **Razão social:** `Demo Assessoria Exemplo (fictícia)`.
   - **CNPJ:** deixe em branco.
   - **Segmento:** qualquer um (por exemplo, assessoria de cobrança).
   - **Nome do Admin / E-mail do Admin:** você, com o e-mail que você controla. O convite chega nesse e-mail e a senha
     é criada por você no link do convite. Não anote a senha em lugar nenhum deste kit.
3. **Motor contratado:** só **Cobrança** (MotorCob).
4. **Módulos:**
   - **Orquestração:** ligada (o site exige para o motor de Cobrança).
   - **Mensageria:** **desligada**. Se quiser mostrar a Mensageria, veja o passo 5.
   - **API:** desligada.
   - **Enriquecimento:** desligado. O retorno do bureau do kit é um arquivo fictício que você envia à mão.
5. **Preços:** preencha os preços de tabela. A empresa demo não terá fatura emitida (próximo item).
6. **Ciclo de uso:** Mensal.
7. **Cobrança:** **Pós-pago**, qualquer forma de pagamento e **Emissão da fatura: "Revisar antes (a equipe emite)"**.
   Nunca marque "Automática no fim do ciclo". Nunca use Pré-pago com recarga automática no cartão.
8. Salve. A empresa nasce **Em implantação**.

> A fatura da demo pode aparecer como **rascunho** em Console › Faturamento, porque o motor mede os contratos.
> Rascunho não é enviado a ninguém. Não emita.

---

## 3. Criar as carteiras

Com a empresa demo escolhida no topo:

1. **Carteiras › Nova carteira**
   - Nome `Cartões`, código `cartoes`, **Como a carga chega: Arquivo**.
   - Nome `Veículos`, código `veiculos`, **Como a carga chega: Arquivo**.
2. Deixe **Em cobrança** ligado nas duas.
3. Estratégia padrão: a padrão da empresa (Playbook) serve. Se quiser mostrar segmentos e estratégias, crie depois
   da primeira rotina, na Orquestração.

## 4. Criar usuários (opcional)

**Empresa › Pessoas e perfis:** convide quem vai ajudar na demo, sempre com e-mails da sua equipe, nos perfis
Planejamento, Operação ou Gestão. Cada pessoa cria a própria senha pelo link do convite. Nenhuma senha vai para
documento, planilha ou mensagem.

---

## 5. Canais sem envio real (confira antes de enviar qualquer arquivo)

O motor **não envia nada**: ele gera a Lista do dia (quem acionar, por qual canal e número) e para por aí. Mensagem
só sai pela **Mensageria**, e só em modo real. Por isso:

- [ ] **Mensageria desligada** em Empresa › Contratação › Módulos. Sem o módulo, nenhum lote é criado
      (`nuvem/mensageria.py`, `criar_lotes`).
- [ ] Se for mostrar a Mensageria, ligue o módulo **só em simulação**:
  - o modo nasce **simulado** (`mensageria_config.modo = 'simulado'`). Nesse modo o "Simulador" responde sem chamar
    fornecedor nenhum e nada entra na fatura;
  - mantenha **aprovação de lotes** ligada (padrão);
  - **nunca** clique em **"Ligar envio real"** (Console › Implantação, Console › Atendimento ou Console › Empresa ›
    Mensageria) para a empresa demo;
  - não ligue plano de rota nem fornecedor à demo.
- [ ] **API desligada** e nenhum token criado para a demo. Assim nenhum sistema externo puxa a Lista do dia.
- [ ] **Canais** (menu Canais): pode deixar como está. Lá ficam só janela, custo e limites; nenhum fornecedor é
      contratado por essa tela.
- [ ] Relatórios por e-mail só para endereços seus.

Mesmo se algo acima falhar, os destinos são fictícios: `90000-NNNN`, `0000-NNNN` e `@exemplo.invalid`.

---

## 6. Gerar os arquivos

Na raiz do repositório, no seu Mac:

```bash
python3 scripts/demo/gerar_carga_demo.py
```

- Saída em `./demo_saida/` (já ignorada pelo Git). Para outra pasta: `--saida ~/Desktop/demo_motorcx`.
- Opções: `--clientes 3000` (total nas duas carteiras, 20 a 20.000), `--seed 7` (mesma seed e mesma data geram os
  mesmos arquivos), `--hoje 2026-11-03` (se for gerar num dia e enviar em outro, use o dia do envio),
  `--dias-historico 120` e `--sobrescrever` (troca uma carga demo anterior).
- Gere **no dia em que vai enviar**: o histórico termina na véspera de `--hoje`.
- O script imprime o `LEIA_ARQUIVOS.txt` com as contagens e a ordem dos envios.

```
demo_saida/
  cartoes/1_carga_geral/          → cartão "Carga geral"
  cartoes/2_carga_incremental/    → "Carga incremental"
  cartoes/3_ocorrencia/           → "Ocorrência"
  cartoes/4_acordo/               → "Acordo"
  cartoes/5_baixa_pagamento/      → "Baixa / pagamento"
  cartoes/6_retirada/             → "Retirada"
  veiculos/…                      → o mesmo, na carteira Veículos
  7_atualizacao_contatos_bureau/  → "Atualização de contatos (bureau)" (sem carteira)
  LEIA_ARQUIVOS.txt
```

Com 2.000 clientes (padrão): 1.100 em Cartões e 900 em Veículos e, conforme a data, algo como 40 a 45 mil
registros de ocorrência, 250 acordos, 75 quitações e algumas retiradas.

---

## 7. Enviar os arquivos (menu **Cargas**, tela "Enviar arquivos")

A rotina roda sozinha poucos segundos depois de cada envio. Por isso a ordem importa:

**Passo 1, cargas.** Para cada carteira (escolha a carteira certa no envio):
1. `1_carga_geral/…csv` no cartão **Carga geral**;
2. `2_carga_incremental/…csv` no cartão **Carga incremental**.

Espere os envios ficarem **processados** (1 a 3 minutos). Na primeira rodada o motor monta a carteira e refaz o
histórico desde a data de entrada dos clientes.

**Passo 2, o resto.** Para cada carteira:
3. `3_ocorrencia` em **Ocorrência**;
4. `4_acordo` em **Acordo**;
5. `5_baixa_pagamento` em **Baixa / pagamento**;
6. `6_retirada` em **Retirada**.

**Passo 3.** `7_atualizacao_contatos_bureau` em **Atualização de contatos (bureau)**, uma vez só (vale para as duas
carteiras; em cada carteira parte das linhas aparece como "sem cliente", porque o cliente é da outra).

### 7A. Com o layout fixo (empresa `demo-assessoria-exemplo` e o kit no `main`)

Nada fica "aguardando": o arquivo `empresas/demo-assessoria-exemplo.json` já diz como ler cada arquivo e o que é cada
código de ocorrência. Siga para o passo 8.

### 7B. Sem o layout fixo (kit fora do `main` ou outro nome de empresa)

A carga geral é reconhecida sozinha (layout automático). Ocorrência, acordo e pagamento ficam **aguardando o
mapeamento**, como em qualquer cliente novo. O MotorCX já deixa a sugestão pronta:

1. **Carteiras › Cartões › Configurações › Arquivos:** confira e clique em **Confirmar colunas** em cada arquivo.

   | Arquivo | Campo | Coluna |
   |---|---|---|
   | Ocorrência | Cliente · Data da ação · Resultado · Canal | `COD_CLIENTE` · `DT_ACAO` · `OCORRENCIA` · `CANAL` |
   | Acordo | Cliente · Número do acordo · Parcela · Vencimento · Valor da parcela | `COD_CLIENTE` · `NUM_ACORDO` · `PARCELA` · `VENCIMENTO` · `VALOR` |
   | Pagamento | Cliente · Contrato · Número do acordo · Parcela · Data do pagamento · Valor pago · Tipo | `COD_CLIENTE` · `CONTRATO` · `NUM_ACORDO` · `PARCELA` · `DT_PAGAMENTO` · `VALOR_PAGO` · `TIPO` |

2. **Configurações › Ocorrências:** marque os resultados (pode usar "Aceitar as sugestões dos novos" e depois
   conferir com esta tabela):

   | Código | Marca |
   |---|---|
   | `CPC`, `PROMESSA DE PAGAMENTO`, `RECUSA` | CPC |
   | `TERCEIRO` | Número errado / de outra pessoa |
   | `OPT OUT` | Não contatar (opt-out) |
   | `NAO ATENDE`, `CAIXA POSTAL`, `ENTREGUE SEM RESPOSTA`, `NUMERO INVALIDO` | Sem contato (sem marca) |

   Deixe `NUMERO INVALIDO` como **Sem contato**. Se marcar como "número errado", o freio do WhatsApp liga (bloqueio
   mais pessoa errada acima de 2%) e o WhatsApp some da Lista do dia.
3. Em **Veículos › Configurações**, use **Copiar de outra carteira** (origem: Cartões).
4. Ao confirmar, a rotina relê tudo sozinha. Se quiser, clique em **Reenquadrar agora** (passo 8).

---

## 8. Rodar ou reenquadrar

- A rotina roda sozinha depois de cada envio e todo dia a partir das 06:00, inclusive no fim de semana.
- **Reenquadrar agora** (botão na **Lista do dia** e na **Orquestração**) refaz a lista da carteira em 1 a 3
  minutos.
- **Propensão a pagamento:** o modelo treina na primeira rotina (ainda sem pagamentos, aparece **Coletando**) e de
  novo **todo domingo** ou depois de 7 dias. Na primeira rotina de domingo depois do envio, as faixas **A–E**
  aparecem. Se enviar num sábado, no domingo ela já está pronta.
  - Nas primeiras semanas, quem o histórico refeito mostrava em localização é separado por atraso e saldo. Quem já
    teve CPC fica perto da média da carteira até o modelo ver um mês de histórico real da situação "CPC". Diga isso
    ao prospect, se perguntar: é o comportamento certo de um modelo sem vazamento.
- **Lista do dia:** sai em dia útil e no sábado. **Domingo e feriado** (por exemplo, 02/11) não têm ação, e a tela
  mostra a previsão dos próximos dias.

---

## 9. O que mostrar, tela a tela

Escolha a empresa **Demo · Assessoria Exemplo** e a carteira no topo.

1. **Início:** visão do dia da carteira.
2. **Cargas (Enviar arquivos):** abra o relatório de um envio: clientes em cobrança, linhas aceitas, acordos
   abertos, parcelas pagas, contatos novos do bureau. Mostre que a empresa manda o arquivo do jeito dela e o MotorCX
   reconhece as colunas.
3. **Lista do dia:** quem acionar hoje, por canal e número, com o motivo de cada um. Mostre a separação por estágio
   (localização, CPC, preventivo, quebra) e o **Reenquadrar agora**.
4. **Clientes:** busque `CRT00001` ou `VEI00001`. Mostre a TAG (safra, cluster, estado, canal, ciclo), a trilha com
   "quem marcou" e o enquadramento (estratégia, persona, ação de hoje). Não há CPF nem telefone completo na tela.
5. **Personas:** as personas aprendidas (com a carga padrão, por exemplo: faixa de idade; em Veículos, idade e
   WhatsApp), o ranking
   de canais por CPC por real, a maturidade (Coletando, Prévia, Definida) e a **Matriz** (Acelerar, Descobrir
   rápido, Manter barato, Economizar). Com Propensão treinada, as faixas A–E por persona.
6. **Orquestração:** estratégia padrão, segmentos e esteira. Uma boa demo: crie um segmento "Veículos pesados"
   (`PRODUTO = PESADO`), dê a ele uma esteira com discador antes e clique em Reenquadrar.
7. **Mapa da esteira** e **Painel:** distribuição por estado (LOC, CPA, CPB, COL, PRE, QBR, LIQ).
8. **Discagem:** mailing do discador, horários por UF (prévia, desligada por padrão) e chamadas curtas.
9. **Ações:** tentativas e CPC por régua × canal.
10. **Comitê:** relatório do mês (Real x Previsto, KPIs por safra e cluster).

**Não abra na frente do prospect:** Console (outras empresas aparecem lá), Faturamento e Margem.

---

## 10. Depois da demo: pausar, refazer ou apagar

- **Pausar:** Console › Empresas › Demo › **Suspender** (motivo: "demo"). A rotina e os envios param e os usuários
  continuam entrando. **Reativar** volta.
- **Encerrar:** Console › Empresas › Demo › **Encerrar** (motivo: "demo encerrada"). A empresa sai da rotina, da
  Saúde e da emissão de faturas.
- **Excluir:** "Excluir empresa de teste" só funciona em empresa **sem nenhum histórico**. Depois do primeiro
  arquivo, o site recusa ("tem arquivos enviados") e o caminho é **Encerrar**. Apagar de vez exige a equipe técnica
  (banco e a pasta `~/MotorCob-dados/empresas/demo-assessoria-exemplo/` no servidor). Ver as recomendações abaixo.
- **Refazer com dados novos:** carteira não se apaga ("Em cobrança" desligado). Para uma demo do zero:
  1. desligue **Em cobrança** em Cartões e Veículos;
  2. crie carteiras novas (por exemplo, `Cartões 2`, código `cartoes-2`, e `Veículos 2`, código `veiculos-2`);
  3. gere de novo com `--sobrescrever` e envie como no passo 7.

  Uma empresa demo nova também serve, mas o site dá a ela o identificador `demo-assessoria-exemplo-2`, que não tem
  layout fixo (use o passo 7B).
- **Para a demo seguir "viva" nos próximos dias**, não faça nada: a rotina das 06:00 anda a esteira sozinha.
- Apague a pasta `demo_saida/` do Mac quando não precisar mais dela: `rm -rf demo_saida`.

---

## 11. Renomear a empresa "MotorCob" (Console › Empresas)

Se existir uma linha chamada **MotorCob** em Console › Empresas (por exemplo, uma empresa interna ou de testes; a
equipe MotorCX em si não é uma empresa, é o perfil "equipe"):

1. **Console › Empresas**, busque "MotorCob" e clique na linha. Abre **Empresa › Visão geral** dessa empresa.
2. Clique em **Editar empresa**.
3. Troque **Nome fantasia** (e, se for o caso, **Razão social**) para o novo nome, por exemplo `MotorCX`.
4. **Salvar.**

O identificador (slug) **não muda** quando você troca o nome. As pastas no servidor, o Storage
(`entradas/<slug>`, `saidas/<slug>`) e `empresas/<slug>.json` continuam valendo. Não tente trocar o slug pelo
site.

---

## 12. Por que nada sai de verdade

| Risco | O que impede |
|---|---|
| SMS, e-mail ou RCS saírem pela Mensageria | Módulo desligado, então nenhum lote é criado. Com o módulo ligado, o modo é **simulado** (padrão do banco): o Simulador responde sem chamar fornecedor. O modo real só liga pelo botão "Ligar envio real" da equipe e só funciona com a credencial do fornecedor no servidor. |
| WhatsApp ou discador | O MotorCX não disca nem manda WhatsApp: ele publica a lista. Sem API e sem token, ninguém de fora puxa a lista. |
| Lista do dia ir parar num fornecedor | Ninguém sobe o `ids/<canal>.csv` da demo num fornecedor. Mesmo que suba, os destinos são `90000-NNNN`, `0000-NNNN` e `@exemplo.invalid`. |
| Fatura ou cobrança da demo | Pós-pago com "Revisar antes": o rascunho fica parado até alguém emitir. Sem cartão e sem recarga automática. |
| E-mails do sistema | Convites e avisos vão só para os usuários da demo, que são e-mails seus. |
| Dado pessoal real | Nome, CPF (DV inválido), telefone, e-mail e códigos são gerados pelo script. O teste `tests/test_kit_demo.py` falha se aparecer CPF válido ou telefone fora da faixa. |

---

## 13. Recomendações (sem mudança no banco agora)

Nada disto foi feito: são sugestões para a equipe técnica decidir.

1. **Marca de empresa demo** (`empresas.demo boolean`): o motor e a Mensageria recusariam o modo real, o faturamento
   pularia a empresa e o Console mostraria uma etiqueta "DEMO". Hoje a proteção depende de configuração (módulo
   desligado e modo simulado).
2. **Exclusão completa de empresa demo**: uma função que apague banco, Storage e a pasta no servidor de uma empresa
   marcada como demo, para refazer a demo do zero sem a equipe técnica.
3. **Bloqueio de CPF válido na empresa demo**: com a marca do item 1, o motor poderia recusar carga com CPF de DV
   válido. Isso impediria subir base real por engano.
4. **Upload em lote**: um envio com vários arquivos de uma vez (cargas, ocorrência, acordo e pagamento) entraria
   numa rotina só. Isso deixaria o histórico refeito e a Propensão completos já no primeiro dia.
