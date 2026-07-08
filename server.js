require('dotenv').config();

const path = require('path');
const express = require('express');
const multer = require('multer');
const { importEvolutionSession, configFromEnv } = require('./lib/importSession');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const APP_TOKEN = process.env.APP_TOKEN || '';
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
});

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function isAuthorized(req) {
    if (!APP_TOKEN) return true;
    const headerToken = req.get('x-app-token');
    const bodyToken = req.body?.appToken;
    return headerToken === APP_TOKEN || bodyToken === APP_TOKEN;
}

app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'arqsevo-import' });
});

app.get('/api/config', (_req, res) => {
    const config = configFromEnv();
    res.json({
        instanceName: config.instanceName,
    });
});

function validateEnvConfig(config) {
    const missing = [];

    if (!config.evolutionApiUrl) missing.push('EVOLUTION_API_URL');
    if (!config.globalApiKey) missing.push('GLOBAL_API_KEY');
    if (!config.dbConfig.host) missing.push('DB_HOST');
    if (!config.dbConfig.password) missing.push('DB_PASSWORD');
    if (!config.dbConfig.database) missing.push('DB_NAME');

    if (missing.length) {
        throw new Error(`Configuração do servidor incompleta. Defina no .env: ${missing.join(', ')}`);
    }
}

app.post('/api/import', upload.single('sessionFile'), async (req, res) => {
    if (!isAuthorized(req)) {
        return res.status(401).json({ success: false, error: 'Token inválido ou ausente.' });
    }

    const logs = [];
    const onLog = entry => logs.push(entry);

    try {
        const config = configFromEnv();
        validateEnvConfig(config);

        const instanceName = req.body.instanceName?.trim();
        if (!instanceName) {
            return res.status(400).json({
                success: false,
                error: 'Informe o nome da sessão/dispositivo.',
                logs,
            });
        }

        let sessionData;
        if (req.file?.buffer) {
            sessionData = req.file.buffer.toString('utf8');
        } else if (req.body.sessionJson) {
            sessionData = req.body.sessionJson;
        } else if (config.sessionFile) {
            sessionData = undefined;
        } else {
            return res.status(400).json({
                success: false,
                error: 'Envie um arquivo JSON de sessão ou cole o conteúdo no formulário.',
                logs,
            });
        }

        const result = await importEvolutionSession({
            sessionData,
            sessionFile: sessionData ? undefined : config.sessionFile,
            instanceName,
            evolutionApiUrl: config.evolutionApiUrl,
            globalApiKey: config.globalApiKey,
            dbConfig: config.dbConfig,
            backupPath: path.join(__dirname, 'data', 'creds_backup.json'),
            onLog,
        });

        return res.json({
            success: true,
            logs: result.logs,
            connectResponse: result.connectResponse,
        });
    } catch (error) {
        logs.push({
            level: 'error',
            message: error.message,
            at: new Date().toISOString(),
        });

        return res.status(500).json({
            success: false,
            error: error.message,
            logs,
        });
    }
});

app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const dataDir = path.join(__dirname, 'data');
require('fs').mkdirSync(dataDir, { recursive: true });

app.listen(PORT, () => {
    console.log(`[arqsevo] Interface disponível em http://0.0.0.0:${PORT}`);
});
