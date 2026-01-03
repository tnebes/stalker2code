import * as vscode from 'vscode';
import {
    LANGUAGE_ID,
    EXTENSION_CONFIG_SECTION,
    CONFIG_RESOURCES_PATH,
    OUTPUT_CHANNEL_NAME
} from './constants';
import { StalkerDefinitionProvider } from './definitionProvider';
import { clearCache } from './cache';

let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    console.log(`${OUTPUT_CHANNEL_NAME} extension is now active!`);
    outputChannel.appendLine('Extension active.');

    const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
    const resourcesPathSetting = config.get<string>(CONFIG_RESOURCES_PATH);

    if (!resourcesPathSetting) {
        outputChannel.appendLine('Please set the resources path in the settings.');
    } else {
        outputChannel.appendLine('Resources path set to: ' + resourcesPathSetting);
    }

    // Register Definition Provider
    const definitionProvider = vscode.languages.registerDefinitionProvider(
        { language: LANGUAGE_ID },
        new StalkerDefinitionProvider(outputChannel)
    );

    // Register Clear Cache Command
    const clearCacheCommand = vscode.commands.registerCommand('stalker2.clearCache', () => {
        clearCache();
        vscode.window.showInformationMessage('S.T.A.L.K.E.R. 2 Navigator: Cache cleared.');
        outputChannel.appendLine('Cache cleared by user.');
    });

    context.subscriptions.push(definitionProvider);
    context.subscriptions.push(clearCacheCommand);
    context.subscriptions.push(outputChannel);
}

export function deactivate() {
    clearCache();
}
