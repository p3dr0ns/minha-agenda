# Minha Agenda

Agenda de comunidades com contas individuais. Cada pessoa cria sua conta da Minha Agenda e conecta as comunidades usando o link e seu login. Comunidades, credenciais, cache, sessão da Kick e histórico ficam separados por conta.

## Executar

1. Copie `.env.example` para `.env`.
2. Execute `npm start` e abra `http://localhost:3000`.
3. Crie sua conta. Em **Configurações → Grades**, adicione suas comunidades.

A senha da Minha Agenda tem no mínimo 10 caracteres. As senhas das comunidades são informadas separadamente. O botão **Senha** altera a senha da conta e encerra suas outras sessões; **Sair** encerra a sessão atual. Ainda não há recuperação de senha por e-mail.

## Conectar comunidades

Informe o link do site, seu usuário e a senha quando necessária. O nome é opcional. A descoberta procura configurações de API no HTML e nos scripts do site e testa os formatos de horários compatíveis. O formato detectado fica salvo para as próximas consultas.

Na SkyVolk, use `https://skyvolk.com`, informe seu usuário e deixe a senha vazia. A grade pública é filtrada pelo usuário. Uma conexão sem horários continua válida. Alcateia e os formatos de grade e multiview existentes também são reconhecidos.

Não existe descoberta universal: sites com CAPTCHA, autenticação em duas etapas, sessão exclusiva do navegador ou formatos desconhecidos precisam de uma integração específica. A busca só acessa endereços públicos com HTTPS; endereços internos e redirecionamentos de credenciais são bloqueados.

## Hospedar

Execute uma única instância Node.js com volume persistente. No Railway, monte o volume em `/data` e configure:

```env
DATA_DIR=/data
APP_ORIGIN=https://seu-dominio.com
NODE_ENV=production
```

`APP_ORIGIN` deve ser a origem exata usada pelas pessoas para acessar o site. O servidor também reconhece `RAILWAY_PUBLIC_DOMAIN` e requisições que o navegador identifica como provenientes do próprio site, inclusive quando o HTTPS termina no proxy do Railway. Isso evita bloquear o cadastro por uma variável antiga de localhost. Origens externas continuam bloqueadas. Se o proxy confiável substituir `X-Forwarded-For`, configure `TRUST_PROXY=1` para limitar tentativas pelo IP do visitante. Caso contrário, o limite usa o endereço da conexão.

Contas e sessões ficam em `accounts.enc`; os dados privados ficam em `users/<id>/`. Os arquivos usam AES-256-GCM. As senhas de acesso são derivadas com scrypt; os tokens de sessão são armazenados como hashes. Cookies de produção usam `HttpOnly`, `SameSite=Lax` e `Secure`.

Por padrão, a chave é criada em `/data/.encryption-key`. Faça backup do volume incluindo essa chave. Alternativamente, defina `DATA_ENCRYPTION_KEY` com 32 bytes aleatórios em base64 e guarde a mesma chave nos próximos deploys. Perdê-la impede a leitura dos dados. Não publique o volume nem suas chaves no Git.

O armazenamento em arquivos suporta uma instância do servidor. Para várias réplicas, será necessário migrar contas, sessões e dados para um banco compartilhado. Esta alteração no repositório não faz o deploy automaticamente.

## Kick

Configure `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET` e `KICK_REDIRECT_URI` no servidor. O callback deve apontar para `https://seu-dominio.com/api/kick/callback`. Cada usuário conecta sua própria conta Kick após entrar na Minha Agenda.

Use em `KICK_SCOPES` apenas os escopos habilitados no aplicativo. O padrão é `user:read`; dados de canal usam `channel:read` e mensagens de chat usam `events:subscribe`. Webhooks assinados são encaminhados somente às contas vinculadas ao broadcaster correspondente.

## Preservar dados da instalação antiga

As configurações antigas não são atribuídas automaticamente à primeira conta cadastrada. Para importar seus próprios dados:

1. Crie sua conta da Minha Agenda e pare o servidor.
2. Execute `node scripts/import-legacy.cjs seu-usuario` no servidor, com o mesmo `DATA_DIR` e a mesma chave.
3. Reinicie o servidor.

O comando importa as comunidades antigas, as credenciais legadas do `.env`, a sessão Kick e o histórico para a conta escolhida. Ele recusa substituir dados privados existentes e preserva os arquivos originais.

## Verificar

Execute `npm test`. Os testes usam duas contas e serviços externos simulados para verificar isolamento, cache, persistência, cookies, bloqueio de acesso anônimo, saída, alteração de senha, callback OAuth e encaminhamento de webhooks. Não acessam as credenciais reais.
