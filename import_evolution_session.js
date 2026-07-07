const { importEvolutionSession, configFromEnv } = require('./lib/importSession');

async function run() {
    const config = configFromEnv();

    if (!config.sessionFile) {
        console.error('[!] Defina SESSION_FILE no ambiente ou use a interface web em http://localhost:3000');
        process.exit(1);
    }

    try {
        await importEvolutionSession({
            ...config,
            onLog: entry => {
                const prefix = entry.level === 'error' ? '[!]' : entry.level === 'warn' ? '[!]' : '[*]';
                const writer = entry.level === 'error' ? console.error : entry.level === 'warn' ? console.warn : console.log;
                writer(`${prefix} ${entry.message}`);
            },
        });
        console.log('\n[✔] Processo finalizado!');
    } catch (error) {
        console.error('[!] Erro:', error.message);
        process.exit(1);
    }
}

run();
