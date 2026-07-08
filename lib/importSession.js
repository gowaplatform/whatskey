const fs = require('fs');
const { Client } = require('pg');
const nacl = require('tweetnacl');
const { BufferJSON, Curve } = require('@whiskeysockets/baileys');
const axios = require('axios');

const b = s => Buffer.from(s, 'base64');
const eq = (a, c) => Buffer.compare(Buffer.from(a), Buffer.from(c)) === 0;
const signalPub = p => p.length === 33 ? p : Buffer.concat([Buffer.from([5]), Buffer.from(p)]);

function createLogger(onLog) {
    const logs = [];
    const log = (level, message) => {
        const entry = { level, message, at: new Date().toISOString() };
        logs.push(entry);
        if (onLog) onLog(entry);
    };

    return {
        logs,
        info: message => log('info', message),
        warn: message => log('warn', message),
        error: message => log('error', message),
    };
}

function buildCredsFromRawExtraction(wa, skel, logger) {
    logger.info('Formato detectado: extração crua (noiseCandidates). Processando as chaves (Noise Key)...');

    const noise = wa.noiseCandidates.map(c => ({ priv: b(c.private), pub: b(c.public) }))
        .filter(c => c.priv.length === 32 && c.pub.length === 32)
        .find(c => eq(nacl.scalarMult.base(new Uint8Array(c.priv)), c.pub));

    if (!noise) {
        throw new Error('Nenhum candidato de noise validou. O JSON pode estar incorreto ou corrompido.');
    }

    logger.info('Injetando os dados no skeleton...');
    const idPriv = b(wa.identityKey.private);
    const idPub = b(wa.identityKey.public);
    const spk = Curve.generateKeyPair();
    const signature = Buffer.from(Curve.sign(idPriv, signalPub(Buffer.from(spk.public))));

    const creds = { ...skel };
    creds.noiseKey = { private: noise.priv, public: noise.pub };
    creds.signedIdentityKey = { private: idPriv, public: idPub };
    creds.signedPreKey = {
        keyPair: { private: Buffer.from(spk.private), public: Buffer.from(spk.public) },
        signature,
        keyId: skel.signedPreKey?.keyId || 1,
    };
    creds.registrationId = wa.registrationId;
    creds.advSecretKey = wa.advSecretKey;
    creds.account = {
        details: b(wa.account.details),
        accountSignatureKey: b(wa.account.accountSignatureKey),
        accountSignature: b(wa.account.accountSignature),
        deviceSignature: b(wa.account.deviceSignature),
    };
    creds.me = { id: wa.id, lid: wa.lid, name: '~' };
    creds.platform = wa.platform || 'android';

    if (!Curve.verify(idPub, signalPub(Buffer.from(spk.public)), signature)) {
        throw new Error('Falha ao verificar a assinatura do signedPreKey.');
    }

    return creds;
}

function buildCredsFromPrebuiltSession(wa, skel, logger) {
    logger.info('Formato detectado: sessão pré-construída (noiseKey único). Montando os creds...');

    const creds = {
        ...skel,
        noiseKey: { private: b(wa.noiseKey.private), public: b(wa.noiseKey.public) },
        signedIdentityKey: { private: b(wa.signedIdentityKey.private), public: b(wa.signedIdentityKey.public) },
        signedPreKey: {
            keyId: wa.signedPreKey.keyId,
            keyPair: {
                private: b(wa.signedPreKey.keyPair.private),
                public: b(wa.signedPreKey.keyPair.public),
            },
            signature: b(wa.signedPreKey.signature),
        },
        registrationId: wa.registrationId,
        advSecretKey: wa.advSecretKey,
        account: {
            details: b(wa.account.details),
            accountSignatureKey: b(wa.account.accountSignatureKey),
            accountSignature: b(wa.account.accountSignature),
            deviceSignature: b(wa.account.deviceSignature),
        },
        me: { id: wa.me.id, lid: wa.me.lid, name: wa.me.name || '~' },
        platform: wa.platform || 'android',
    };

    if (wa.nextPreKeyId != null) creds.nextPreKeyId = wa.nextPreKeyId;
    if (wa.firstUnuploadedPreKeyId != null) creds.firstUnuploadedPreKeyId = wa.firstUnuploadedPreKeyId;

    if (!creds.advSecretKey) {
        logger.warn('advSecretKey está vazio/nulo no arquivo de sessão. Isso pode causar problemas na sincronização do app state (contatos/conversas).');
    }

    return creds;
}

function loadSessionData({ sessionData, sessionFile }) {
    if (sessionData) {
        return typeof sessionData === 'string' ? JSON.parse(sessionData) : sessionData;
    }

    if (sessionFile) {
        const rawJson = fs.readFileSync(sessionFile, 'utf8');
        return JSON.parse(rawJson);
    }

    throw new Error('Nenhum arquivo de sessão informado.');
}

