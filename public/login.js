let registering = false;
const form = document.querySelector('#authForm');
const message = document.querySelector('#authMessage');
const submit = document.querySelector('#authSubmit');
function setMode(value) {
  registering = value;
  document.querySelector('#loginTab').setAttribute('aria-pressed', String(!value));
  document.querySelector('#registerTab').setAttribute('aria-pressed', String(value));
  document.querySelector('#confirmLabel').hidden = !value;
  document.querySelector('#authConfirm').required = value;
  const password = document.querySelector('#authPassword');
  password.autocomplete = value ? 'new-password' : 'current-password';
  password.minLength = value ? 10 : 1;
  document.querySelector('#authHelp').textContent = value ? 'Crie uma senha com pelo menos 10 caracteres. Depois você poderá conectar suas comunidades.' : 'Use a conta da Minha Agenda. Os logins das comunidades são adicionados depois.';
  submit.textContent = value ? 'Criar minha conta' : 'Entrar';
  message.textContent = '';
}
document.querySelector('#loginTab').addEventListener('click', () => setMode(false));
document.querySelector('#registerTab').addEventListener('click', () => setMode(true));
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = document.querySelector('#authPassword').value;
  if (registering && password !== document.querySelector('#authConfirm').value) { message.textContent = 'As senhas não coincidem.'; return; }
  submit.disabled = true;
  message.textContent = registering ? 'Criando sua conta…' : 'Entrando…';
  try {
    const response = await fetch('/api/auth/' + (registering ? 'register' : 'login'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: document.querySelector('#authUsername').value, password }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    window.location.replace('/');
  } catch (error) { message.textContent = error.message || 'Não foi possível conectar.'; }
  finally { submit.disabled = false; }
});
