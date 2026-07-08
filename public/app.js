const form = document.getElementById('importForm');
const runButton = document.getElementById('runButton');
const clearLogsButton = document.getElementById('clearLogs');
const logOutput = document.getElementById('logOutput');
const runState = document.getElementById('runState');
const healthStatus = document.getElementById('healthStatus');

let appConfig = {};

function setRunState(state, label) {
  runState.className = `run-state ${state}`;
  runState.textContent = label;
}

function renderLogs(logs = []) {
  if (!logs.length) {
    logOutput.textContent = 'Nenhum log disponível.';
    return;
  }

  logOutput.textContent = logs
    .map(entry => `[${entry.at}] [${entry.level.toUpperCase()}] ${entry.message}`)
    .join('\n');
}

async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    appConfig = await response.json();
    document.getElementById('instanceName').value = appConfig.instanceName || '';
  } catch (error) {
    console.error('Falha ao carregar configuração padrão:', error);
  }
}

async function checkHealth() {
  try {
    const response = await fetch('/api/health');
    if (!response.ok) throw new Error('health check failed');
    healthStatus.textContent = 'Serviço online';
    healthStatus.className = 'status-pill ok';
  } catch (_error) {
    healthStatus.textContent = 'Serviço indisponível';
    healthStatus.className = 'status-pill error';
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();

  const formData = new FormData();
  const instanceName = document.getElementById('instanceName').value.trim();
  const sessionFile = document.getElementById('sessionFile').files[0];
  const sessionJson = document.getElementById('sessionJson').value.trim();

  if (!instanceName) {
    alert('Informe o nome da sessão/dispositivo.');
    return;
  }

  if (!sessionFile && !sessionJson) {
    alert('Envie um arquivo JSON ou cole o conteúdo da sessão.');
    return;
  }

  formData.set('instanceName', instanceName);

  if (sessionJson) {
    formData.set('sessionJson', sessionJson);
  } else if (sessionFile) {
    formData.set('sessionFile', sessionFile);
  }

  if (appConfig.appToken) {
    formData.set('appToken', appConfig.appToken);
  }

  runButton.disabled = true;
  setRunState('running', 'Executando...');
  logOutput.textContent = 'Iniciando importação...\n';

  try {
    const response = await fetch('/api/import', {
      method: 'POST',
      body: formData,
    });

    const result = await response.json();
    renderLogs(result.logs || []);

    if (response.ok && result.success) {
      setRunState('success', 'Concluído');
    } else {
      setRunState('error', 'Falhou');
      if (result.error) {
        logOutput.textContent += `\n[ERRO] ${result.error}`;
      }
    }
  } catch (error) {
    setRunState('error', 'Falhou');
    logOutput.textContent += `\n[ERRO] ${error.message}`;
  } finally {
    runButton.disabled = false;
  }
});

clearLogsButton.addEventListener('click', () => {
  document.getElementById('instanceName').value = '';
  document.getElementById('sessionFile').value = '';
  document.getElementById('sessionJson').value = '';
  logOutput.textContent = '...';
  setRunState('idle', 'Aguardando');
});

loadConfig();
checkHealth();
