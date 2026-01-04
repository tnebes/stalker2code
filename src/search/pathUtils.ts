import * as vscode from "vscode";
import * as path from "path";
import { BlockContext } from "./types";
import { ASTManager } from "../astManager";
import { ASTNode, BlockNode } from "../parser/ast";
import { REGEX } from "../constants";

export function findModRoot(filePath: string): string | null {
  let currentDir = path.dirname(filePath);
  const anchor = path.join("Stalker2", "Content", "GameLite", "GameData");

  while (true) {
    if (currentDir.endsWith("GameData")) {
      const parts = currentDir.split(path.sep);
      if (
        parts.length >= 4 &&
        parts[parts.length - 1] === "GameData" &&
        parts[parts.length - 2] === "GameLite" &&
        parts[parts.length - 3] === "Content" &&
        parts[parts.length - 4] === "Stalker2"
      ) {
        return currentDir;
      }
    }

    const parent = path.dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }
  return null;
}

export function findParentStruct(
  document: vscode.TextDocument,
  position: vscode.Position
): BlockContext[] {
  const ast = ASTManager.getAST(document);

  function findParent(
    nodes: ASTNode[],
    targetPos: vscode.Position,
    currentPath: BlockContext[]
  ): BlockContext[] | null {
    for (const node of nodes) {
      if (node.type === "Block" && node.range.contains(targetPos)) {
        const block = node as BlockNode;
        if (block.startTokenRange.contains(targetPos)) {
          return currentPath;
        }

        const context: BlockContext = { name: block.name };
        if (block.params) {
          const urlMatch = block.params.match(REGEX.REFURL);
          if (urlMatch) context.refurl = urlMatch[1];
          const keyMatch = block.params.match(REGEX.REFKEY);
          if (keyMatch) context.refkey = keyMatch[1];
        }

        const pathInChild = findParent(block.children, targetPos, [
          ...currentPath,
          context,
        ]);
        if (pathInChild) return pathInChild;

        return [...currentPath, context];
      }
    }
    return null;
  }

  return findParent(ast.children, position, []) || [];
}
