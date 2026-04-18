import inquirer from 'inquirer';
import { MOD_BASE_DIR, PACKAGING, setConfigKeys } from '../utils/config';
import { mkdir } from 'node:fs/promises';
import { download_file } from '../utils/fetch';
import { listFiles } from 'isomorphic-git';
import fs from 'fs';
import { bundle_files_to_zip, hash_file, path_is_directory } from '../utils/fs';
import { sync } from 'fast-glob';

interface bootstrap_json {
    unsup_manifest: string;
    version: {
        name: string;
        code: number;
    };
    hash_function: string;
    files: Array<{
        path: string;
        hash: string;
        size: number;
        url: string;
    }>;
}

//#region initialization
export async function initialize_packaging(overwrite: boolean) {
    if (PACKAGING != undefined && !overwrite) {
        console.info('Found an already existing packaging setup, refusing to do create a new one. Overwrite with --overwrite.');
        return;
    }

    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'RELATIVE_INSTANCE_DIRECTORY',
            message:
                'Optionally change the path to your top level instance directory (relative to where you execute packscripts from) (should contain your instance.cfg and .git dir):',
            default: '.',
            validate: (input: string) => {
                if (!input.trim()) return 'ERR: Relative instance directory cannot be empty.';
                return true;
            },
        },
        {
            type: 'input',
            name: 'PACKAGE_DIRECTORY',
            message:
                'Enter the directory where your packaging setup should be initialized (/unsup will be appended) (will be created if not present):',
            default: 'packaging',
            validate: (input: string) => {
                if (!input.trim()) return 'ERR: Package folder path cannot be empty.';
                return true;
            },
        },
        {
            type: 'input',
            name: 'REMOTE_MANIFEST_PROJECT',
            message:
                'Enter a url to a remote place where the unsup directory is provided. For github that would be "https://raw.githubusercontent.com/[USER]/[REPOSITORY]/[BRANCH]". This will be used to notify users of updates:',
            default: 'https://raw.githubusercontent.com/',
            validate: (input: string) => {
                if (!input.trim()) return 'ERR: Remote manifest URL cannot be empty.';
                return true;
            },
        },
        {
            type: 'input',
            name: 'PACK_NAME',
            message: 'Enter the full name of your pack (without versions):',
            validate: (input: string) => {
                if (!input.trim()) return 'ERR: Pack name cannot be empty.';
                return true;
            },
        },
    ]);

    const relative_instance_directory = answers.RELATIVE_INSTANCE_DIRECTORY.replace(/\/$/m, '') + '/';
    const packaging_dir = relative_instance_directory + answers.PACKAGE_DIRECTORY.replace(/\/$/m, '') + '/unsup';
    // This already has a relative parent
    const mc_dir = MOD_BASE_DIR.replace(/(?:\/)mods$/m, '') + '/';
    const packaging_config: {
        PACK_NAME: string;
        PACKAGE_DIRECTORY: string;
        RELATIVE_INSTANCE_DIRECTORY: string;
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
        EXCLUDE_PATTERNS: Array<string>;
    } = {
        PACK_NAME: answers.PACK_NAME,
        PACKAGE_DIRECTORY: packaging_dir,
        RELATIVE_INSTANCE_DIRECTORY: relative_instance_directory,
        REMOTE_MANIFEST_PROJECT: answers.REMOTE_MANIFEST_PROJECT.replace(/\/$/m, ''),
        TRACK_INCLUDE_PATHS: [
            { relative_path: mc_dir + 'mods', include_as: 'minecraft/mods' },
            { relative_path: mc_dir + 'config', include_as: 'minecraft/config' },
            // { relative_path: mc_dir + 'scripts', include_as: 'minecraft/scripts/' },
        ],
        FORCE_INCLUDE_PATHS: [
            { relative_path: packaging_dir + '/unsup.jar', include_as: 'minecraft/unsup.jar' },
            { relative_path: packaging_dir + '/unsup.ini', include_as: 'minecraft/unsup.ini' },
            { relative_path: relative_instance_directory + 'libraries', include_as: 'libraries' },
            { relative_path: relative_instance_directory + 'patches', include_as: 'patches' },
            { relative_path: relative_instance_directory + 'mmc-pack.json', include_as: 'mmc-pack.json' },
            { relative_path: relative_instance_directory + 'packaging/instance.cfg', include_as: 'instance.cfg' },
            //{ relative_path: "icon.png", include_as: "icon.png" },
        ],
        EXCLUDE_FROM_INCLUDE_PATHS: ['../.minecraft/mods/disabled_mods'],
        EXCLUDE_PATTERNS: ['\\.git\\w+$'],
    };

    if (await Bun.file(packaging_dir).exists()) {
        console.log('Deleting old packaging directory...');
        await Bun.file(packaging_dir).delete();
    }

    // totally not abusing the recursive dir creation to skip multiple calls
    await mkdir(packaging_dir + '/versions', { recursive: true });

    // fill unsup dir with initial files that will probably be constant
    await download_file(
        'https://github.com/MalTeeez/unsup-fork/releases/download/v1.2.2/unsup-1.2-custom+d8a847e485.20260411.jar',
        'OTHER',
        packaging_dir,
        'unsup.jar',
    );
    await Bun.file(packaging_dir + '/unsup.ini').write(
        `version=1
source_format=unsup
source=${packaging_config.REMOTE_MANIFEST_PROJECT}/${answers.PACKAGE_DIRECTORY.replace(/\/$/m, '') + '/unsup'}/manifest.json
use_parent_directory=true`,
    );
    // Yes, I know this is an object but it really isn't worth to stringify here
    await Bun.file(packaging_dir + '/manifest.json').write(
        `{
  "unsup_manifest": "root-1",
  "name": "${packaging_config.PACK_NAME}",
  "versions": {
    "current": {
      "name": "1.0.0",
      "code": 1
    },
    "history": []
  }
}`,
    );

    await Bun.file(answers.PACKAGE_DIRECTORY.replace(/\/$/m, '') + '/instance.cfg').write(
        `[General]
ConfigVersion=1.3
iconKey=default
name=${packaging_config.PACK_NAME}
InstanceType=OneSix
OverrideJavaArgs=true
JvmArgs=-javaagent:unsup.jar

[Java]
OverrideJava=true
JvmArgs=-javaagent:unsup.jar`
    )

    //TODO: remove this when versions are done
    await Bun.file(packaging_dir + '/versions/1.json').write(
        `{
  "unsup_manifest": "update-1",
  "hash_function": "SHA-2 256",
  "changes": [
    {}
  ],
  "component_versions": ${JSON.stringify(Object.fromEntries(await collect_mmc_component_versions(relative_instance_directory)), null, 2)}
}`,
    );

    // Write config back to file
    await setConfigKeys({ PACKAGING: packaging_config });

    console.info(
        `\nWrote initial setup to ${packaging_dir}. 
        Before continuing, check your config.json for any paths that should be included / excluded. 
        Afterwards, create your first version with "packscripts package build --bootstrap".`,
    );
}

