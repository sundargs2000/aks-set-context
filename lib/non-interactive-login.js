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
exports.login = void 0;
const fs = require("fs");
const os = require("os");
const util = require("util");
const core = require("@actions/core");
const toolCache = require("@actions/tool-cache");
const command_1 = require("@actions/core/lib/command");
const toolrunner_1 = require("@actions/exec/lib/toolrunner");
const kubeloginLatestReleaseUrl = 'https://api.github.com/repos/azure/kubelogin/releases/latest';
const stableKubeloginVersion = 'v0.0.4';
const kubeloginToolName = 'kubelogin';
function login(kubeconfigPath) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            let aadcreds = core.getInput('aad-creds', { required: false });
            if (!aadcreds) {
                core.warning('Could not find AAD credentials in the input. Interactive login will be required to run kubectl commands.');
                return;
            }
            let credsObject;
            try {
                credsObject = JSON.parse(aadcreds);
            }
            catch (ex) {
                throw new Error('AAD Credentials object is not a valid JSON');
            }
            const kubeloginPath = yield downloadKubelogin();
            const kubeloginToolRunner = new toolrunner_1.ToolRunner(kubeloginPath, ['convert-kubeconfig', '-l', 'spn'], { env: { KUBECONFIG: kubeconfigPath } });
            const kubeloginStatus = yield kubeloginToolRunner.exec();
            core.debug('kubelogin status: ' + kubeloginStatus.toString());
            command_1.issueCommand('set-env', { name: 'AAD_SERVICE_PRINCIPAL_CLIENT_ID' }, credsObject['appId']);
            command_1.issueCommand('set-env', { name: 'AAD_SERVICE_PRINCIPAL_CLIENT_SECRET' }, credsObject['password']);
        }
        catch (ex) {
            throw new Error('Non interactive login error: ' + ex);
        }
    });
}
exports.login = login;
function downloadKubelogin() {
    return __awaiter(this, void 0, void 0, function* () {
        const latestKubeloginVersion = yield getLatestKubeloginVersion();
        console.debug(`Latest kubelogin version: ${latestKubeloginVersion}`);
        let cachedToolPath = toolCache.find(kubeloginToolName, latestKubeloginVersion);
        if (!cachedToolPath) {
            let kubeloginDownloadPath;
            const kubeloginDownloadUrl = getKubeloginDownloadUrl(latestKubeloginVersion);
            const kubeloginDownloadDir = `${process.env['GITHUB_WORKSPACE']}/_temp/tools/${kubeloginToolName}`;
            core.debug(util.format("Could not find kubelogin in cache, downloading from %s", kubeloginDownloadUrl));
            try {
                kubeloginDownloadPath = yield toolCache.downloadTool(kubeloginDownloadUrl, kubeloginDownloadDir);
            }
            catch (error) {
                throw new Error(util.format("Failed to download kubelogin from %s", kubeloginDownloadUrl));
            }
            const unzippedKubeloginPath = yield toolCache.extractZip(kubeloginDownloadPath);
            console.log(`Unzipped Path: ${unzippedKubeloginPath}`);
            const kubeloginExecutablesPath = getKubloginExecutablesPath(unzippedKubeloginPath);
            cachedToolPath = yield toolCache.cacheDir(kubeloginExecutablesPath, kubeloginToolName, latestKubeloginVersion);
        }
        core.addPath(cachedToolPath);
        const kubeloginPath = `${cachedToolPath}/${kubeloginToolName}`;
        fs.chmodSync(kubeloginPath, "777");
        core.debug(util.format("Kubelogin executable found at path ", kubeloginPath));
        return kubeloginPath;
    });
}
function getLatestKubeloginVersion() {
    return __awaiter(this, void 0, void 0, function* () {
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
    });
}
function getKubeloginDownloadUrl(kubeloginVersion) {
    return util.format("https://github.com/Azure/kubelogin/releases/download/%s/kubelogin.zip", kubeloginVersion);
}
function getKubloginExecutablesPath(kubeloginPath) {
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
