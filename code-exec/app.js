const express = require('express');
const http = require('http');
const fs = require('fs');
const DockerExecution = require('./dockerExecution');
const bodyParser = require('body-parser');
const path = require('path');
const { diagnostics } = require('./status');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

const server = http.createServer(app);
const DEFAULT_PORT = 4401;

function readConfig() {
    try {
        const file = fs.readFileSync(path.join(__dirname, 'config.cfg'), 'utf8');
        const config = file.toString().replace(/\r\n/g, '\n').split('\n');
        const obj = {};

        for(const line of config) {
            if(!line || line.startsWith('#')) {
                continue;
            }

            const separatorIndex = line.indexOf('=');
            if(separatorIndex === -1) {
                continue;
            }

            const key = line.slice(0, separatorIndex).trim();
            const value = line.slice(separatorIndex + 1).trim();
            if(key) {
                obj[key] = value;
            }
        }

        return obj;
    } catch (err) {
        console.warn(`Unable to read config.cfg: ${err.message}`);
        return {};
    }
}

function resolvePort() {
    const config = readConfig();
    const configuredPort = Number(process.env.PORT || process.env.CODE_EXEC_PORT || config['portToUse']);

    if(Number.isInteger(configuredPort) && configuredPort > 0) {
        return configuredPort;
    }

    return DEFAULT_PORT;
}

const port = resolvePort();
const startedAt = Date.now();

// Declare max requests
const MAX_REQUESTS = 20;
let mainFileName;
let numberOfRequests = 0;
let totalRunRequests = 0;
let rejectedRequests = 0;

function sendAndRelease(res, payload) {
    numberOfRequests--;
    return res.send(payload);
}

app.get('/health', (req, res) => {
    res.json({ status: 'ok', requestsInFlight: numberOfRequests });
});

app.get('/status', async (req, res) => {
    const runtime = await diagnostics();
    res.json({
        ...runtime,
        status: runtime.docker.status === 'ok' && runtime.runner.status === 'ok' ? 'ok' : 'degraded',
        hostname: process.env.HOSTNAME,
        timeoutSeconds: Number(readConfig().timeoutValue),
        port,
        pid: process.pid,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        nodeVersion: process.version,
        requestsInFlight: numberOfRequests,
        maxConcurrentRequests: MAX_REQUESTS,
        totalRunRequests,
        rejectedRequests,
        runnerImage: process.env.EXECUTION_RUNNER_IMAGE || 'umple-code-runner:dev',
        runnerAutoBuild: process.env.EXECUTION_RUNNER_AUTO_BUILD === '1',
    });
});

