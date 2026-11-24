# Painel de Vagas

Robô que busca vagas todo dia às 17h55 (horário de Salvador) no GitHub Actions e publica o painel no GitHub Pages. Não usa Claude nem gasta tokens.

## Como funciona

- `coletor/coletar.py` busca na **Gupy** (busca pública do portal, com data de publicação, por cidade da RMS e remoto por termo, mais os portais de `gupy_portais`), na **Sólides**, no **Empregos.com.br**, na **Vagas.com.br**, no **LinkedIn**, na **Catho**, no **Indeed** (por e-mail de alerta) e nas páginas **"Trabalhe Conosco"** que você cadastrar (veja abaixo). Filtra (remoto ou híbrido em Salvador/RMS, formação que aceita Eng. Elétrica, anúncio com até 30 dias, vaga não exclusiva PcD), dá um score de 0 a 100 e grava `docs/vagas.json`.
- `dados/historico.json` guarda tudo que já foi visto, para a mesma vaga não voltar. `docs/catalogo.json` é a parte dos últimos 45 dias, usada no painel em "Conferir uma vaga que eu achei".
- `docs/index.html` é o painel. Filtros por site, área, modalidade, score e status (inclusive "Novas").
- Mesma vaga em dois sites vira um cartão só, com "Também em". Vaga da Gupy ou da Sólides que some do site ganha o aviso "Não apareceu na última busca".
- "Sites consultados na última busca" mostra, por site, quantos anúncios foram lidos, quantos entraram e por que os outros ficaram de fora. Um site que bloqueou aparece como Falhou, não como zero.
- Nas vagas da Gupy, Sólides e Empregos.com.br o robô lê a descrição e mostra quantos requisitos citados (MS Project, Primavera, inglês, CREA, NR-10...) estão no seu perfil e o que vale conferir. Edite a lista `meu_perfil` no `config.json` com o que você tem.
- Cidades da busca por cidade: `gupy_cidades` e `solides_cidades` no `config.json`.
- `docs/estado.json` guarda "Me candidatei" e "Descartar".
- Se um site bloqueia (401/403/429/503, Cloudflare, CAPTCHA), o robô para de consultar só aquele site naquela busca e mostra "Bloqueada pelo site" no diagnóstico; os outros sites seguem. Os arquivos de dados são gravados de forma atômica, então uma busca interrompida não corrompe o histórico.
- Termos de busca, cidades e regras ficam em `config.json`. Edite ali para mudar a busca.

## Fontes novas: Indeed, Catho e "Trabalhe Conosco"

Ficam no `config.json` da raiz. Cada uma pode ser desligada em `fontes_ativas`.

- **Indeed** (`indeed`): o site bloqueia robôs, então o padrão (`"modo": "gmail"`) lê os **e-mails de alerta do Indeed** na sua caixa, só leitura, dos últimos `dias_email` dias. Precisa dos secrets `GMAIL_USER` e `GMAIL_APP_PASSWORD` (veja "Retornos do Gmail") e de alertas criados no Indeed com esse e-mail. Sem isso, a fonte só avisa e não falha. `html_tentativa` fica `false`.
- **Catho** (`catho`): `cidades` (formato `salvador-ba`), `paginas` por busca e `remoto`.
- **Trabalhe Conosco** (`trabalhe_conosco`): lista das páginas de vagas das empresas que você quer acompanhar. Começa vazia.

  ```json
  "trabalhe_conosco": [
    {"empresa": "Empresa X", "url": "https://empresax.gupy.io/", "tipo": "auto"}
  ]
  ```

  Com `"tipo": "auto"` o robô reconhece Gupy, Greenhouse, Lever e páginas com dados estruturados de vaga; se não reconhecer, pega os links de vaga da página e marca "Fonte genérica — confira no site". Endereço que dá 404 vira aviso.
- `limites_novas_fontes`: no máximo `req_por_dominio` acessos por site e `pausa_s` segundos entre eles. O robô respeita o `robots.txt` de cada site.

## Triagem e fila de candidatura (OpenBot)

- Em **Meu perfil → Triagem e candidatura**: pretensão salarial mínima e máxima, "Mostrar vagas sem salário informado" e **nota de corte** (padrão 75). "Cidades de interesse" usa o campo de cidades do perfil.
- Nos filtros: Score "Acima do meu corte", Cidade "Minhas cidades + remoto" e Salário "Compatível com minha pretensão". Os atalhos **Elegíveis** e **Fila de candidatura** mostram a barra da fila.
- A fila (status Na fila, Preparando, Aguardando você, Candidatado, Pulada, Falhou) é exportada em `fila-candidatura.json`, sem telefone, senha ou CPF. O OpenBot local usa a skill `candidatura-assistida-vagas` para preparar as candidaturas e devolve `resultado-candidatura.json`, que o painel importa. Marcar "Candidatado" também marca "Me candidatei".
- **O painel nunca envia candidatura.** A skill só roda quando você pede, trata no máximo 5 vagas por vez, não cria rotina, pede sua aprovação antes de cada envio e segue 3 travas: não inventa habilidade que não está no perfil; não preenche senha, CPF ou outros dados sensíveis (você preenche); não responde perguntas pessoais ou subjetivas sem perguntar a você.

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
