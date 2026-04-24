export const CONFIG_FILE = './packscripts.json';
export const ENV_FILE = './.env.json';

export interface PackagingConfig {
    PACK_NAME: string;
    PACKAGE_DIRECTORY: string;
    RELATIVE_INSTANCE_DIRECTORY: string;
    REMOTE_MANIFEST_PROJECT: string;
    PACK_VARIANTS: {
        [key: string]: PackPackagingVariant;
    };
    MAX_WORKER_THREADS: number;
}

export interface PackPackagingVariant {
    TYPE: 'server' | 'client';
    REQUIRED_MOD_TAGS: Array<string>;
    EXCLUDED_MOD_TAGS: Array<string>;
    TRACK_INCLUDE_PATHS: Array<string>;
    FORCE_INCLUDE_PATHS: Array<{
        relative_path: string;
        include_as: string;
    }>;
    EXCLUDE_FROM_INCLUDE_PATHS: Array<string>;
    EXCLUDE_PATTERNS: Array<string>;
}

interface config {
    MOD_BASE_DIR: string;
    DOWNLOAD_TEMP_DIR: string;
    DOWNLOAD_UNDO_DIR: string;
    ANNOTATED_FILE: string;
    PACKAGING: PackagingConfig | undefined;
}

let config: config = (await Bun.file(CONFIG_FILE).exists()) ? await Bun.file(CONFIG_FILE).json() : undefined;
let secrets = (await Bun.file(ENV_FILE).exists()) ? await Bun.file(ENV_FILE).json() : undefined;

export const MOD_BASE_DIR: string = config?.MOD_BASE_DIR?.replace(/\/$/m, '') || './minecraft/mods';
export const DOWNLOAD_TEMP_DIR: string = config?.DOWNLOAD_TEMP_DIR?.replace(/\/$/m, '') || './tmp/downloads';
export const DOWNLOAD_UNDO_DIR: string = config?.DOWNLOAD_UNDO_DIR?.replace(/\/$/m, '') || './tmp/updateundo';
export const ANNOTATED_FILE: string = config?.ANNOTATED_FILE?.replace(/\/$/m, '') || './annotated_mods.json';
export const PACKAGING = config?.PACKAGING;
export const GITHUB_API_KEY: string | undefined = secrets?.GITHUB_API_KEY || undefined;

type ConfigKey = keyof NonNullable<typeof config>;

export async function read_intermediate_config(): Promise<config> {
    if (!(await Bun.file(CONFIG_FILE).exists())) throw Error('Config file at ' + CONFIG_FILE + ' is missing, but we require it here.');
    return await Bun.file(CONFIG_FILE).json();
}

async function write_config() {
    await Bun.write(CONFIG_FILE, JSON.stringify(config, null, 4));
}

export async function set_config_key<K extends ConfigKey>(key: K, value: NonNullable<typeof config>[K]) {
    if (!config) config = {} as NonNullable<typeof config>;
    config[key] = value;
    await write_config();
}

export async function set_config_keys(entries: Partial<NonNullable<typeof config>>) {
    if (!config) config = {} as NonNullable<typeof config>;
    Object.assign(config, entries);
    await write_config();
}
