const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const runnerImageBuilds = new Map();

function readBooleanEnv(name, fallback) {
    const value = process.env[name];
    if(value == null || value === '') {
        return fallback;
    }

    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

async function ensureRunnerImage(imageName, autoBuild) {
    if(!imageName) {
        throw new Error('execution runner image name is not configured');
    }

    const existing = runnerImageBuilds.get(imageName);
    if(existing) {
        await existing;
        return;
    }

    const buildPromise = (async () => {
        try {
            await execFileAsync('docker', ['image', 'inspect', imageName]);
            return;
        } catch {}

        if(!autoBuild) {
            throw new Error(
                `Execution runner image ${imageName} is not available locally. ` +
                'Ensure the deployment pulled CODE_RUNNER_IMAGE before serving traffic.',
            );
        }

        const dockerfilePath = path.join(__dirname, 'javaRunner', 'Dockerfile');
        console.log(`Execution runner image ${imageName} not found locally. Building it now...`);

        await execFileAsync(
            'docker',
            ['build', '-q', '-t', imageName, '-f', dockerfilePath, __dirname],
            { maxBuffer: 10 * 1024 * 1024 },
        );

        await execFileAsync('docker', ['image', 'inspect', imageName]);
        console.log(`Execution runner image ${imageName} is ready.`);
    })();

    runnerImageBuilds.set(imageName, buildPromise);

    try {
        await buildPromise;
    } finally {
        if(runnerImageBuilds.get(imageName) === buildPromise) {
            runnerImageBuilds.delete(imageName);
        }
    }
}

class DockerExecution {
    static runnerAutoBuildEnabled() {
        return readBooleanEnv(
            'EXECUTION_RUNNER_AUTO_BUILD',
            !Object.prototype.hasOwnProperty.call(process.env, 'EXECUTION_RUNNER_IMAGE'),
        );
    }

    constructor(pathToMainClass, mainFile, modelPath, language="Java") {
        this.path = pathToMainClass;
        this.mainFile = mainFile;
        this.model = path.resolve(modelPath);
        this.outputFolder = null;
        this.language = language;

        const config = this.readConfig();
        this.baseOutputPath = config['tempPath'] || os.tmpdir();
        this.runnerImage = process.env.EXECUTION_RUNNER_IMAGE || config['tempContainerName'];
        this.autoBuildRunner = DockerExecution.runnerAutoBuildEnabled();
        this.timeoutValue = +config['timeoutValue'];
    }

    run(callback) {
        void this.runExecution(callback);
    }

    async runExecution(callback) {
        let containerId = "";

        try {
            this.makeOutputFolder();
            const mainFilePath = this.getNormalizedMainFilename();
            console.log("Normalized main file: ", mainFilePath);

            containerId = await this.createContainer(mainFilePath);
            await this.copyModelIntoContainer(containerId);

            const timedOut = await this.startAndWait(containerId);
            const copyError = await this.copyOutputFromContainer(containerId);
            const result = this.readExecutionResult(timedOut, copyError);

            callback(result.errors, result.output);
        } catch(err) {
            console.error(err);
            callback(this.formatExecutionError(err), "");
        } finally {
            await this.removeContainer(containerId);
            this.deleteOutputFolder();
        }
    }

    async createContainer(mainFilePath) {
        await ensureRunnerImage(this.runnerImage, this.autoBuildRunner);

        const { stdout } = await execFileAsync('docker', [
            'create',
            '--cpus=0.5',
            '--memory=150m',
            '--network',
            'none',
            this.runnerImage,
            mainFilePath,
        ]);

        const containerId = stdout.trim();
        if(!containerId) {
            throw new Error('failed to create execution container');
        }

        return containerId;
    }

    async copyModelIntoContainer(containerId) {
        await execFileAsync('docker', [
            'cp',
            `${this.model}${path.sep}.`,
            `${containerId}:/input/`,
        ]);
    }

    async startAndWait(containerId) {
        await execFileAsync('docker', ['start', containerId]);

        try {
            await execFileAsync('timeout', [`${this.timeoutValue}s`, 'docker', 'wait', containerId]);
            return false;
        } catch (err) {
            if(!this.isTimeoutError(err)) {
                throw err;
            }

            await this.stopContainer(containerId);
            return true;
        }
    }

    async copyOutputFromContainer(containerId) {
        try {
            await execFileAsync('docker', [
                'cp',
                `${containerId}:/output/.`,
                `${this.outputFolder}/`,
            ]);
            return null;
        } catch (err) {
            return err;
        }
    }

    readExecutionResult(timedOut, copyError) {
        const errorsPath = path.join(this.outputFolder, 'errors');
        const completedPath = path.join(this.outputFolder, 'completed');
        const partialPath = path.join(this.outputFolder, 'logfile.txt');

        let errors = this.readFileIfPresent(errorsPath);
        let output = this.readFileIfPresent(completedPath) || this.readFileIfPresent(partialPath);

        if(!output && copyError) {
            errors = [errors, this.formatExecutionError(copyError)].filter(Boolean).join('\n');
        }

        if(timedOut) {
            output = output || "";
            if(output && !output.endsWith('\n')) {
                output += '\n';
            }
            output += `Execution Timed Out. Maximum allowed time is ${this.timeoutValue} seconds.`;
        }

        return { errors, output };
    }

    readFileIfPresent(filePath) {
        if(!fs.existsSync(filePath)) {
            return "";
        }
        return fs.readFileSync(filePath, 'utf8');
    }

    async stopContainer(containerId) {
        try {
            await execFileAsync('docker', ['kill', containerId]);
        } catch {}
    }

    async removeContainer(containerId) {
        if(!containerId) {
            return;
        }

        try {
            await execFileAsync('docker', ['rm', '-f', containerId]);
        } catch {}
    }

    isTimeoutError(err) {
        return Number(err?.code) === 124;
    }

    formatExecutionError(err) {
        const detail = err?.stderr?.trim() || err?.message || String(err);
        return `Internal problem executing generated code. ${detail}`;
    }

    getNormalizedMainFilename() {
        let mainPath = this.path;
        if(mainPath.startsWith('/')) {
            mainPath = mainPath.substring(1);
        }
        if(mainPath.endsWith('/')) {
            mainPath = mainPath.substring(0, mainPath.length - 1);
        }
        if(this.language=="Python"){
            return mainPath ? `${mainPath}/${this.mainFile}.py` : `${this.mainFile}.py`;
        }
        return mainPath ? `${mainPath.split('/').join('.')}.${this.mainFile}` : this.mainFile;
    }

    makeOutputFolder() {
        fs.mkdirSync(this.baseOutputPath, { recursive: true });
        this.outputFolder = fs.mkdtempSync(path.join(this.baseOutputPath, `${this.getOutputPrefix()}-`));
    }

    deleteOutputFolder() {
        if(!this.outputFolder) {
            return;
        }

        try {
            console.log("ATTEMPTING TO REMOVE: " + this.outputFolder);
            fs.rmSync(this.outputFolder, { recursive: true });
            console.log(`${this.outputFolder} is deleted!`);
        } catch (err) {
            console.error(`Error while deleting ${this.outputFolder}.`);
        } finally {
            this.outputFolder = null;
        }
    }

    getOutputPrefix() {
        const modelName = path.basename(this.model) || "model";
        return `umple-exec-${modelName}-${this.mainFile}`.replace(/[^A-Za-z0-9._-]/g, '_');
    }

    readConfig() {
        const file = fs.readFileSync(path.join(__dirname, 'config.cfg'), 'utf8');
        const config = file.toString().replace(/\r\n/g,'\n').split('\n');
        
        const obj = {};
        for(let c of config) {
            const cur = c.split('=');
            obj[cur[0]] = cur[1];
        }
        console.log("Given Config:");
        console.log(obj);
        return obj;
    }

}

module.exports = DockerExecution;
