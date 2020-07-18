import * as fs from 'fs';
import * as os from 'os';
import * as util from 'util';
import * as core from '@actions/core';
import * as toolCache from '@actions/tool-cache';
import { issueCommand } from '@actions/core/lib/command';
import { ToolRunner } from '@actions/exec/lib/toolrunner';

const kubeloginLatestReleaseUrl = 'https://api.github.com/repos/azure/kubelogin/releases/latest';
const stableKubeloginVersion = 'v0.0.4';
const kubeloginToolName = 'kubelogin';

export async function login(kubeconfigPath: string) {
    try {
        let aadcreds = core.getInput('aad-creds', { required: false });
        if (!aadcreds) {
            core.warning('Could not find AAD credentials in the input. Interactive login will be required to run kubectl commands.');
            return;
        }
        let credsObject: { [key: string]: string; };
        try {
            credsObject = JSON.parse(aadcreds);
        } catch (ex) {
            throw new Error('AAD Credentials object is not a valid JSON');
        }

        const kubeloginPath = await downloadKubelogin();
        const kubeloginToolRunner = new ToolRunner(kubeloginPath, ['convert-kubeconfig', '-l', 'spn'], { env: { KUBECONFIG: kubeconfigPath } });
        const kubeloginStatus = await kubeloginToolRunner.exec();
        core.debug('kubelogin status: ' + kubeloginStatus.toString());
        issueCommand('set-env', { name: 'AAD_SERVICE_PRINCIPAL_CLIENT_ID' }, credsObject['appId']);
        issueCommand('set-env', { name: 'AAD_SERVICE_PRINCIPAL_CLIENT_SECRET' }, credsObject['password']);
    } catch (ex) {
        throw new Error('Non interactive login error: ' + ex);
    }
}

async function downloadKubelogin(): Promise<string> {
    const latestKubeloginVersion = await getLatestKubeloginVersion();
    console.debug(`Latest kubelogin version: ${latestKubeloginVersion}`);
    let cachedToolPath = toolCache.find(kubeloginToolName, latestKubeloginVersion);
    if (!cachedToolPath) {
        let kubeloginDownloadPath;
        const kubeloginDownloadUrl = getKubeloginDownloadUrl(latestKubeloginVersion);
        const kubeloginDownloadDir = `${process.env['GITHUB_WORKSPACE']}/_temp/tools/${kubeloginToolName}`;
        core.debug(util.format("Could not find kubelogin in cache, downloading from %s", kubeloginDownloadUrl));

        try {
            kubeloginDownloadPath = await toolCache.downloadTool(kubeloginDownloadUrl, kubeloginDownloadDir);
        } catch (error) {
            throw new Error(util.format("Failed to download kubelogin from %s", kubeloginDownloadUrl));
        }
        const unzippedKubeloginPath = await toolCache.extractZip(kubeloginDownloadPath);
        console.log(`Unzipped Path: ${unzippedKubeloginPath}`);
        const kubeloginExecutablesPath = getKubloginExecutablesPath(unzippedKubeloginPath);
        cachedToolPath = await toolCache.cacheDir(kubeloginExecutablesPath, kubeloginToolName, latestKubeloginVersion);
    }

    core.addPath(cachedToolPath);
    const kubeloginPath = `${cachedToolPath}/${kubeloginToolName}`;
    fs.chmodSync(kubeloginPath, "777");
    core.debug(util.format("Kubelogin executable found at path ", kubeloginPath));
    return kubeloginPath;
}

async function getLatestKubeloginVersion() {
    return toolCache.downloadTool(kubeloginLatestReleaseUrl).then((downloadPath) => {
        const response = JSON.parse(fs.readFileSync(downloadPath, 'utf8').toString().trim());
        if (!response.tag_name) {
            return stableKubeloginVersion;
        }
        return response.tag_name;
    }, (error) => {
        core.warning(util.format("Failed to read latest kubelogin verison from %s. Using default stable version %s", kubeloginLatestReleaseUrl, stableKubeloginVersion));
        return stableKubeloginVersion;
    });
}

function getKubeloginDownloadUrl(kubeloginVersion: string) {
    return util.format("https://github.com/Azure/kubelogin/releases/download/%s/kubelogin.zip", kubeloginVersion);
}

function getKubloginExecutablesPath(kubeloginPath: string) {
    const curOS = os.type();
    switch (curOS) {
        case "Linux":
            return `${kubeloginPath}/bin/linux_amd64`;

        case "Darwin":
            return `${kubeloginPath}/bin/darwin_amd64`;

        case "Windows_NT":
            return `${kubeloginPath}/bin/windows_amd64`;

        default:
            throw new Error(util.format("Kubelogin is not supported on %s currently", curOS));
    }
}