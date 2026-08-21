# Minha Agenda

Agenda semanal que reúne horários de Bros, Chiefs, PrintStream, Rivals, Alcateia e Nexus.

## Configuração

1. Copie `.env.example` para `.env`.
2. Preencha usuário e senha de cada plataforma no `.env`.
3. Execute `npm start`.
4. Abra `http://localhost:3000`.

## Adicionar agenda de outro site

Em **Horários → Configurar agendas**, escolha **Adicionar agenda de outro site**. Informe um nome, o endereço do site (ou diretamente a URL base da API), login e senha. O servidor testa formatos compatíveis de autenticação por token e grade semanal e, quando encontra horários, inclui a nova fonte automaticamente.

A descoberta funciona com APIs JSON nos formatos já reconhecidos pelo projeto. Sites que usam CAPTCHA, autenticação em duas etapas, sessão exclusiva do navegador ou uma API com formato diferente precisam de uma integração específica.

O formato semanal público usado pelo SkyVolk também é reconhecido. Nesse caso, informe `https://skyvolk.com`, o nome de usuário e deixe a senha vazia; a agenda é filtrada pelo usuário informado.

As credenciais são utilizadas somente pelo servidor local e não são enviadas ao navegador. O arquivo `.env` está ignorado pelo Git.
