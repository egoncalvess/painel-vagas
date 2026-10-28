# Painel de Vagas

Robô que busca vagas todo dia às 17h55 (horário de Salvador) no GitHub Actions e publica o painel no GitHub Pages. Não usa Claude nem gasta tokens.

## Como funciona

- `coletor/coletar.py` busca na **Gupy**, no **LinkedIn** e na **Vagas.com.br**, filtra (remoto ou híbrido em Salvador/RMS, formação que aceita Eng. Elétrica, anúncio com até 30 dias), dá um score de 0 a 100 e grava `docs/vagas.json`.
- `dados/historico.json` guarda tudo que já foi visto, para a mesma vaga não voltar.
- `docs/index.html` é o painel. Filtros por site, área, modalidade, score e status.
- `docs/estado.json` guarda "Me candidatei" e "Descartar".
- Termos de busca, cidades e regras ficam em `config.json`. Edite ali para mudar a busca.

## Marcar candidaturas em qualquer aparelho

No fim do painel, em "Salvar marcações em todos os aparelhos", cole um token do GitHub:
GitHub → Settings → Developer settings → Fine-grained tokens → Generate. Repositório: só `painel-vagas`. Permissões: **Contents: Read and write** e **Actions: Read and write** (para o botão "Buscar vagas agora").
Sem token, as marcações ficam só no navegador.

## Login com Google e banco Supabase

Com isso o painel pede login com Google e guarda vagas e marcações no Supabase (grátis). Só os e-mails da tabela `permitidos` entram (hoje: engerickgoncalves@gmail.com).

1. **Supabase:** crie a conta em supabase.com, crie o projeto `painel-vagas` (região São Paulo). Anote o *Reference ID* (Project Settings → General). Gere um token em https://supabase.com/dashboard/account/tokens.
2. **Google:** em https://console.cloud.google.com crie um projeto. Em *Google Auth Platform*, configure a tela de consentimento (Externo; adicione seu e-mail como usuário de teste). Em *Clientes* → Criar cliente → Aplicativo da Web. Em *URIs de redirecionamento autorizados* coloque `https://SEU_REFERENCE_ID.supabase.co/auth/v1/callback`. Copie o ID e a chave secreta do cliente.
3. **Secrets do GitHub** (Settings → Secrets and variables → Actions): `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `PAINEL_GH_TOKEN` (o token do GitHub com Actions de leitura e escrita, para o botão Buscar vagas agora).
4. Aba Actions → **Configurar Supabase** → Run workflow. Ele cria as tabelas (`supabase/schema.sql`), liga o login, copia as vagas atuais, publica a função do botão e liga o painel ao banco.

No primeiro login, as marcações antigas (`docs/estado.json` e as deste navegador) são copiadas para o banco. Depois disso o robô grava as vagas novas direto no Supabase também.

## Retornos do Gmail (opcional)

Em Settings → Secrets and variables → Actions, crie `GMAIL_USER` (seu e-mail) e `GMAIL_APP_PASSWORD` (senha de app do Google). O robô só lê a caixa de entrada; não responde, não apaga e não marca nada.

## Rodar no PC

```
pip install -r coletor/requirements.txt
python coletor/coletar.py
python -m http.server -d docs 8000
```
Depois abra http://localhost:8000.

## Rodar agora no GitHub

Aba Actions → "Coletar vagas" → Run workflow.