//#region bootstrapping
export async function build_bootstrap(commit_sha: string) {
    if (PACKAGING == undefined) {
        console.error("ERR: Missing config settings for packaging. Make sure to run 'packscripts package init' first.");
        return;
    }

    const files = await listFiles({
        fs: fs,
        dir: PACKAGING.RELATIVE_INSTANCE_DIRECTORY,
        ref: commit_sha,
    });

    const packaging_plan = filter_and_plan_files(files);
    const bootstrap_manifest: bootstrap_json = {
        unsup_manifest: 'bootstrap-1',
        version: {
            name: 'initial',
            code: 1,
        },
        hash_function: 'SHA-2 256',
        files: [],
    };

    for (const plan_item of packaging_plan) {
        const file = Bun.file(plan_item.relative_path);
        if (await file.exists()) {
            const direct_path = plan_item.relative_path.replace(PACKAGING.RELATIVE_INSTANCE_DIRECTORY, '');
            bootstrap_manifest.files.push({
                path: direct_path,
                hash: await hash_file(plan_item.relative_path),
                size: file.size,
                url: PACKAGING.REMOTE_MANIFEST_PROJECT + '/' + direct_path,
            });
        } else {
            console.warn('W: Tracked file ', plan_item.relative_path, ' is not actually present on disk, skipping.');
        }
    }

    await Bun.write(PACKAGING.PACKAGE_DIRECTORY + '/bootstrap.json', JSON.stringify(bootstrap_manifest, null, 4));
}

