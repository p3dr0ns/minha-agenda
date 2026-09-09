(async () => {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (response.status === 401 && new URL(typeof args[0] === 'string' ? args[0] : args[0].url, location.href).origin === location.origin) window.location.replace('/login');
    return response;
  };
  try {
    const response = await fetch('/api/auth/me');
    if (!response.ok) return;
    const { user } = await response.json();
    window.agendaUser = user;
    document.querySelector('#accountName').textContent = user.username;
    document.querySelector('#logoutButton').addEventListener('click', async () => {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (response.ok) window.location.replace('/login');
    });
    document.querySelector('#changePasswordButton').addEventListener('click', () => document.querySelector('#passwordDialog').showModal());
    document.querySelector('#passwordForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const message = document.querySelector('#passwordMessage');
      const button = document.querySelector('#passwordSave');
      button.disabled = true;
      try {
        const response = await originalFetch('/api/auth/password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user.username, password: document.querySelector('#oldPassword').value, newPassword: document.querySelector('#newPassword').value }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        event.target.reset(); message.textContent = 'Senha alterada. As outras sessões foram encerradas.';
      } catch (error) { message.textContent = error.message; }
      finally { button.disabled = false; }
    });
    const script = document.createElement('script'); script.src = '/app.js'; document.body.append(script);
  } catch {
    document.querySelector('#syncLabel').textContent = 'Não foi possível conectar. Atualize a página.';
  }
})();
