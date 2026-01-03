import * as vscode from "vscode";

export const LANGUAGE_ID = "stalker2-config";
export const EXTENSION_CONFIG_SECTION = "stalker2";
export const CONFIG_RESOURCES_PATH = "resourcesPath";
export const OUTPUT_CHANNEL_NAME = "S.T.A.L.K.E.R. 2 Navigator";

export class SEARCH_LIMITS {
  static get MAX_DEPTH(): number {
    return vscode.workspace
      .getConfiguration(EXTENSION_CONFIG_SECTION)
      .get("search.maxDepth", 12);
  }
  static get MAX_FILES(): number {
    return vscode.workspace
      .getConfiguration(EXTENSION_CONFIG_SECTION)
      .get("search.maxFiles", 50000);
  }
  static get TIMEOUT_MS(): number {
    return vscode.workspace
      .getConfiguration(EXTENSION_CONFIG_SECTION)
      .get("search.timeout", 15000);
  }
}

export const REGEX = {
  WORD_RANGE: /[\w./\\:\[\]*]+/,
  REFURL: /refurl\s*=\s*([^;}\s]+)/,
  REFKEY: /refkey\s*=\s*([^;}\s]+)/,
  CFG_FILE_EXT: /\.cfg$/i,
  CFG_PATCH_EXT: /\.cfg_patch(_.*)?$/i,
  STRUCT_BEGIN: /^\s*([\w./\\]+)\s*[:=]\s*struct\.begin:?/i,
  STRUCT_END: /^\s*struct\.end/i,
  ASSIGNMENT: /^\s*([\w./\\]+)\s*[=:]/i,
};
