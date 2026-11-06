const assert = require('node:assert/strict');
const { test } = require('node:test');
const childProcess = require('node:child_process');
const { promisify } = require('node:util');

const missingImage = Object.assign(new Error('inspect failed'), {
    code: 1, stderr: 'Error response from daemon: No such image: umple-code-runner:dev',
});

function loadDiagnostics(t, { env = {}, inspectError, versionError, inspectOutput } = {}) {
    const keys = ['EXECUTION_RUNNER_IMAGE', 'EXECUTION_RUNNER_AUTO_BUILD', 'STATUS_COMPOSE_PROJECT'];
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    for (const key of keys) {
        delete process.env[key];
        if (env[key] !== undefined) process.env[key] = env[key];
    }
    const calls = [];
    const originalExecFile = childProcess.execFile;
    const stub = () => assert.fail('Expected a promisified Docker command');
    stub[promisify.custom] = async (file, args) => {
        assert.equal(file, 'docker');
        calls.push(args);
        if (args[0] === 'image') {
            if (inspectError) throw inspectError;
            return { stdout: inspectOutput ?? JSON.stringify([{ Id: 'sha256:runner', Created: '2026-10-04T12:00:00Z' }]) };
        } else if (args[0] === 'version') {
            if (versionError) throw versionError;
            return { stdout: JSON.stringify({ Client: { Version: '28.0' }, Server: { Version: '28.0' } }) };
        } else {
            assert.fail('Unexpected Docker command: ' + args.join(' '));
        }
    };
    childProcess.execFile = stub;
    delete require.cache[require.resolve('./status')];
    t.after(() => {
        childProcess.execFile = originalExecFile;
        for (const key of keys) {
            if (previous[key] === undefined) delete process.env[key];
            else process.env[key] = previous[key];
        }
        delete require.cache[require.resolve('./status')];
    });
    return { diagnostics: require('./status').diagnostics, calls };
}

test('an existing runner image reports its metadata and healthy service status', async t => {
    const { diagnostics, calls } = loadDiagnostics(t, { env: { EXECUTION_RUNNER_IMAGE: 'runner:release' } });
    const result = await diagnostics();
    assert.equal(result.status, 'ok');
    assert.equal(result.runner.status, 'ok');
    assert.equal(result.runner.image, 'runner:release');
    assert.equal(result.runner.id, 'sha256:runner');
    assert.equal(result.runner.createdAt, '2026-10-04T12:00:00Z');
    assert.equal(result.runner.autoBuild, false);
    assert.deepEqual(calls[0], ['image', 'inspect', 'runner:release']);
});

for (const autoBuild of [undefined, '1', 'true', 'yes', 'on']) {
    test(`a missing lazy-built image is expected (auto-build: ${autoBuild ?? 'default'})`, async t => {
        const { diagnostics, calls } = loadDiagnostics(t, {
            env: { EXECUTION_RUNNER_AUTO_BUILD: autoBuild }, inspectError: missingImage,
        });
        const result = await diagnostics();
        assert.equal(result.status, 'ok');
        assert.equal(result.docker.status, 'ok');
        assert.equal(result.runner.status, 'not_built');
        assert.equal(result.runner.autoBuild, true);
        assert.match(result.runner.detail, /built automatically on the first execution request/);
        assert.equal(calls.length, 2); // Monitoring must never build or pull an image.
        assert.strictEqual(await diagnostics(), result);
        assert.equal(calls.length, 2); // Cached monitoring must not re-probe Docker.
    });
}

for (const autoBuild of [undefined, '0']) {
    test(`a missing deployment image degrades health (auto-build: ${autoBuild ?? 'default'})`, async t => {
        const { diagnostics } = loadDiagnostics(t, {
            env: { EXECUTION_RUNNER_IMAGE: 'runner:release', EXECUTION_RUNNER_AUTO_BUILD: autoBuild },
            inspectError: missingImage,
        });
        const result = await diagnostics();
        assert.equal(result.status, 'degraded');
        assert.equal(result.runner.status, 'not_built');
        assert.equal(result.runner.autoBuild, false);
        assert.match(result.runner.detail, /Pull or build the configured image/);
    });
}

for (const detail of ['Cannot connect to the Docker daemon', 'permission denied', 'invalid reference format']) {
    test(`inspection failure stays unavailable: ${detail}`, async t => {
        const { diagnostics } = loadDiagnostics(t, {
            inspectError: Object.assign(new Error('inspect failed'), { code: 1, stderr: detail }),
        });
        const result = await diagnostics();
        assert.equal(result.status, 'degraded');
        assert.equal(result.runner.status, 'unavailable');
        assert.equal(result.runner.detail, detail);
    });
}

test('an image probe timeout is not mistaken for a missing image', async t => {
    const { diagnostics } = loadDiagnostics(t, { inspectError: new Error('Docker probe timed out') });
    const result = await diagnostics();
    assert.equal(result.status, 'degraded');
    assert.equal(result.runner.status, 'unavailable');
});

test('invalid image metadata stays unavailable', async t => {
    const { diagnostics } = loadDiagnostics(t, { inspectOutput: 'invalid JSON' });
    const result = await diagnostics();
    assert.equal(result.status, 'degraded');
    assert.equal(result.runner.status, 'unavailable');
});

test('Docker failure degrades health even when a missing image can be built automatically', async t => {
    const { diagnostics } = loadDiagnostics(t, {
        inspectError: missingImage, versionError: new Error('Cannot connect to the Docker daemon'),
    });
    const result = await diagnostics();
    assert.equal(result.status, 'degraded');
    assert.equal(result.docker.status, 'unavailable');
    assert.equal(result.runner.status, 'not_built');
});
