import path from 'node:path';
import { existsSync } from 'node:fs';

export const IS_LIMITED_ENV = (Bun.env.PACKSCRIPTS_IS_LIMITED_ENV || "0") === "1"
export const CONFIG_FILE = 'packscripts.json';
export const ENV_FILE = '.packscripts.env.json';

// Walk up the directory tree from CWD to find the config file, then chdir to
// that directory so all relative paths in the config resolve correctly regardless
// of whether packscripts is invoked from inside the submodule or from the root.
function find_and_chdir_to_config(filename: string): void {
    let dir = process.cwd();
    while (true) {
        if (existsSync(path.join(dir, filename))) {
            process.chdir(dir);
            return;
        }
        const parent = path.dirname(dir);
        if (parent === dir) return; // probably filesystem root — no config found, stay in CWD
        dir = parent;
    }
}
// Immediately execute, so anything that uses it has the correct cwd
find_and_chdir_to_config(CONFIG_FILE);

export interface PackagingConfig {
    PACK_NAME: string;
    PACKAGE_DIRECTORY: string;
    GIT_REMOTE_URL: string;
    GIT_LFS_REMOTE_URL: string;
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
    RELATIVE_INSTANCE_DIRECTORY: string;
    PACKAGING: PackagingConfig | undefined;
}

const _config_file_exists = await Bun.file(CONFIG_FILE).exists();
let config: config = _config_file_exists ? await Bun.file(CONFIG_FILE).json() : {} as config;

export function assert_config_exists(): void {
    if (!_config_file_exists) throw Error("Missing config file. Make sure to first initialize your pack with 'packscripts init'.");
}
let secrets = (await Bun.file(ENV_FILE).exists()) ? await Bun.file(ENV_FILE).json() : undefined;

export const MOD_BASE_DIR: string = config?.MOD_BASE_DIR?.replace(/\/$/m, '');
export const DOWNLOAD_TEMP_DIR: string = config?.DOWNLOAD_TEMP_DIR?.replace(/\/$/m, '');
export const DOWNLOAD_UNDO_DIR: string = config?.DOWNLOAD_UNDO_DIR?.replace(/\/$/m, '');
export const ANNOTATED_FILE: string = config?.ANNOTATED_FILE?.replace(/\/$/m, '');
export const RELATIVE_INSTANCE_DIRECTORY: string = (config?.RELATIVE_INSTANCE_DIRECTORY?.replace(/\/?$/m, '') ?? '.') + '/';
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
