# Prompt Horizons — 76: marca MotorCX no site público (motorcob.online) e no app autenticador

Rascunho do UX, 25/10/2026. Sai junto com o 75: o site é o primeiro contato do prospect. Resolve UX-02 (site público e
autenticador) e UX-19. O título e a descrição da `/` já dizem MotorCX; o texto visível ainda tem 9 "MotorCob".

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Não mude a estrutura, a ordem, as seções, o layout, as
imagens nem os formulários do site; só troque textos. Nada de CPF ou nome de devedor.

## 1. motorcob.online, página inicial (rota do site, "/")
Troque "MotorCob" por "MotorCX" em todo texto visível, rótulo de acessibilidade e texto alternativo, inclusive:
- logo do topo e aria-label "MotorCob — início" → "MotorCX — início";
- "O MotorCob usa seus agentes de IA para decidir…" → "O MotorCX usa seus agentes de IA para decidir…";
- "Como o MotorCob decide um cliente, antes do primeiro disparo do dia" → "Como o MotorCX decide…";
- "Dados fictícios. O MotorCob mostra só o ID do cliente…" → "… O MotorCX mostra só o ID do cliente…";
- "O MotorCob reconhece o layout." → "O MotorCX reconhece o layout.";
- "Suporte MotorCob" → "Suporte MotorCX"; "Plataforma MotorCob — slides" → "Plataforma MotorCX — slides";
- formulário de contato: "Concordo que o MotorCX use estes dados para retornar o meu contato.";
- rodapé: "© {ano atual} MotorCX" (use o ano da data, não 2026 fixo).
Título, descrição, og:title, og:description, twitter:title e twitter:description: mantenha "MotorCX · Pare de
adivinhar." e a descrição atual; confira que nenhum diz MotorCob. og:image e twitter:image: se a imagem de prévia
(og-motorcob.jpg) mostrar a marca antiga, aponte para a nova imagem que o dono subir (og-motorcx.jpg, mesmo bucket
"site"); até lá, não mude.
Páginas públicas ligadas à "/" (Privacidade, Documentação, Entrar): mesma regra no texto visível e no título
("Privacidade · MotorCX"). Não mude códigos, ids, nomes de arquivo nem links.

## 2. Rodapé das áreas logadas
"© {ano} MotorCX · Gestão de contatos" → "© {ano} MotorCX · Cobrança e experiência do cliente".

## 3. motorcli.online
Fica como está (marca MotorCli, textos e layout). Só os títulos: nenhum título, og:title ou twitter:title pode dizer
"MotorCob"; onde disser, use "MotorCX". "MotorCli · Jornada do Cliente, uma frente do MotorCX" continua.

## 4. App autenticador (verificação em duas etapas) — SÓ SE O DONO APROVAR
Quem já cadastrou continua vendo o nome antigo no aplicativo até cadastrar de novo; o código continua valendo.
4.1 Na preparação do autenticador (duasEtapasLogica, chamada auth.mfa.enroll): passe issuer: 'MotorCX' e troque o
    friendlyName de "MotorCob {data}" para "MotorCX {data}". Texto alternativo do QR: "QR do autenticador MotorCX".
4.2 Textos da tela de duas etapas: "fale com o suporte MotorCob" → "fale com o Suporte MotorCX"; "em Usuários ›
    Resetar duas etapas" → "em Empresa › Pessoas e perfis › Gerenciar › Redefinir duas etapas".
4.3 Aviso para quem já cadastrou (escolha do dono, uma das duas):
    a) Na tela (sem banco): em Minha conta › Segurança, para quem tem fator TOTP verificado criado antes da data
       desta publicação (auth.mfa.listFactors, campo created_at), uma faixa informativa: "No seu aplicativo
       autenticador, esta conta pode aparecer como MotorCob. Funciona igual. Para ver MotorCX, desligue e ligue de
       novo a verificação." + "Entendi" (some e guarda em localStorage mc-aviso-autenticador).
    b) No sino: precisa de uma linha nova na tabela de avisos (fica para um SQL à parte, não neste prompt).

Confira:
- view-source de https://motorcob.online/ sem nenhum "MotorCob" fora de URLs e nomes de arquivo;
- prévia do link colado no WhatsApp com título e descrição MotorCX;
- motorcli.online igual a antes;
- em 390 px nada mudou de layout;
- se o item 4 for aprovado, ativar a verificação numa conta de teste mostra "MotorCX" no Google Authenticator.
```
