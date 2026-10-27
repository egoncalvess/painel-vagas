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
GitHub → Settings → Developer settings → Fine-grained tokens → Generate. Repositório: só `painel-vagas`. Permissão: **Contents: Read and write**.
Sem token, as marcações ficam só no navegador.

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
