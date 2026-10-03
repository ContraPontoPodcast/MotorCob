# Prompt de ajuste do site: editor visual da estratégia (Desenho da Esteira)

Troca o formulário da estratégia, na página Orquestração, por uma esteira visual: uma
linha do tempo por momento do cliente, canais arrastados para os dias e frases que
explicam o que vai acontecer. Protótipo de referência:
https://claude.ai/artifact/78yByBSNdMkiDnDtwdFDDo. Não precisa de migração.

---

```text
Na página Orquestração, troque o editor da estratégia (lado direito, depois de "Quem
entra") por um editor visual chamado "Desenho da Esteira". NÃO altere o banco: ele lê e
grava o mesmo campo estrategias.definicao (jsonb) de antes. Admin e planejamento editam;
os demais só veem (sem arrastar, sem botões).

## Barra de canais (fixa no topo do editor ao rolar)
6 chips coloridos: WhatsApp (whatsapp, verde #1F8A4C), RCS (rcs, azul #3B5BA9),
SMS (sms, roxo #7A4FB0), E-mail (email, terracota #A2552B), Agente virtual
(agente_voz, petróleo #0E7C86), Discador (discador, cinza-azulado #475569).
Duas formas de colocar um canal num dia: arrastar o chip até o dia (computador) ou tocar
no chip (fica com borda âmbar, aviso "Agora toque no dia…") e depois tocar no dia
(celular).

## Faixa 1 — "Cliente novo · ainda não deu CPC" → definicao.localizacao
- Texto: "O dia em que o cliente chega na carga é o D+1: a primeira ação sai no mesmo dia.
  A cada passagem o MotorCob usa o próximo telefone (1, 2, 3, 4…), até alguém dar CPC."
- Ajuste com botões − / +: "Vira Não CPC no dia" (2 a 30, padrão 8) →
  localizacao.dias_sem_contato_para_ncp.
- Linha do tempo com rolagem horizontal: uma coluna por dia, de D+1 até o dia anterior
  ao "vira Não CPC"; a última coluna, âmbar, mostra "D+N · sem CPC → Não CPC".
- Coluna vazia: borda tracejada e "solte um canal aqui". Ao soltar, o chip aparece na
  coluna. O 1º canal do dia é o principal; cada canal seguinte ganha acima dele um botão
  pequeno que alterna, a cada clique, entre "senão" (só vai se o de cima não tiver
  contato), "+ junto" (vai junto com o de cima) e "reserva" (se o de cima não atender
  no dia). Cada chip tem × para tirar; a coluna tem ⟲ para limpar o dia. Não deixe o
  mesmo canal duas vezes no mesmo dia (aviso "X já está no dia N").
- Grava em localizacao.passos: {"1": [{"canal":"whatsapp","modo":"sempre"}],
  "3": [{"canal":"rcs","modo":"sempre"},{"canal":"sms","modo":"senao"},
  {"canal":"email","modo":"junto"}], …}. O 1º de cada dia tem modo "sempre"; os
  seguintes "senao", "junto" ou "reserva". Dias sem canal não são gravados.

## Faixa 2 — "Deu CPC · CPC A e CPC B" → definicao.cpc
- Texto: "O primeiro é sempre o canal em que o cliente deu CPC, no telefone Hot. Se ele
  parar de responder, o MotorCob segue a ordem de reserva abaixo."
- Uma fila horizontal: primeiro um chip fixo âmbar "★ Canal do CPC · telefone Hot" (não
  sai nem move), depois os canais de reserva com setas ‹ › para mudar a ordem e ×, e no
  fim um alvo "solte um canal aqui".
- Ajuste − / +: "Tentativas em cada canal antes de trocar" (1 a 6, padrão 3).
- Grava cpc.ordem = [{"canal":"whatsapp"}, …] na ordem da fila (sem o chip fixo) e
  cpc.tentativas_por_canal.

## Faixa 3 — "Não CPC · ciclo que se repete" → definicao.giro
- Texto: "Quem passou do prazo sem CPC entra num ciclo. Ao fim dos ciclos, o cliente
  espera um novo enriquecimento."
- Ajustes: "Ciclo de N dias" (2 a 15, padrão 8) → giro.ciclo_dias; "repetido N vezes"
  (1 a 6, padrão 3) → giro.max_ciclos.
- Linha do tempo "dia 1 … dia N" igual à Faixa 1 e, no fim, a coluna âmbar
  "↻ × N · repete o ciclo; depois aguarda enriquecimento". Grava giro.passos igual à
  Faixa 1.

## Preventivo e Quebra (clientes em acordo)
Abaixo das 3 faixas, um bloco recolhido "Clientes em acordo (preventivo e quebra)" com
as mesmas linhas do tempo (preventivo: D-3, D-1, D0; quebra: D+1…D+5) gravando em
definicao.preventivo.passos e definicao.quebra.passos. Fechado por padrão.

## "Como vai funcionar"
Cartão ao lado (embaixo no celular) que reescreve a estratégia em frases a cada mudança:
1. "Cliente novo: D+1 WhatsApp; D+3 RCS senão SMS junto com E-mail; D+5 Agente virtual
   e, se não atender, Discador."
2. "Sem CPC até o D+8, o cliente vira Não CPC."
3. "Deu CPC: o próximo contato vai no mesmo canal e no telefone Hot. Depois de 3
   tentativas sem resposta, troca na ordem WhatsApp → RCS → Agente virtual."
4. "Não CPC: ciclo de 8 dias — dia 1 WhatsApp; dia 5 Agente virtual — repetido 3 vezes;
   depois espera novo enriquecimento."

## Botões
- "Salvar" (grava estrategias.definicao; toast "Estratégia salva · vale a partir da
  rotina de amanhã"). Ao sair com alterações não salvas, pergunte se quer salvar.
- "Começar do playbook MotorCob": preenche as faixas com 1 WhatsApp senão SMS; 3 RCS senão SMS
  junto E-mail; 5 Agente virtual reserva Discador; 7 SMS junto E-mail; Não CPC no 8;
  CPC: WhatsApp → RCS → Agente virtual → Discador → SMS, 3 tentativas; ciclo igual,
  8 dias, 3 vezes.
- Se a estratégia já tiver passos no formato antigo (lista de nomes de canal, ex.
  ["whatsapp"]), mostre cada nome como um chip principal ("sempre").
Nota fixa no rodapé: "Travas que valem sempre: contato inválido ou que não pertence ao
cliente nunca recebe; WhatsApp só em número confiável; horário, domingo e feriado; 48h
entre ações."
```
