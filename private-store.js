const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function createPrivateStore(root) {
  fs.mkdirSync(root, { recursive: true });
  const keyFile = path.join(root, '.encryption-key');
  let key;
  if (process.env.DATA_ENCRYPTION_KEY) {
    key = Buffer.from(process.env.DATA_ENCRYPTION_KEY, 'base64');
  } else {
    if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
    key = fs.readFileSync(keyFile);
  }
  if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY deve conter 32 bytes em base64.');
  return {
    read(file, fallback) {
      if (!fs.existsSync(file)) return fallback;
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(data.iv, 'base64'));
      decipher.setAAD(Buffer.from(path.relative(root, file)));
      decipher.setAuthTag(Buffer.from(data.tag, 'base64'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.body, 'base64')), decipher.final()]).toString('utf8'));
    },
    write(file, value) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(path.relative(root, file)));
      const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      const temporary = file + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), body: body.toString('base64') }), { mode: 0o600 });
      fs.renameSync(temporary, file);
    }
  };
}
module.exports = { createPrivateStore };
