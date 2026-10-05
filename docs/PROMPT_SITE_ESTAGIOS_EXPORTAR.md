# Prompt do site: Lista do dia por estratégia × estágio × canal, alertas recolhíveis e exportar estratégia

Não precisa de SQL. Precisa do motor atualizado no Mac (`git pull`) e de uma rotina nova
("Reenquadrar agora") para a lista do dia ganhar as pastas por estágio.

---

```text
Três ajustes. NÃO crie, altere ou apague tabelas, views, buckets ou políticas.

## 1. Lista do dia: estratégia → estágio → canal (nada junto)
A rotina grava no Storage (bucket "saidas"), em {slug}/{data}/{codigo do credor}/ids/estrategias/:
- indice.json: lista de estratégias; cada uma tem "estagios":
  [{"pasta": "7-negociacao", "estrategia": "Negociação", "clientes": 812,
    "estagios": [
      {"estagio": "localizacao", "rotulo": "Cliente novo · ainda não deu CPC",
       "pasta": "7-negociacao/1-cliente-novo", "clientes": 640,
       "canais": {"whatsapp": 600, "sms": 40}, "reserva": {"discador": 12},
       "passos": {"D+1": 500, "D+3": 140}},
      {"estagio": "cpa", "rotulo": "CPC A · negociação", "pasta": "7-negociacao/2-cpc-a", ...}]}]
  Estágios possíveis, nesta ordem: localizacao (Cliente novo), cpa (CPC A), cpb (CPC B),
  giro (Não CPC), preventivo (Acordo · preventivo), quebra (Acordo · quebra).
- arquivos de cada estágio: {pasta do estágio}/{canal}.csv e {canal}_reserva.csv.
Na página Lista do dia, para cada estratégia (bloco recolhível com nome e nº de clientes):
- dentro dela, UM SUB-BLOCO POR ESTÁGIO, com o rótulo do estágio, o nº de clientes e os passos do
  dia como chips ("D+1 · 500", "D+3 · 140");
- dentro do estágio, os cartões de canal (mesmo visual de hoje) com "Baixar lista" →
  {pasta do estágio}/{canal}.csv e, se houver, o link "reserva (n)" → {canal}_reserva.csv. Nome do
  arquivo baixado: "{data}_{estrategia}_{estagio}_{canal}.csv" (sem acento e espaço);
- botão "Baixar estágio (.zip)" em cada estágio e "Baixar estratégia (.zip)" em cada estratégia
  (dentro do zip, uma pasta por estágio com os canais);
- no topo, "Baixar todas (.zip)": pastas estratégia/estágio/canal.csv;
- filtros no topo: chips de estratégia e chips de estágio (todos marcados).
NUNCA junte canais de estágios ou estratégias diferentes num mesmo arquivo ou cartão.
Se o indice.json do dia não tiver "estagios" (rotina antiga), mostre os cartões por estratégia como
hoje e a nota cinza "Rode 'Reenquadrar agora' para separar por estágio". Sem indice.json: tela antiga
com a nota "Lista anterior à separação por estratégia" e o mesmo convite para reenquadrar.

## 2. Início: alertas recolhíveis
O bloco de ALERTAS da página inicial ganha cabeçalho "Alertas ({n})" com o botão "Expandir /
Recolher" (ícone chevron). Recolhido (padrão): mostra só os 2 primeiros alertas, cada um cortado
em 1 linha com reticências, e "+{n-2} alertas". Expandido: todos, com o texto inteiro. Alertas que
começam com "BANCO:", "MAPEAMENTO:" ou "OCORRÊNCIAS PARA MARCAR" vêm primeiro e em âmbar. Guarde a
escolha (expandido/recolhido) no localStorage do navegador.

## 3. Exportar a estratégia desenhada (PDF, JPG, PPT)
Na Orquestração (cartão "Estratégia") e na página da estratégia, botão "Exportar" com três opções:
"PDF", "Imagem (JPG)" e "PowerPoint (PPT)". Tudo gerado no navegador (bibliotecas npm:
html-to-image para imagem, jspdf para PDF, pptxgenjs para PowerPoint); nada é gravado no banco.
Conteúdo — uma "ficha da estratégia" própria para impressão (não um print da tela de edição),
fundo branco, cores do MotorCob:
- capa/cabeçalho: nome da estratégia, empresa, credor, segmentos que usam a estratégia
  (segmentos_em_uso), data de exportação e "Gerado pelo MotorCob";
- uma seção por faixa (Cliente novo, Não CPC, Clientes em acordo — preventivo e quebra): tabela
  com as colunas = dias (D+1, D+3… ou D-5…D0 no preventivo) e as linhas = raias (Público geral e
  cada persona com raia), cada célula com as fichas de canal e o modo (sempre / senão / junto /
  reserva); "Vira Não CPC no dia N", ciclo e quantidade de ciclos do Não CPC;
- seção "Deu CPC": ordem dos canais, tentativas por canal, "CPC A a cada N dias", "CPC B a cada M
  dias";
- prioridade dos telefones, travas que valem sempre e o calendário de exportação da estratégia
  (dias da semana; se segue o padrão do credor);
- resumo "Como vai funcionar" (o mesmo texto da tela).
Formatos:
- PDF: A4 paisagem, uma faixa por página (quebra se a tabela não couber), rodapé com página X/Y;
- JPG: uma imagem com a ficha inteira (escala 2x, nítida);
- PPT: slide 1 capa; um slide por faixa (tabela editável, não imagem); um slide "Deu CPC e
  acordo"; um slide "Regras e calendário".
Nome do arquivo: "estrategia_{nome}_{credor}_{data}.pdf|jpg|pptx". Mostre "Gerando…" no botão
enquanto exporta.
```
