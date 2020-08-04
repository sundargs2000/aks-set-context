import * as core from '@actions/core';
import { issueCommand } from '@actions/core/lib/command';
import * as path from 'path';
import * as fs from 'fs';
import * as exec from "@actions/exec";
import * as io from "@actions/io";
import { WebRequest, WebRequestOptions, WebResponse, sendRequest } from './client';
import * as querystring from 'querystring';
import * as nonInteractiveLogin from './non-interactive-login';
import { ExecOptions } from '@actions/exec/lib/interfaces';
import { ToolRunner } from '@actions/exec/lib/toolrunner';

const managementEndpointUrl = 'https://management.azure.com/';

async function getAzureAccessToken(): Promise<any> {
    const azPath = await io.which('az', true);
    let output = '';
    let error = '';
    const options: any = {};
    options.silent = true;
    options.listeners = {
        stdout: (data: Buffer) => {
            output += data.toString();
        },
        stderr: (data: Buffer) => {
            error += data.toString();
        },
    };

    try {
        const azToolRunner = new ToolRunner(azPath, ['account', 'get-access-token', `--resource=${managementEndpointUrl}`], options);
        const azStatus = await azToolRunner.exec();
        return JSON.parse(output);
    } catch (error) {
        throw new Error('Error: Could not fetch azure access token: ' + error);
    }
}

function getARCKubeconfig(azureSessionToken: string, subscriptionId: string, managementEndpointUrl: string): Promise<string> {
    let resourceGroupName = core.getInput('resource-group', { required: true });
    let clusterName = core.getInput('cluster-name', { required: true });
    return new Promise<string>((resolve, reject) => {
        var webRequest = new WebRequest();
        webRequest.method = 'POST';
        webRequest.uri = `${managementEndpointUrl}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Kubernetes/connectedClusters/${clusterName}/listClusterUserCredentials?api-version=2020-01-01-preview`;
        webRequest.headers = {
            'Authorization': 'Bearer ' + azureSessionToken,
            'Content-Type': 'application/json; charset=utf-8'
        }
        sendRequest(webRequest).then((response: WebResponse) => {
            let kubeconfigs = response.body.kubeconfigs;
            if (kubeconfigs && kubeconfigs.length > 0) {
                var kubeconfig = Buffer.from(kubeconfigs[0].value, 'base64');
                console.log('KUBECONFIG:');
                console.log(kubeconfig.toString());
                resolve(kubeconfig.toString());
            } else {
                reject(JSON.stringify(response.body));
            }
        }).catch(reject);
    });
}

async function getKubeconfig(): Promise<string> {
    let azOutput = await getAzureAccessToken();
    let azureSessionToken = azOutput.accessToken;
    let subscriptionId = azOutput.subscription;

    let kubeconfig = await getARCKubeconfig(azureSessionToken, subscriptionId, managementEndpointUrl);
    return kubeconfig;
}

async function run() {

    let kubeconfig = await getKubeconfig();
    const runnerTempDirectory = process.env['RUNNER_TEMP']; // Using process.env until the core libs are updated
    const kubeconfigPath = path.join(runnerTempDirectory, `kubeconfig_${Date.now()}`);
    core.debug(`Writing kubeconfig contents to ${kubeconfigPath}`);
    fs.writeFileSync(kubeconfigPath, kubeconfig);
    issueCommand('set-env', { name: 'KUBECONFIG' }, kubeconfigPath);
    console.log('KUBECONFIG environment variable is set');
    await nonInteractiveLogin.login(kubeconfigPath);
    console.log('Kubeconfig is updated with AAD access token');
}

run().catch(core.setFailed);