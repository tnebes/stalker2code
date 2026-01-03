import * as vscode from "vscode";
import * as path from "path";
import { EXTENSION_CONFIG_SECTION, CONFIG_RESOURCES_PATH } from "./constants";
import { validateResourcesPath } from "./validation";

export class SetupWebview {
  public static currentPanel: SetupWebview | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public static show(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (SetupWebview.currentPanel) {
      SetupWebview.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "stalker2Setup",
      "S.T.A.L.K.E.R. 2 Navigator Setup",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
      }
    );

    SetupWebview.currentPanel = new SetupWebview(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._update();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "selectFolder":
            await this._handleSelectFolder();
            return;
          case "exit":
            this.dispose();
            return;
        }
      },
      null,
      this._disposables
    );
  }

  private async _handleSelectFolder() {
    const options: vscode.OpenDialogOptions = {
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Select Stalker2 Resource Folder",
    };

    const result = await vscode.window.showOpenDialog(options);
    if (result && result.length > 0) {
      const folderPath = result[0].fsPath;
      const validation = await validateResourcesPath(folderPath);

      if (validation.valid) {
        await vscode.workspace
          .getConfiguration(EXTENSION_CONFIG_SECTION)
          .update(
            CONFIG_RESOURCES_PATH,
            validation.path || folderPath,
            vscode.ConfigurationTarget.Global
          );
        this._panel.webview.postMessage({
          command: "setupComplete",
          path: validation.path || folderPath,
        });
        vscode.window.showInformationMessage(
          `S.T.A.L.K.E.R. 2 Navigator: Path set to ${
            validation.path || folderPath
          }`
        );
      } else {
        this._panel.webview.postMessage({
          command: "error",
          message: validation.error,
        });
      }
    }
  }

  public dispose() {
    SetupWebview.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _update() {
    this._panel.webview.html = this._getHtmlForWebview();
  }

  private _getHtmlForWebview() {
    return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>STALKER 2 Navigator Setup</title>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        padding: 20px;
                        line-height: 1.6;
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                    }
                    .container {
                        max-width: 800px;
                        margin: 0 auto;
                    }
                    h1 { color: var(--vscode-textLink-foreground); }
                    .card {
                        background: var(--vscode-editor-inactiveSelectionBackground);
                        padding: 20px;
                        border-radius: 8px;
                        margin-bottom: 20px;
                        border-left: 5px solid var(--vscode-textLink-foreground);
                    }
                    button {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        padding: 10px 20px;
                        cursor: pointer;
                        font-size: 1.1em;
                        border-radius: 4px;
                    }
                    button:hover { background-color: var(--vscode-button-hoverBackground); }
                    .exit-btn {
                        background-color: var(--vscode-button-secondaryBackground, #3a3d41);
                        color: var(--vscode-button-secondaryForeground, #ffffff);
                        margin-top: 10px;
                        display: none;
                    }
                    .exit-btn:hover { background-color: var(--vscode-button-secondaryHoverBackground, #45494e); }
                    .error { color: var(--vscode-errorForeground); margin-top: 10px; font-weight: bold; }
                    .success { color: var(--vscode-textLink-foreground); font-weight: bold; }
                    code { background: var(--vscode-textCodeBlock-background); padding: 2px 4px; border-radius: 4px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>☢️ S.T.A.L.K.E.R. 2 Navigator</h1>
                    <p>Welcome, Stalker. To enable global navigation and definition lookups, you need to provide the path to the original game resources.</p>
                    
                    <div class="card">
                        <h3>1. Set Resources Path</h3>
                        <p>This should be the <code>Stalker2</code> folder extracted from the game files (containing <code>Content/GameLite/GameData</code> etc.).</p>
                        <button id="selectBtn">Select Folder</button>
                        <div id="status"></div>
                        <button id="exitBtn" class="exit-btn">Exit Setup</button>
                    </div>

                    <div class="card">
                        <h3>2. Instructions</h3>
                        <ul>
                            <li><b>Your Mod:</b> Keep your mod files in the VS Code workspace. The extension will always check your workspace first.</li>
                            <li><b>Resources:</b> Definitions not found in your mod will be searched for in the resources path you provide above.</li>
                            <li><b>Navigation:</b> Use <code>F12</code> or <code>Ctrl+Click</code> on symbols, SIDs, or <code>refurl</code> paths to navigate.</li>
                        </ul>
                    </div>

                    <div class="card">
                        <h3>3. Troubleshooting</h3>
                        <p>If you open a <code>.cfg</code> file and it's not recognized (no syntax highlighting):</p>
                        <ol>
                            <li>Click on the language name in the bottom right corner (e.g., "Plain Text").</li>
                            <li>Select <b>"Configure File Association for '.cfg'..."</b></li>
                            <li>Choose <b>"Stalker 2 Config"</b>.</li>
                        </ol>
                        <p>If searches are slow or timing out, you can adjust the <b>Search Max Depth</b> and <b>Timeout</b> in the extension settings.</p>
                    </div>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    const btn = document.getElementById('selectBtn');
                    const status = document.getElementById('status');
                    const exitBtn = document.getElementById('exitBtn');

                    btn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'selectFolder' });
                    });

                    exitBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'exit' });
                    });

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.command) {
                            case 'error':
                                status.innerHTML = '<p class="error">❌ ' + message.message + '</p>';
                                break;
                            case 'setupComplete':
                                status.innerHTML = '<p class="success">✅ Setup complete! Resources path: ' + message.path + '</p>';
                                btn.style.display = 'none';
                                exitBtn.style.display = 'block';
                                break;
                        }
                    });
                </script>
            </body>
            </html>`;
  }
}
