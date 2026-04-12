let config: {
    MOD_BASE_DIR: string;
    DOWNLOAD_TEMP_DIR: string;
    DOWNLOAD_UNDO_DIR: string;
    ANNOTATED_FILE: string;
    PACKAGING:
        | {
              PACK_NAME: string;
              PACKAGE_DIRECTORY: string;
              REMOTE_MANIFEST_PROJECT: string;
              TRACK_INCLUDE_PATHS: Array<{
                  relative_path: string;
                  include_as: string;
              }>;
              FORCE_INCLUDE_PATHS: Array<{
                  relative_path: string;
                  include_as: string;
              }>;
              EXCLUDE_FROM_INCLUDE_PATHS: Array<string>;
          }
        | undefined;
} = (await Bun.file('./config.json').exists()) ? await Bun.file('./config.json').json() : undefined;
let secrets = (await Bun.file('./.env.json').exists()) ? await Bun.file('./.env.json').json() : undefined;

export const MOD_BASE_DIR: string = config?.MOD_BASE_DIR?.replace(/\/$/m, '') || './minecraft/mods';
export const DOWNLOAD_TEMP_DIR: string = config?.DOWNLOAD_TEMP_DIR?.replace(/\/$/m, '') || './tmp/downloads';
export const DOWNLOAD_UNDO_DIR: string = config?.DOWNLOAD_UNDO_DIR?.replace(/\/$/m, '') || './tmp/updateundo';
export const ANNOTATED_FILE: string = config?.ANNOTATED_FILE?.replace(/\/$/m, '') || './annotated_mods.json';
export const PACKAGING = config?.PACKAGING;
export const GITHUB_API_KEY: string | undefined = secrets?.GITHUB_API_KEY || undefined;

type ConfigKey = keyof NonNullable<typeof config>;

async function writeConfig() {
    await Bun.write('./config.json', JSON.stringify(config, null, 4));
}

export async function setConfigKey<K extends ConfigKey>(key: K, value: NonNullable<typeof config>[K]) {
    if (!config) config = {} as NonNullable<typeof config>;
    config[key] = value;
    await writeConfig();
}

export async function setConfigKeys(entries: Partial<NonNullable<typeof config>>) {
    if (!config) config = {} as NonNullable<typeof config>;
    Object.assign(config, entries);
    await writeConfig();
}
