# Prompt de ajuste do site: motivo do envio no Histórico (acordo, pagamento, ocorrência)

Não precisa de SQL novo. O motor já grava o motivo em `envios.relatorio` (jsonb).

---

```text
Na página Enviar arquivos, no "Histórico de envios", mostre o que o MotorCob fez com cada
arquivo, lendo envios.relatorio. NÃO crie, altere ou apague tabelas, views, buckets ou
políticas. O JSON bruto do relatório continua disponível como hoje (detalhe da linha).

## Linha com status "erro"
Logo abaixo do nome do arquivo, em vermelho (text-[#C62828], text-xs), o texto de
relatorio.erro, inteiro (pode quebrar linha). Ex.: "nenhum cliente do arquivo foi encontrado
na carga deste credor. A coluna do cliente precisa trazer o mesmo código da carga, o contrato
ou o CPF/CNPJ; confira também se o arquivo foi enviado no credor certo."

## Linha com status "processado" (tipos acordo, baixa, retirada)
Abaixo do nome, em cinza (text-xs text-slate-500):
"{linhas} linhas · clientes achados: {soma} (pelo código {codigo}, contrato {contrato},
CPF {cpf}, formatação {formatacao})" — use relatorio.identificacao (objeto com as chaves
codigo, contrato, cpf, formatacao, nao_encontrado, ambiguo; mostre só as que existirem).
Se identificacao.nao_encontrado > 0: acrescente em âmbar "· {n} não encontrados na carga".
Se identificacao.ambiguo > 0: acrescente em âmbar "· {n} com CPF em mais de um cadastro".

## Linha com status "processado" (tipo ocorrencia)
"{aceitas} de {linhas} linhas aproveitadas" e, se houver, em âmbar:
- relatorio.rejeitadas: "· {n} {motivo}" para cada motivo (no máximo 3, os maiores);
- relatorio.quarentena: "· resultado não reconhecido: 'X', 'Y'" (as chaves, no máximo 5).

## Texto de ajuda acima do histórico
"Acordo, pagamento e ocorrência acham o cliente pelo código da carga, pelo contrato ou pelo
CPF/CNPJ. A ocorrência entra na hora: o CPC aparece em até 1 minuto."
```
