// Run on the server after creating the destination account. Existing private data is never replaced.
const fs = require('node:fs');
const path = require('node:path');
const { createPrivateStore } = require('../private-store');
const project = path.join(__dirname, '..');
const envFile = path.join(project, '.env');
if (fs.existsSync(envFile)) for (const raw of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const index = line.indexOf('=');
  if (index < 1) continue;
  const key = line.slice(0, index).trim();
  if (!(key in process.env)) process.env[key] = line.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
}
const root = path.resolve(process.env.DATA_DIR || project);
const username = String(process.argv[2] || '').trim().toLowerCase();
if (!username) throw new Error('Uso: node scripts/import-legacy.cjs usuario-da-minha-agenda');
const store = createPrivateStore(root);
const user = store.read(path.join(root, 'accounts.enc'), { users: [] }).users.find((item) => item.username === username);
if (!user) throw new Error('Crie a conta de destino antes de importar.');
const directory = path.join(root, 'users', user.id);
const configFile = path.join(root, '.agenda-config.json');
const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};
for (const id of ['bros', 'chiefs', 'alcateia', 'nexus', 'skyvolk']) {
  const username = process.env[id.toUpperCase() + '_USERNAME'];
  const password = process.env[id.toUpperCase() + '_PASSWORD'];
  if (username && !config[id]?.disabled) config[id] = { ...config[id], username: config[id]?.username || username, password: config[id]?.password || password || '' };
}
const operations = [[path.join(directory, 'agenda.enc'), config]];
for (const [legacy, destination] of [['.kick-session.json', 'kick.enc'], ['.live-history.json', 'history.enc']]) {
  const file = path.join(root, legacy);
  if (fs.existsSync(file)) operations.push([path.join(directory, destination), JSON.parse(fs.readFileSync(file, 'utf8'))]);
}
for (const [file] of operations) {
  const existing = store.read(file, null);
  const empty = !existing || (path.basename(file) === 'history.enc' ? !existing.active && !existing.sessions?.length : !Object.keys(existing).length);
  if (!empty) throw new Error('A conta já possui dados em ' + path.basename(file) + '. Importação cancelada.');
}
for (const [file, data] of operations) store.write(file, data);
console.log('Dados antigos importados para ' + username + '. Reinicie o servidor. Os arquivos originais foram preservados.');
