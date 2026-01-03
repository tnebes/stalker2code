import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { REGEX } from "./constants";

export interface ValidationResult {
  valid: boolean;
  error?: string;
  path?: string;
}

export async function validateResourcesPath(
  folderPath: string
): Promise<ValidationResult> {
  if (!folderPath) {
    return { valid: false, error: "Path is empty." };
  }

  try {
    const stats = await fs.promises.stat(folderPath);
    if (!stats.isDirectory()) {
      return { valid: false, error: "Selected path is not a directory." };
    }

    const basename = path.basename(folderPath).toLowerCase();

    // Check if the folder is Stalker2 or contains it
    let stalker2Path = folderPath;
    if (basename !== "stalker2") {
      const subStalker2 = path.join(folderPath, "Stalker2");
      if (fs.existsSync(subStalker2)) {
        stalker2Path = subStalker2;
      } else {
        return {
          valid: false,
          error:
            "The folder must be named 'Stalker2' or contain a 'Stalker2' subfolder. This folder is usually obtained by extracting game archives.",
        };
      }
    }

    // Check for .cfg files
    const hasCfg = await hasCfgFiles(stalker2Path);
    if (!hasCfg) {
      return {
        valid: false,
        error:
          "No .cfg files found in the selected folder. A valid resource folder should contain many .cfg files.",
      };
    }

    return { valid: true, path: stalker2Path };
  } catch (err) {
    return {
      valid: false,
      error: `Error accessing path: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

async function hasCfgFiles(dir: string, depth: number = 0): Promise<boolean> {
  if (depth > 5) return false; // Don't go too deep for validation

  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (await hasCfgFiles(path.join(dir, entry.name), depth + 1)) {
          return true;
        }
      } else if (entry.isFile() && REGEX.CFG_FILE_EXT.test(entry.name)) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}
