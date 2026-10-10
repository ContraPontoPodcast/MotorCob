# Prompt do site — frase em cada dia da esteira (não mais por segmento)

Sem SQL: a frase fica dentro de cada ação do dia em `estrategias.definicao` (o motor já lê). Substitui a grade
"Mensagens" (estágio × canal) dos prompts anteriores. Cole no Hostinger Horizons e publique:

---

```text
No Desenho da Esteira (Orquestração), a frase de cada canal passa a ser definida EM CADA DIA, dentro da ação
daquele dia — cada dia pode ter uma frase diferente. Remova a seção "Mensagens" (grade estágio × canal) do fim
do editor. Não mude as outras gravações, tabelas, views ou políticas.

## 1. Onde a frase fica gravada
Cada ação de um dia (objeto em definicao.<fase>.passos["<dia>"], fases localizacao, giro, preventivo, quebra)
ganha o campo opcional "mensagem":
  - texto próprio:            "mensagem": "Olá, seu saldo é {saldo}"
  - frase do playbook:        "mensagem": {"frase_id": 12}
  - persona (Melhor canal da persona 1/2 — o canal só se define na rodada): um mapa por canal,
                              "mensagem": {"whatsapp": {"frase_id": 12}, "sms": "texto"}
No CPC (definicao.cpc.ordem e definicao.cpc.junto), cada canal ganha "mensagem" com frase única ou separada
por estágio: "mensagem": {"cpa": "texto para CPC A", "cpb": {"frase_id": 7}}.
Sem "mensagem" a ação sai sem frase (o arquivo do canal continua só com ID e contato).

## 2. Na grade dos dias
- Cada chip de canal no dia ganha um ícone de balão 💬 à direita: vazio (contorno cinza) = sem frase;
  preenchido (azul) = com frase; vermelho = frase do playbook desativada/apagada ("não sai no arquivo").
  Tooltip com o nome da frase ou o começo do texto.
- Clicar no balão abre o editor de frase (o mesmo de antes), com duas abas:
  · "Do playbook": frases ativas do canal (tabela frases), as do estágio da faixa primeiro, com busca e prévia;
  · "Escrever": texto próprio, botões de variáveis {saldo} {dias_atraso} {vencimento} {valor_parcela}
    {qtd_parcelas_abertas}, contador de 160 no SMS, prévia com valores de exemplo, e "Salvar no playbook".
  Botões: "Copiar para…" (outros dias da MESMA faixa e do MESMO canal, com checkboxes por dia), "Limpar".
- Persona (chip "Melhor canal persona 1/2"): o editor mostra uma aba por canal ligado na empresa; grava o mapa.
- CPC (ordem e junto): o editor tem a opção "Mesma frase para CPC A e CPC B" (padrão) ou duas abas CPC A / CPC B.

## 3. Bloco "Frases" em cada faixa — recolhe e expande
Dentro de cada faixa (Cliente novo, Deu CPC, Não CPC, Clientes em acordo), abaixo da grade dos dias, um bloco
"Frases desta faixa" com o MESMO padrão de recolher/expandir das faixas:
- Container rounded-xl border border-[#dfe8ea] bg-white; cabeçalho = <button type="button"> de largura total
  (flex w-full items-center justify-between px-5 py-4 text-left) com o título (text-sm font-bold
  text-[#163943]), um RESUMO de uma linha sempre visível (text-[11px] text-slate-500 truncate), ex.:
  "6 de 8 ações com frase · D+1 WhatsApp 📖 Boas-vindas · D+3 SMS ✎ · D+5 RCS sem frase", e à direita a seta
  (chevron) que gira 180° quando aberto. aria-expanded no botão; Enter/Espaço alternam.
- Aberto (border-t border-[#ecf0f1] p-5): uma tabela Dia · Canal · Frase (nome do playbook com 📖 ou começo do
  texto com ✎, ou "— sem frase") · ações Editar / Copiar para… / Limpar. Editar abre o mesmo editor do balão.
- Fechado por padrão. Ponto âmbar ao lado do título (mesmo fechado) se alguma frase da faixa estiver desativada
  ou apagada no playbook.
- Entra nos links "Expandir tudo" / "Recolher tudo" e na memória do navegador (localStorage, chave
  "motorcob.esteira.frases").

## 4. Frases antigas (por estágio)
Se a estratégia ainda tiver definicao.mensagens (grade antiga), mostre no topo da faixa um aviso âmbar:
"Esta estratégia tem frases por estágio (modelo antigo). Elas valem só onde o dia não tem frase." com o botão
"Levar para os dias": copia a frase de cada estágio × canal para todas as ações daquela faixa e canal que ainda
não têm "mensagem" (cpa/cpb vão para o CPC no formato {"cpa":…, "cpb":…}), apaga definicao.mensagens e salva.

## 5. Outros pontos
- "Como vai funcionar": em cada dia, depois do canal, "💬 <nome da frase>" quando houver.
- "Replicar de…": as frases vêm junto com os dias (estão dentro das ações).
- Página Canais › Frases: ao excluir uma frase, conte as estratégias que a usam procurando "frase_id": <id> em
  qualquer lugar de estrategias.definicao (dias, CPC e grade antiga).
```
