import * as vscode from "vscode";
import { StalkerEnums } from "../stalkerEnums";

export class StalkerHoverProvider implements vscode.HoverProvider {
  public provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    const range = document.getWordRangeAtPosition(position, /\b\w+(::)\w+\b/);
    if (!range) {
      return null;
    }

    const text = document.getText(range);
    const [enumName, memberName] = text.split("::");

    const enums = StalkerEnums as any;
    if (enums[enumName] && enums[enumName][memberName] !== undefined) {
      const value = enums[enumName][memberName];
      const otherMembers = Object.keys(enums[enumName])
        .filter((m) => m !== memberName)
        .map((m) => `* ${m}: ${enums[enumName][m]}`)
        .join("\n");

      const hoverContent = new vscode.MarkdownString();
      hoverContent.appendCodeblock(
        `enum ${enumName} {\n  ${memberName} = ${value}\n}`,
        "cpp"
      );
      if (otherMembers) {
        hoverContent.appendMarkdown(
          "\n---\n**Other values:**\n" + otherMembers
        );
      }

      return new vscode.Hover(hoverContent, range);
    }

    return null;
  }
}
