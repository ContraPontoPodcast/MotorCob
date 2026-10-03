# Prompt de ajuste do site: o mesmo canal não se repete no mesmo dia

Não precisa de SQL. O motor já descarta a repetição (fica a 1ª) e avisa no alerta "CLUSTER:
esteira 'X': partes ignoradas — … repetido no mesmo dia".

---

```text
No Desenho da Esteira (Orquestração), o MESMO CANAL não pode aparecer duas vezes no MESMO DIA
para o MESMO PÚBLICO (a raia do público geral ou a raia de uma persona). NÃO crie, altere ou
apague tabelas, views, buckets ou políticas.

1. Ao soltar (ou escolher) um canal numa célula de dia/raia que já tem esse canal — em qualquer
   modo: sempre, senão, junto ou reserva —, não adicione: destaque por 1 s a ficha que já está
   lá e mostre o toast "WhatsApp já está no D+1 desta raia".
2. Na barra de canais, enquanto arrasta, as fichas dos canais que já estão naquela célula
   ficam esmaecidas (não podem ser soltas ali).
3. O mesmo canal em raias diferentes do mesmo dia (público geral e uma persona, ou duas
   personas) continua permitido.
4. Ao abrir uma esteira antiga que já tenha repetição, mostre na célula o aviso âmbar
   "Canal repetido: só o 1º vale" e, ao salvar, grave sem as repetições.
```
