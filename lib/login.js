"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = require("@actions/core");
const command_1 = require("@actions/core/lib/command");
const path = require("path");
const fs = require("fs");
const io = require("@actions/io");
const client_1 = require("./client");
const nonInteractiveLogin = require("./non-interactive-login");
const toolrunner_1 = require("@actions/exec/lib/toolrunner");
const managementEndpointUrl = 'https://management.azure.com/';
function getAzureAccessToken() {
    return __awaiter(this, void 0, void 0, function* () {
        const azPath = yield io.which('az', true);
        let output = '';
        let error = '';
        const options = {};
        options.silent = true;
        options.listeners = {
            stdout: (data) => {
                output += data.toString();
            },
            stderr: (data) => {
                error += data.toString();
            },
        };
        try {
            const azToolRunner = new toolrunner_1.ToolRunner(azPath, ['account', 'get-access-token', `--resource=${managementEndpointUrl}`], options);
            const azStatus = yield azToolRunner.exec();
            return JSON.parse(output);
        }
        catch (error) {
            throw new Error('Error: Could not fetch azure access token: ' + error);
        }
    });
}
function getARCKubeconfig(azureSessionToken, subscriptionId, managementEndpointUrl) {
    let resourceGroupName = core.getInput('resource-group', { required: true });
    let clusterName = core.getInput('cluster-name', { required: true });
    return new Promise((resolve, reject) => {
        var webRequest = new client_1.WebRequest();
        webRequest.method = 'POST';
        webRequest.uri = `${managementEndpointUrl}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Kubernetes/connectedClusters/${clusterName}/listClusterUserCredentials?api-version=2020-01-01-preview`;
        webRequest.headers = {
            'Authorization': 'Bearer ' + azureSessionToken,
            'Content-Type': 'application/json; charset=utf-8'
        };
        client_1.sendRequest(webRequest).then((response) => {
            let kubeconfigs = response.body.kubeconfigs;
            if (kubeconfigs && kubeconfigs.length > 0) {
                var kubeconfig = Buffer.from(kubeconfigs[0].value, 'base64');
                console.log('KUBECONFIG:');
                console.log(kubeconfig.toString());
                resolve(kubeconfig.toString());
            }
            else {
                reject(JSON.stringify(response.body));
            }
        }).catch(reject);
    });
}
function getKubeconfig() {
    return __awaiter(this, void 0, void 0, function* () {
        let azOutput = yield getAzureAccessToken();
        let azureSessionToken = azOutput.accessToken;
        let subscriptionId = azOutput.subscription;
        let kubeconfig = yield getARCKubeconfig(azureSessionToken, subscriptionId, managementEndpointUrl);
        return kubeconfig;
    });
}
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        let kubeconfig = yield getKubeconfig();
        const runnerTempDirectory = process.env['RUNNER_TEMP']; // Using process.env until the core libs are updated
        const kubeconfigPath = path.join(runnerTempDirectory, `kubeconfig_${Date.now()}`);
        core.debug(`Writing kubeconfig contents to ${kubeconfigPath}`);
        fs.writeFileSync(kubeconfigPath, kubeconfig);
        command_1.issueCommand('set-env', { name: 'KUBECONFIG' }, kubeconfigPath);
        console.log('KUBECONFIG environment variable is set');
        yield nonInteractiveLogin.login(kubeconfigPath);
        console.log('Kubeconfig is updated with AAD access token');
    });
}
run().catch(core.setFailed);
