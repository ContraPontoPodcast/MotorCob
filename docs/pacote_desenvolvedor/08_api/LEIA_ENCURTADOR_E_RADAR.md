# Encurtador de links e Radar MotorCob: o que publicar

Faça depois do SQL 15. São três partes; cada uma funciona sozinha.

## 1. Função `l` (encurtador) no Supabase

1. Supabase › Edge Functions › **Deploy a new function** › **Via Editor** › nome **`l`** (só a letra L minúscula).
2. Apague o exemplo e cole o arquivo `MotorCob_funcao_l.ts` inteiro (um arquivo só, sem chave nenhuma dentro).
3. Em **Settings**, DESLIGUE **Verify JWT** (quem clica no link não tem login). **Deploy**.
4. Teste: abra `https://jxwppkrkuckfwmphqjva.supabase.co/functions/v1/l/Teste123`. Deve aparecer
   "Este link expirou." (o código não existe, então está tudo certo).

Pronto: os links das campanhas com "Rastrear links" já funcionam com esse endereço. Ele é longo (cerca de 60
caracteres), por isso o domínio curto abaixo é recomendado para SMS.

## 2. Domínio curto (opcional, recomendado para SMS)

"mcb.on" não existe (não há domínios terminados em .on). Opções curtas que existem: `mcb.one`, `mcob.io`,
`mcb.li`. Depois de escolher:

1. Compre o domínio (Hostinger, Registro.br para .com.br, ou o próprio Cloudflare).
2. Crie uma conta grátis no **Cloudflare**, adicione o domínio e troque os servidores DNS dele pelos dois que o
   Cloudflare mostrar (no painel de onde comprou).
3. No Cloudflare, em DNS, crie um registro **A** com nome `@`, valor `192.0.2.1` e **Proxied** (nuvem laranja).
   O endereço é só um marcador: quem responde é a regra do passo seguinte.
4. Em **Rules › Redirect Rules › Create rule**: quando *All incoming requests*; tipo **Dynamic**; expressão
   `concat("https://jxwppkrkuckfwmphqjva.supabase.co/functions/v1/l", http.request.uri.path)`; status **302**;
   desmarque "Preserve query string". Salve.
5. Teste `https://SEU-DOMINIO/Teste123`: deve aparecer "Este link expirou."
6. Diga ao motor qual é o domínio (Cloud Shell do Google Cloud):

```bash
gcloud compute instances add-metadata motorcob --zone=southamerica-east1-a --metadata=motorcob-link-dominio=SEU-DOMINIO
gcloud compute instances reset motorcob --zone=southamerica-east1-a
```

## 3. Chave da IA do Radar (opcional: sem ela, o Radar classifica pelas regras)

1. Em **platform.claude.com** (antigo console.anthropic.com), coloque crédito em Settings › Billing e crie uma chave de API para o MotorCob (Settings › API Keys). Não cole a chave
   em chat, e-mail ou no site.
2. No **Cloud Shell** do Google Cloud, rode e cole a chave quando o terminal pedir (ela não aparece na tela):

```bash
read -rs CHAVE && printf '%s' "$CHAVE" | gcloud secrets create motorcob-anthropic-key --data-file=- ; unset CHAVE
gcloud secrets add-iam-policy-binding motorcob-anthropic-key \
  --member="serviceAccount:motorcob-vm@$(gcloud config get-value project).iam.gserviceaccount.com" \
  --role=roles/secretmanager.secretAccessor
```

3. Atualize o script de início da máquina (ele passou a ler a chave e o domínio): no Cloud Shell, **⋮ › Fazer
   upload** › envie o `vm_inicio.sh` desta pasta e rode:

```bash
gcloud compute instances add-metadata motorcob --zone=southamerica-east1-a \
  --metadata-from-file=startup-script=vm_inicio.sh
gcloud compute instances reset motorcob --zone=southamerica-east1-a
```

Como funciona: as respostas de clientes em **envio real** são classificadas pela IA (Claude) em lotes de até 40,
com esforço baixo para custar pouco. Antes de sair do servidor, números (CPF, telefone, cartão) e e-mails viram
`[número]` e `[e-mail]`. Em simulação, o Radar usa as regras (sem custo). Se a IA falhar ou recusar, as regras
assumem na hora. O Radar pode ser desligado por empresa (`mensageria_config.radar`).
