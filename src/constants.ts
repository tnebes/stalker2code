export const LANGUAGE_ID = 'stalker2-config';
export const EXTENSION_CONFIG_SECTION = 'stalker2';
export const CONFIG_RESOURCES_PATH = 'resourcesPath';
export const OUTPUT_CHANNEL_NAME = 'S.T.A.L.K.E.R. 2 Navigator';

export const SEARCH_LIMITS = {
    MAX_DEPTH: 12,
    MAX_FILES: 50000,
    TIMEOUT_MS: 15000
};

export const REGEX = {
    WORD_RANGE: /[\w./\\:\[\]]+/,
    REFURL: /refurl\s*=\s*([^;}\s]+)/,
    CFG_FILE_EXT: /\.cfg$/i,
    CFG_PATCH_EXT: /\.cfg_patch_/i,
    STRUCT_BEGIN: /^\s*([\w./\\]+)\s*:\s*struct\.begin/i,
    STRUCT_END: /^\s*struct\.end/i,
    ASSIGNMENT: /^\s*([\w./\\]+)\s*[=:]/i
};