function filter_and_plan_files(files: string[]): Array<{ relative_path: string; include_path: string }> {
    if (PACKAGING == undefined) throw Error('Config not yet initialized.');

    const mod_dir_is_relative = MOD_BASE_DIR.startsWith(PACKAGING.RELATIVE_INSTANCE_DIRECTORY);
    const exclude_patterns = PACKAGING.EXCLUDE_PATTERNS.map((pattern) => RegExp(pattern, 'm'));
    const filtered_files: Array<{ relative_path: string; include_path: string }> = [];
    for (const file of files) {
        let relative_path;
        if (!file.startsWith(PACKAGING.RELATIVE_INSTANCE_DIRECTORY) && mod_dir_is_relative) {
            relative_path = PACKAGING.RELATIVE_INSTANCE_DIRECTORY + file;
        } else {
            relative_path = file;
        }

        let include_obj: { relative_path: string; include_path: string } | undefined = undefined;
        for (const filter of [...PACKAGING.TRACK_INCLUDE_PATHS, ...PACKAGING.FORCE_INCLUDE_PATHS]) {
            if (relative_path.startsWith(filter.relative_path)) {
                include_obj = {
                    relative_path,
                    include_path: relative_path.replace(filter.relative_path, filter.include_as),
                };
                break;
            }
        }

        if (include_obj != undefined) {
            for (const filter of PACKAGING.EXCLUDE_FROM_INCLUDE_PATHS) {
                if (relative_path.startsWith(filter)) {
                    include_obj = undefined;
                    break;
                }
            }
        }

        if (include_obj != undefined) {
            for (const pattern of exclude_patterns) {
                if (relative_path.match(pattern) != null) {
                    include_obj = undefined;
                    break;
                }
            }
        }

        if (include_obj != undefined) {
            filtered_files.push(include_obj);
        }
    }

    return filtered_files;
}

async function collect_mmc_component_versions(optional_early_instance_dir: string | undefined = undefined): Promise<Map<string, string>> {
    if (PACKAGING == undefined && optional_early_instance_dir == undefined) throw Error('Config not yet initialized.');

    const component_versions = new Map();
    optional_early_instance_dir = optional_early_instance_dir || PACKAGING?.RELATIVE_INSTANCE_DIRECTORY;
    if (optional_early_instance_dir == undefined) throw Error('Missing rel dir.');

    if (!Bun.file(optional_early_instance_dir + 'mmc-pack.json').exists()) {
        console.warn(
            'W: Missing mmc-pack.json at RELATIVE_INSTANCE_DIRECTORY (',
            optional_early_instance_dir,
            '), not attaching mmc-component versions.',
        );
        return component_versions;
    }

    const mmc_json = await Bun.file(optional_early_instance_dir + 'mmc-pack.json').json();
    if (mmc_json && mmc_json.components && Array.isArray(mmc_json.components) && mmc_json.components.length > 0) {
        for (const component of mmc_json.components) {
            if (component.uid && component.version) {
                component_versions.set(component.uid, component.version);
            } else {
                console.warn('W: Component entry ', component, ' in mmc-pack.json is malformed, not including in manifest.');
            }
        }
    }

    return component_versions;
}

//#region bundling
export async function bundle_pack_into_starter() {
    if (PACKAGING == undefined) throw Error('Config not yet initialized.');

    const files: {
        relative_path: string;
        path_inside_zip: string;
    }[] = [];
    for (const include_item of PACKAGING.FORCE_INCLUDE_PATHS) {
        if (await Bun.file(include_item.relative_path).exists()) {
            files.push({
                relative_path: include_item.relative_path,
                path_inside_zip: include_item.include_as,
            });
        } else {
            if (path_is_directory(include_item.relative_path)) {
                for (const file of sync(include_item.relative_path + '/**/*', { onlyFiles: true, deep: 10, globstar: true })) {
                    files.push({
                        relative_path: file,
                        path_inside_zip: file.replace(include_item.relative_path, include_item.include_as),
                    });
                }
            } else {
                console.warn('W: FORCE_INCLUDE_PATH item ', include_item.relative_path, ' does not exist on disk, not including.');
            }
        }
    }

    console.info(`Writing ${files.length} files to zip at ${PACKAGING.RELATIVE_INSTANCE_DIRECTORY + 'starter.zip'} ...`)
    await bundle_files_to_zip(files, PACKAGING.RELATIVE_INSTANCE_DIRECTORY + 'starter.zip');
}
