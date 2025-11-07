let config = undefined;
if (await Bun.file("./config.json").exists()) {
    config = await Bun.file("./config.json").json();
}

export const MOD_BASE_DIR = config?.MOD_BASE_DIR || "../.minecraft/mods"
export const DOWNLOAD_TEMP_DIR = config?.DOWNLOAD_TEMP_DIR || './tmp/downloads';
export const ANNOTATED_FILE = config?.ANNOTATED_FILE || '../annotated_mods.json';