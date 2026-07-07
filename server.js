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
        evolutionApiUrl: config.evolutionApiUrl,
        dbConfig: {
            host: config.dbConfig.host,
            port: config.dbConfig.port,
            user: config.dbConfig.user,
            database: config.dbConfig.database,
        },
        authRequired: Boolean(APP_TOKEN),
        hasDefaultSessionFile: Boolean(config.sessionFile),
        defaultSessionFile: config.sessionFile || null,
    });
});

app.post('/api/import', upload.single('sessionFile'), async (req, res) => {
    if (!isAuthorized(req)) {
        return res.status(401).json({ success: false, error: 'Token inválido ou ausente.' });
    }

    const logs = [];
    const onLog = entry => logs.push(entry);

    try {
        const config = configFromEnv();
        const instanceName = req.body.instanceName || config.instanceName;
        const evolutionApiUrl = req.body.evolutionApiUrl || config.evolutionApiUrl;
        const globalApiKey = req.body.globalApiKey || config.globalApiKey;
        const dbHost = req.body.dbHost || config.dbConfig.host;
        const dbPort = req.body.dbPort || config.dbConfig.port;
        const dbUser = req.body.dbUser || config.dbConfig.user;
        const dbPassword = req.body.dbPassword || config.dbConfig.password;
        const dbName = req.body.dbName || config.dbConfig.database;

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
            evolutionApiUrl,
            globalApiKey,
            dbConfig: {
                host: dbHost,
                port: dbPort,
                user: dbUser,
                password: dbPassword,
                database: dbName,
            },
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
