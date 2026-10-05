const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
let pending;
let cached;
let checkedAt = 0;

async function command(args) {
    const { stdout } = await execFileAsync('docker', args, { timeout: 4000, maxBuffer: 1024 * 1024 });
    return stdout.trim();
}

async function collectDiagnostics() {
    const runnerImage = process.env.EXECUTION_RUNNER_IMAGE || 'umple-code-runner:dev';
    const project = process.env.STATUS_COMPOSE_PROJECT;
    const result = {
        docker: { status: 'unavailable', stats: [], project: project || '' },
        runner: { status: 'unavailable', image: runnerImage },
    };
    const runnerProbe = (async () => {
        try {
            const image = JSON.parse(await command(['image', 'inspect', runnerImage]));
            result.runner = { status: 'ok', image: runnerImage, id: image[0].Id, createdAt: image[0].Created };
        } catch (err) {
            result.runner.detail = err.stderr?.trim() || err.message;
        }
    })();
    try {
        const version = JSON.parse(await command(['version', '--format', '{{json .}}']));
        result.docker = {
            ...result.docker,
            status: 'ok',
            clientVersion: version.Client?.Version,
            serverVersion: version.Server?.Version,
        };
        // Report only this stack's containers, never unrelated host workloads.
        if (project) {
            const output = await command(['ps', '--filter', 'label=com.docker.compose.project=' + project,
                '--format', '{{json .}}']);
            const containers = output ? output.split('\n').map(line => JSON.parse(line)) : [];
            result.docker.containers = containers.map(container => ({
                name: container.Names, id: container.ID, image: container.Image,
                ports: container.Ports, state: container.State, status: container.Status,
            }));
            if (containers.length) {
                const stats = await command(['stats', '--no-stream', '--format', '{{json .}}',
                    ...containers.map(container => container.ID)]);
                result.docker.stats = stats.split('\n').filter(Boolean).map(line => JSON.parse(line));
            }
        } else {
            result.docker.detail = 'Set STATUS_COMPOSE_PROJECT to report this stack?s containers';
        }
    } catch (err) {
        result.docker.status = 'unavailable';
        result.docker.detail = err.stderr?.trim() || err.message;
    }
    await runnerProbe;
    return result;
}

async function diagnostics() {
    if (cached && Date.now() - checkedAt < 30_000) return cached;
    if (!pending) {
        pending = collectDiagnostics().then(result => {
            checkedAt = Date.now();
            cached = result;
            return result;
        }).finally(() => { pending = undefined; });
    }
    return pending;
}

module.exports = { diagnostics };
