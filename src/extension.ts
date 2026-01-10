import * as vscode from "vscode";
import {
  LANGUAGE_ID,
  EXTENSION_CONFIG_SECTION,
  CONFIG_RESOURCES_PATH,
  OUTPUT_CHANNEL_NAME,
} from "./constants";
import { StalkerDefinitionProvider } from "./definitionProvider";
import { clearCache } from "./cache";
import { activateDiagnostics } from "./providers/diagnosticsProvider";
import { StalkerDocumentSymbolProvider } from "./providers/symbolProvider";
import { StalkerHoverProvider } from "./providers/hoverProvider";
import { StalkerCompletionItemProvider } from "./providers/completionProvider";
import { ASTManager } from "./astManager";
import { SetupWebview } from "./setupWebview";
import { validateResourcesPath } from "./validation";
import { InheritanceTreeProvider } from "./inheritanceProvider";
import { ComputedViewProvider } from "./computedViewProvider";

export let extensionOutputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
  extensionOutputChannel =
    vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  console.log(`${OUTPUT_CHANNEL_NAME} extension is now active!`);
  extensionOutputChannel.appendLine("Extension active.");

  // Initialize AST Manager
  ASTManager.activate(context);

  const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
  const resourcesPathSetting = config.get<string>(CONFIG_RESOURCES_PATH);

  if (!resourcesPathSetting) {
    extensionOutputChannel.appendLine(
      "Missing resources path. Launching setup..."
    );
    SetupWebview.show(context.extensionUri);
  } else {
    validateResourcesPath(resourcesPathSetting).then((validation) => {
      if (!validation.valid) {
        extensionOutputChannel.appendLine(
          "Invalid resources path: " + validation.error
        );
        vscode.window
          .showWarningMessage(
            "S.T.A.L.K.E.R. 2 Navigator: Invalid resources path. Would you like to reconfigure?",
            "Yes"
          )
          .then((selection) => {
            if (selection === "Yes") {
              SetupWebview.show(context.extensionUri);
            }
          });
      } else {
        extensionOutputChannel.appendLine(
          "Resources path validated: " + resourcesPathSetting
        );
      }
    });
  }

  // Register Definition Provider
  const definitionProvider = vscode.languages.registerDefinitionProvider(
    { language: LANGUAGE_ID },
    new StalkerDefinitionProvider(extensionOutputChannel)
  );

  // Activate Diagnostics
  activateDiagnostics(context);

  // Register Document Symbol Provider
  const symbolProvider = vscode.languages.registerDocumentSymbolProvider(
    { language: LANGUAGE_ID },
    new StalkerDocumentSymbolProvider()
  );

  // Register Hover Provider
  const hoverProvider = vscode.languages.registerHoverProvider(
    { language: LANGUAGE_ID },
    new StalkerHoverProvider()
  );

  // Register Completion Item Provider
  const completionProvider = vscode.languages.registerCompletionItemProvider(
    { language: LANGUAGE_ID },
    new StalkerCompletionItemProvider(),
    ":" // Trigger on ':'
  );

  // Register Clear Cache Command
  const clearCacheCommand = vscode.commands.registerCommand(
    "stalker2.clearCache",
    () => {
      clearCache();
      ASTManager.clear();
      vscode.window.showInformationMessage(
        "S.T.A.L.K.E.R. 2 Navigator: Cache cleared."
      );
      extensionOutputChannel.appendLine("Cache cleared by user.");
    }
  );

  // Register Show Setup Command
  const showSetupCommand = vscode.commands.registerCommand(
    "stalker2.showSetup",
    () => {
      SetupWebview.show(context.extensionUri);
    }
  );

  // Register Inheritance View
  const inheritanceProvider = new InheritanceTreeProvider(
    extensionOutputChannel
  );
  vscode.window.registerTreeDataProvider(
    "stalker2.inheritanceView",
    inheritanceProvider
  );

  const showInheritanceCommand = vscode.commands.registerCommand(
    "stalker2.showInheritance",
    async (uri: vscode.Uri) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === LANGUAGE_ID) {
        await inheritanceProvider.showInheritance(
          editor.document,
          editor.selection.active
        );
        // Focus the view
        vscode.commands.executeCommand("stalker2.inheritanceView.focus");
      }
    }
  );

  const showComputedViewCommand = vscode.commands.registerCommand(
    "stalker2.showComputedView",
    async (uri: vscode.Uri) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === LANGUAGE_ID) {
        await ComputedViewProvider.show(
          context,
          editor.document,
          editor.selection.active,
          extensionOutputChannel
        );
      }
    }
  );

  context.subscriptions.push(
    definitionProvider,
    symbolProvider,
    hoverProvider,
    completionProvider,
    clearCacheCommand,
    showSetupCommand,
    showInheritanceCommand,
    showComputedViewCommand,
    extensionOutputChannel
  );
}

export function deactivate() {
  clearCache();
  ASTManager.clear();
}
