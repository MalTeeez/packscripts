let config = await Bun.file("./config.json").exists() ? await Bun.file("./config.json").json() : undefined;
let secrets = await Bun.file("./.env.json").exists() ? await Bun.file('./.env.json').json() : undefined;


export const MOD_BASE_DIR: string = config?.MOD_BASE_DIR?.replace(/\/$/m, "") || "../.minecraft/mods"
export const DOWNLOAD_TEMP_DIR: string = config?.DOWNLOAD_TEMP_DIR?.replace(/\/$/m, "") || './tmp/downloads';
export const DOWNLOAD_UNDO_DIR: string = config?.DOWNLOAD_UNDO_DIR?.replace(/\/$/m, "") || './tmp/updateundo';
export const ANNOTATED_FILE: string = config?.ANNOTATED_FILE?.replace(/\/$/m, "") || '../annotated_mods.json';
export const GITHUB_API_KEY: string | undefined = secrets?.GITHUB_API_KEY || undefined;