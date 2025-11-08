let config = undefined;
if (await Bun.file("./config.json").exists()) {
    config = await Bun.file("./config.json").json();
}

export const MOD_BASE_DIR = config?.MOD_BASE_DIR?.replace(/\/$/m, "") || "../.minecraft/mods"
export const DOWNLOAD_TEMP_DIR = config?.DOWNLOAD_TEMP_DIR?.replace(/\/$/m, "") || './tmp/downloads';
export const ANNOTATED_FILE = config?.ANNOTATED_FILE?.replace(/\/$/m, "") || '../annotated_mods.json';