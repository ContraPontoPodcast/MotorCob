# Prompt Horizons — 86: aviso de clientes sem estágio (Lista do dia e Início)

UX, 28/10/2026. Rode depois do 85. A parte 1 é só tela. A parte 2 depende do SQL "sem_estagio no
para_hoje" (ver 00_LEIA.md); sem ele, aplique só a parte 1.

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Não mude consultas além das descritas. Nada de CPF
ou nome de devedor.

## 1. Lista do dia (/fila) — motivo "Sem estágio"
A tela lê motivos_hoje (motivo, clientes) por carteira e agrupa por categoria. Sem mudar a consulta:
- Os motivos que começam por "sem ação: sem estágio" (texto novo do motor) e, enquanto houver, pelos antigos
  "sem ação: a fase do cliente" e "sem ação: acordo quebrado, mas a quebra" passam a aparecer somados numa linha só, com o título "Sem estágio" e a explicação "não se
  encaixam em nenhum estágio do segmento (estágio desligado ou sem estágio para a situação deles)".
- Continua na mesma categoria de hoje (a régua segurou) e entra na contagem de quem ficou de fora.
- Botão "Resolver" na linha (só para quem edita a Orquestração): abre /orquestracao?carteira=<carteira da
  lista>&passo=estagios.

## 2. Início — item em "Para hoje" (depois do SQL)
O rpc para_hoje passa a devolver itens do tipo 'sem_estagio' com título "N clientes sem estágio em
<carteira> · <segmento> — ficam sem ação", ação "Resolver" e link
/orquestracao?carteira=<id>&segmento=<id>&passo=estagios. O cartão "Para hoje" já desenha os itens do rpc:
garanta só que o tipo 'sem_estagio' usa o ícone de aviso âmbar e que o link abre o passo Estágios daquele
segmento (prompt 83 lê carteira, segmento e passo da URL).

Aceite: na Lista do dia, os motivos de fase desligada aparecem como "Sem estágio" com o total certo e o
"Resolver" leva aos Estágios da carteira; com o SQL aplicado, o Início mostra o item com carteira e
segmento, e "Resolver" abre o passo Estágios daquele segmento. 1440 e 390 px, claro e escuro.
```
