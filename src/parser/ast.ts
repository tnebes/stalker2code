import * as vscode from "vscode";

export type NodeType = "Document" | "Block" | "Property" | "Error";

export interface ASTNode {
  type: NodeType;
  range: vscode.Range;
  children?: ASTNode[];
}

export interface DocumentNode extends ASTNode {
  type: "Document";
  children: ASTNode[];
}

export interface BlockNode extends ASTNode {
  type: "Block";
  name: string;
  params?: string;
  children: ASTNode[];
  startTokenRange: vscode.Range;
  endTokenRange?: vscode.Range;
}

export interface PropertyNode extends ASTNode {
  type: "Property";
  key: string;
  value: string;
}

export interface ErrorNode extends ASTNode {
  type: "Error";
  message: string;
}
