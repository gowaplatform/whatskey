# WhatsKey Importador

Interface web para importar sessão WhatsApp no Evolution API.

## Créditos
Baseado em https://github.com/samucashow15/arqsevo 
do @samucashow15 


## Uso

Usado para conectar contas do WhatsApp que usasm Pass Key, novo processo para conectar WhatsApp WEB.

1. Instale o Passkey Linker - https://chromewebstore.google.com/detail/passkey-linker/hehoacnepmncbjckgnfekfcgdijpigaj - (Créditos e iferecido por Pedrinho da ZDG)
2. Acesse o WhatsApp WEB e conecte seu dispositivo, siga o processo do WhatsApp para usar o Pass Key
3. Após conectado no WhatsApp use a extensão para extrair a creds
4. Extrai e copia a creds
5. Informe o nome da instância e use a creds extraída para atualizar a conexão na API

## Variáveis de ambiente

Copie `.env.sample` para `.env` e preencha os valores.

| Variável | Obrigatória | Descrição |
|---|---|---|
| `EVOLUTION_API_URL` | Sim | URL base da Evolution API |
| `GLOBAL_API_KEY` | Sim | API key global da Evolution |
| `DB_HOST` | Sim | Host do PostgreSQL |
| `DB_PASSWORD` | Sim | Senha do PostgreSQL |
| `DB_NAME` | Sim | Nome do banco |
| `DB_PORT` | Não | Porta (padrão: 5432) |
| `DB_USER` | Não | Usuário (padrão: postgres) |
| `INSTANCE_NAME` | Não | Nome padrão da instância na interface |
| `APP_TOKEN` | Não | Token para proteger `/api/import` |
| `SESSION_FILE` | Não | Caminho de um JSON de sessão padrão |

## Rodar localmente

```bash
npm install
npm start
```

## Deploy com Docker

O arquivo `.env` **não vai para o Git** nem entra na imagem Docker. No servidor de deploy você precisa:

1. **Docker Compose:** coloque o `.env` na mesma pasta do `docker-compose.yml` e rode `docker compose up -d`.
2. **Painel (Coolify, Portainer, etc.):** cadastre cada variável acima nas configurações de ambiente do serviço — o `.env` da sua máquina local não é enviado automaticamente no deploy via Git.

```bash
docker compose up -d --build
```
