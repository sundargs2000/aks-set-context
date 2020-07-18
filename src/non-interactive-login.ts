import * as fs from 'fs';
import * as os from 'os';
import * as util from 'util';
import * as core from '@actions/core';
import * as toolCache from '@actions/tool-cache';
import { issueCommand } from '@actions/core/lib/command';

const kubeloginLatestReleaseUrl = 'https://api.github.com/repos/azure/kubelogin/releases/latest';
const stableKubeloginVersion = 'v0.0.4';
const kubeloginToolName = 'kubelogin';

export async function login() {
    let aadcreds = core.getInput('aad-creds', { required: false });
    if(!aadcreds)
        throw new Error('AAD credentials are required for ARC clusters');
    let credsObject: { [key: string]: string; };
    try {
        credsObject = JSON.parse(aadcreds);
    } catch (ex) {
        throw new Error('AAD Credentials object is not a valid JSON');
    }

    await downloadKubelogin();

    issueCommand('kubelogin convert-kubeconfig -l spn', {}, '');
    issueCommand('set-env', { name: 'AAD_SERVICE_PRINCIPAL_CLIENT_ID' }, credsObject['appId']);
    issueCommand('set-env', { name: 'AAD_SERVICE_PRINCIPAL_CLIENT_SECRET' }, credsObject['password']);
}

async function downloadKubelogin() {
    const latestKubeloginVersion = await getLatestKubeloginVersion();
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
        const kubeloginExecutablesPath = getKubloginExecutablesPath(unzippedKubeloginPath);
        cachedToolPath = await toolCache.cacheDir(kubeloginExecutablesPath, kubeloginToolName, latestKubeloginVersion);
    }

    fs.chmodSync(cachedToolPath, "777");
    core.debug(util.format("Kubelogin executable found at path ", cachedToolPath));
    core.addPath(cachedToolPath);
}

async function getLatestKubeloginVersion() {
    return toolCache.downloadTool(kubeloginLatestReleaseUrl).then((downloadPath) => {
        const response = JSON.parse(fs.readFileSync(downloadPath, 'utf8').toString().trim());
        if (!response.tag_name) {
            return stableKubeloginVersion;
        }
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
            return `${kubeloginPath}/bin/linux_amd64/kubelogin`;

        case "Darwin":
            return `${kubeloginPath}/bin/darwin_amd64/kubelogin`;

        case "Windows_NT":
            return `${kubeloginPath}/bin/windows_amd64/kubelogin`;

        default:
            throw new Error(util.format("Container scanning is not supported on %s currently", curOS));
    }
}