app.post('/run' , (req, res)  => 
{
    canProceed((err) => {
        if(err) {
            return res.send(err); 
        } else {
            numberOfRequests++;
            totalRunRequests++;

            // Extract out path and validate
            const path = req.body.path;
            const compileError = req.body.error;
            const language = req.body.language;
            console.log(`language is ${language}`);
            mainFileName=language+"MainClasses.txt";

            console.log("Compilation error or warning: " + compileError);

            const pathError = validatePath(path);
            if(pathError) {
                return sendAndRelease(res, pathError);
            }

            // Check for main file error
            const mainFileError = validateMainFile(path);

            // If there were error previously and now
            // It means, there was compilation error
            if(mainFileError && compileError) {
                return sendAndRelease(res, {errors:"", output:""});
            } else if(mainFileError) {
                return sendAndRelease(res, mainFileError);
            }

            console.log("Given path:",req.body.path);
            console.log("Base path: ", path);

            // Read main file content
            const mainFunctions = readMainFile(path);
            if(mainFunctions.length == 0 || mainFunctions[0] === '') {
                return sendAndRelease(res, {errors: "Main function name is not provided.", output:""});
            }

            let output = "";
            let totalServed = 0;
            mainFunctions.forEach((mainFunction) => {
                let foundFilePath;
                if(language==="Python"){
                    console.log(`languague is python`);
                    console.log("Finding file: " + (mainFunction + '.py'));
                    foundFilePath = findFile(path, "/", mainFunction + '.py');
                }else if(language==="Java"){
                    console.log("Language is java ------------");
                    console.log("Finding file: " + (mainFunction + '.class'));
                    foundFilePath = findFile(path, "/",mainFunction + '.class');
                }

                console.log("Found file at: ", foundFilePath);
            
                // Execute docker 
                const dockerExecution = new DockerExecution(foundFilePath, mainFunction, req.body.path, language);
                try {
                    dockerExecution.run((err, data) =>
                    {
                        output += `<strong>For main method in class ${mainFunction}:</strong>\n`
                        output += `${err || ""}\n`;
                        const linelimit=1000;
                        const lines = data.split("\n");
                        output += lines.slice(0,linelimit).join("\n")+"\n";
                        if(lines.length > linelimit+1) {
                          output += "...\n"+lines[lines.length-1]+"\n";
                          output += "A total of "+(lines.length-1)+" output lines were generated. The listing above has been limited to the first "+linelimit+" lines, plus the very last line\n";
                        };
                        totalServed++;
                        console.log("Processed request ", totalServed);
                        if(totalServed >= mainFunctions.length) {
                            return sendAndRelease(res, {errors: "", output:output});
                        }
                    });
                } catch(err) {
                    console.log(err);
                    output += `<strong>For main method in class ${mainFunction}:</strong>\n`
                    output += "Error processing Umple code execution request\n"
                    totalServed++;
                    if(totalServed >= mainFunctions.length) {
                        return sendAndRelease(res, {errors: "", output:output});
                    }
                }
            });
        }
    });   
});

const readMainFile = (path) => {
    const buffer = fs.readFileSync(path + "/" + mainFileName, 'utf8');
    const fileContent = buffer.toString().replace(/\r/g,'').replace(/\n/g,'');
    return fileContent.split(" ");
}

const findFile = (dirPath, curPath, file)  => {
    const files = fs.readdirSync(dirPath);

    for(let i = 0; i < files.length; i++) {
        if (fs.statSync(dirPath + "/" + files[i]).isDirectory()) {
            const cur =  findFile(dirPath + "/" + files[i], curPath + "/" + files[i], file)
            if(cur != null) {
                return cur;
            }
        } else if(files[i] == file) {
            return path.join(curPath, "/");
        }
    }
  
    return null;
}

const validateMainFile = (path) => {
    console.log("path : "+path + "/" + mainFileName);
    if(fs.existsSync(path + "/" + mainFileName)) {
        return null;
    } else {
        return {errors:"Cannot execute model because no Umple class was found with a public static void main(String[] args) {} function.", output: ""};
    }
}

const validatePath = (path) => {
    if(!path) {
        return {errors:'Internal problem validating path for Umple Code Execution. No path provided. Please report to Umple developers.', output:""};
    } else if(!fs.existsSync(path)) {
        return {errors:'Internal problem validating path for Umple Code Execution. Path '+path+' not found. Please report to Umple developers.', output:""};
    }

    try {
        fs.accessSync(path, fs.constants.R_OK)
    } catch {
        return {errors: 'Internal problem accessing path for Umple Code Execution, Access to '+path+' denied.', output:""};
    }

    return null;
}

const canProceed = (callback) => {
    // Check max number of requests allowed
    if(numberOfRequests >= MAX_REQUESTS) {
        rejectedRequests++;
        callback({errors:"Umple code execution Docker server is too heavily loaded to execute your code at the same time as many others, please try again in a few seconds to execute your code. If the problem persists for many minutes, then please report to Umple developers.", output:""})
    } else {
        callback(null);
    }
}

// start listening to calls to compile umple code
// Note: Adding an extra argument after port, "0.0.0.0" , was tried
// in order to get 2-level docker in docker working, but was removed as it made no difference.
server.listen(port, () => {
    console.log("Listening at "+port)
});