async function importEvolutionSession(options = {}) {
    const logger = createLogger(options.onLog);
    const {
        sessionData,
        sessionFile,
        instanceName,
        evolutionApiUrl,
        globalApiKey,
        dbConfig,
        backupPath = 'creds_backup.json',
    } = options;

    if (!instanceName) throw new Error('INSTANCE_NAME é obrigatório.');
    if (!evolutionApiUrl) throw new Error('_API_URL é obrigatório.');
    if (!globalApiKey) throw new Error('GLOBAL_API_KEY é obrigatório.');
    if (!dbConfig?.host || !dbConfig?.user || !dbConfig?.password || !dbConfig?.database) {
        throw new Error('Configuração do banco de dados incompleta.');
    }

    let wa;
    try {
        logger.info(sessionFile ? `Lendo ${sessionFile}...` : 'Processando arquivo de sessão enviado...');
        wa = loadSessionData({ sessionData, sessionFile });
    } catch (error) {
        throw new Error(`Erro ao ler o arquivo de sessão: ${error.message}`);
    }

    logger.info('Conectando ao banco de dados...');
    const client = new Client({
        host: dbConfig.host,
        port: Number(dbConfig.port || 5432),
        user: dbConfig.user,
        password: dbConfig.password,
        database: dbConfig.database,
    });

    let connectResponse;

    try {
        await client.connect();

        logger.info(`Buscando a instância "${instanceName}" no banco de dados...`);
        const instanceRes = await client.query('SELECT id FROM "Instance" WHERE name = $1', [instanceName]);
        if (instanceRes.rowCount === 0) {
            throw new Error(`Instância "${instanceName}" não encontrada no banco.`);
        }
        const instanceId = instanceRes.rows[0].id;

        logger.info('Lendo o skeleton (dados atuais) da instância...');
        const sessionRes = await client.query('SELECT creds FROM "Session" WHERE "sessionId" = $1', [instanceId]);
        if (sessionRes.rowCount === 0) {
            throw new Error('Sessão não encontrada para a instância. Crie a instância primeiro e gere o QR code uma vez para popular o banco.');
        }

        const skeletonRaw = sessionRes.rows[0].creds;
        if (!skeletonRaw) {
            throw new Error('A coluna creds está vazia. Gere o QR code na instância pelo menos uma vez.');
        }

        fs.writeFileSync(backupPath, skeletonRaw);
        logger.info(`Backup das credenciais antigas salvo em ${backupPath}`);

        const skel = JSON.parse(JSON.parse(skeletonRaw), BufferJSON.reviver);
        const creds = Array.isArray(wa.noiseCandidates)
            ? buildCredsFromRawExtraction(wa, skel, logger)
            : buildCredsFromPrebuiltSession(wa, skel, logger);

        logger.info('Preparando dados encodados para salvar no banco...');
        const inner = JSON.stringify(creds, BufferJSON.replacer);
        const stored = JSON.stringify(inner);

        logger.info('Salvando no banco de dados...');
        await client.query('UPDATE "Session" SET creds = $1 WHERE "sessionId" = $2', [stored, instanceId]);
        logger.info('Banco de dados atualizado com sucesso!');
    } finally {
        await client.end().catch(() => {});
    }

    logger.info('Reiniciando a conexão na GOWA API...');
    try {
        const response = await axios.get(`${evolutionApiUrl}/instance/connect/${instanceName}`, {
            headers: { apikey: globalApiKey },
            timeout: 30000,
        });
        connectResponse = response.data;
        logger.info(`Requisição de conexão enviada. Resposta: ${JSON.stringify(connectResponse)}`);
    } catch (error) {
        const message = error.response?.data ? JSON.stringify(error.response.data) : error.message;
        logger.error(`Erro ao chamar a API da GOWA para conectar: ${message}`);
        logger.warn('Você pode tentar conectar manualmente no GOWA Manager.');
    }

    logger.info('Processo finalizado! O WhatsApp com Passkey deve conectar agora.');

    return {
        success: true,
        logs: logger.logs,
        connectResponse,
    };
}

function configFromEnv() {
    return {
        instanceName: process.env.INSTANCE_NAME || '',
        evolutionApiUrl: process.env.EVOLUTION_API_URL || '',
        globalApiKey: process.env.GLOBAL_API_KEY || '',
        sessionFile: process.env.SESSION_FILE || '',
        dbConfig: {
            host: process.env.DB_HOST || '',
            port: process.env.DB_PORT || '5432',
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || '',
        },
    };
}

module.exports = {
    importEvolutionSession,
    configFromEnv,
};
