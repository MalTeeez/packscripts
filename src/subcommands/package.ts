import inquirer from 'inquirer';
import fs from 'fs';
import { MOD_BASE_DIR, PACKAGING, setConfigKeys } from '../utils/config';
import { mkdir } from 'node:fs/promises';
import { download_file } from '../utils/fetch';
import { expandOid, readBlob, resolveRef, TREE, walk } from 'isomorphic-git';
import { bundle_files_to_zip, path_is_directory } from '../utils/fs';
import { sync } from 'fast-glob';
import { CLIColor, finish_live_zone, hash_buffer, init_live_zone, update_live_zone } from '../utils/utils';

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

interface manifest_json {
    unsup_manifest: string;
    name: string;
    versions: {
        current: {
            name: string;
            code: number;
        };
        history: {
            name: string;
            code: number;
        }[];
    };
}

interface version_json {
    unsup_manifest: string;
    hash_function: string;
    changes: {
        path: string;
        from_hash: string | null;
        from_size: number;
        to_hash: string | null;
        to_size: number;
        url?: string;
    }[];
    component_versions: {
        [key: string]: string;
    };
}

//#region git worker pool
function create_worker_pool(total: number, worker_count: number) {
    let completed = 0;
    const worker_status = Array.from({ length: worker_count }, () => 'idle');

    const render = () => {
        const bar_width = 40;
        const filled = Math.round((completed / total) * bar_width);
        const bar = CLIColor.FgGreen + '█'.repeat(filled) + CLIColor.FgGray8 + '░'.repeat(bar_width - filled) + CLIColor.Reset;
        const percent = String(Math.round((completed / total) * 100)).padStart(3);
        const progress_line = `  ${bar} ${CLIColor.FgWhite}${percent}%${CLIColor.Reset} ${CLIColor.FgGray11}(${completed}/${total})${CLIColor.Reset}`;

        update_live_zone([
            progress_line,
            '',
            ...worker_status.map((status, i) => {
                if (status === 'idle') {
                    return `  ${CLIColor.FgGray8}worker ${i + 1}  idle${CLIColor.Reset}`;
                }
                const [change_type, ...rest] = status.split(' ');
                const filepath = rest.join(' ');
                const type_color =
                    change_type === 'added'
                        ? CLIColor.FgGreen
                        : change_type === 'deleted'
                          ? CLIColor.FgRed
                          : change_type === 'modified'
                            ? CLIColor.FgYellow
                            : CLIColor.FgCyan;
                const label = filepath
                    ? `${type_color}${change_type}${CLIColor.Reset}  ${CLIColor.FgGray15}${filepath}${CLIColor.Reset}`
                    : `${type_color}${change_type}${CLIColor.Reset}`;
                return `  ${CLIColor.FgCyan}worker ${i + 1}${CLIColor.Reset}  ${label}`;
            }),
        ]);
    };

    const set_status = (worker_id: number, status: string) => {
        worker_status[worker_id] = status;
        render();
    };

    const complete = (worker_id: number) => {
        completed++;
        worker_status[worker_id] = 'idle';
        render();
    };

    const start = () => {
        init_live_zone(worker_count + 2);
        render();
    };

    const finish = (summary: string) => {
        finish_live_zone();
        console.info(summary);
    };

    return { start, finish, set_status, complete };
}

//#region general helpers
async function is_git_available(dir: string): Promise<boolean> {
    try {
        const proc = Bun.spawn(['git', 'rev-parse', '--git-dir'], { cwd: dir });
        return (await proc.exited) === 0;
    } catch {
        console.warn('W: For some (weird) reason, git is not availble in this cli context. Falling back to slower approach.');
        return false;
    }
}

async function process_blob(dir: string, oid: string): Promise<{ hash: string | undefined; size: number }> {
    const [hashProc, sizeProc] = await Promise.all([
        Bun.spawn(['bash', '-c', `git cat-file blob ${oid} | sha256sum`], { cwd: dir, stdout: 'pipe' }),
        Bun.spawn(['git', 'cat-file', '-s', oid], { cwd: dir, stdout: 'pipe' }),
    ]);

    const [hashOut, sizeOut] = await Promise.all([new Response(hashProc.stdout).text(), new Response(sizeProc.stdout).text()]);

    await Promise.all([hashProc.exited, sizeProc.exited]);

    return {
        hash: hashOut.trim().split(' ')[0],
        size: parseInt(sizeOut.trim(), 10),
    };
}

interface PackVersion {
    actual_name: string;
    name: string;
    code: number;
    hash: string;
}

async function read_unsup_versions_from_manifest(): Promise<{ current: PackVersion; history: PackVersion[] }> {
    if (PACKAGING == undefined) throw Error('Config not yet initialized.');

    const file = Bun.file(PACKAGING.PACKAGE_DIRECTORY + '/manifest.json');
    if (!(await file.exists())) {
        throw Error(`Unsup manifest at ${file.name} is missing.`);
    }

    const manifest_content: manifest_json = await file.json();
    function get_version_obj_from_entry(entry: { name: string; code: number }): PackVersion | undefined {
        const match = entry.name.match(/(.+?) \((\w+)\)/);
        if (match && match.length == 3 && match[1] && match[2]) {
            return {
                actual_name: entry.name,
                code: entry.code,
                name: match[1],
                hash: match[2],
            };
        } else {
            throw Error("Unsup manifest has faulty versions - format should be of 'version (short commit sha)', is: " + entry.name);
        }
    }

    const current_version = get_version_obj_from_entry(manifest_content.versions.current);
    const history_versions = manifest_content.versions.history.map(get_version_obj_from_entry);

    [current_version, ...history_versions].forEach((version) => {
        if (version == undefined) {
            throw Error("Unsup manifest has faulty versions - format should be of 'version (short commit sha)'");
        }
    });

    return {
        current: current_version as PackVersion,
        history: history_versions as PackVersion[],
    };
}

async function resolve_to_correct_git_ref(initial_ref: string): Promise<string> {
    if (PACKAGING == undefined) throw Error('Config not yet initialized.');

    try {
        return await resolveRef({ fs: fs, dir: PACKAGING.RELATIVE_INSTANCE_DIRECTORY, ref: initial_ref });
    } catch {
        try {
            return await expandOid({ fs: fs, dir: PACKAGING.RELATIVE_INSTANCE_DIRECTORY, oid: initial_ref });
        } catch {
            throw Error(`ERR: Failed to resolve git ref ${initial_ref} to a valid git ref.`);
        }
    }
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
            if (component.uid && (component.version || component.cachedVersion)) {
                component_versions.set(component.uid, component.version || component.cachedVersion);
            } else {
                console.warn('W: Component entry ', component, ' in mmc-pack.json is malformed, not including in manifest.');
            }
        }
    }

    return component_versions;
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
        TRACK_INCLUDE_PATHS: Array<string>;
        FORCE_INCLUDE_PATHS: Array<{
            relative_path: string;
            include_as: string;
        }>;
        EXCLUDE_FROM_INCLUDE_PATHS: Array<string>;
        EXCLUDE_PATTERNS: Array<string>;
        MAX_WORKER_THREADS: number;
    } = {
        PACK_NAME: answers.PACK_NAME,
        PACKAGE_DIRECTORY: packaging_dir,
        RELATIVE_INSTANCE_DIRECTORY: relative_instance_directory,
        REMOTE_MANIFEST_PROJECT: answers.REMOTE_MANIFEST_PROJECT.replace(/\/$/m, ''),
        TRACK_INCLUDE_PATHS: [
            mc_dir + 'mods',
            mc_dir + 'config',
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
        MAX_WORKER_THREADS: 10,
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
            "name": "initial",
            "code": 1
        },
        "history": []
    }
}`,
    );

    await Bun.file(relative_instance_directory + answers.PACKAGE_DIRECTORY.replace(/\/$/m, '') + '/instance.cfg').write(
        `[General]
ConfigVersion=1.3
iconKey=default
name=${packaging_config.PACK_NAME}
InstanceType=OneSix
OverrideJavaArgs=true
JvmArgs=-javaagent:unsup.jar

[Java]
OverrideJava=true
JvmArgs=-javaagent:unsup.jar`,
    );

    // Write config back to file
    await setConfigKeys({ PACKAGING: packaging_config });

    console.info(
        `\nWrote initial setup to ${packaging_dir}. 
        Before continuing, check your config.json for any paths that should be included / excluded. 
        Afterwards, create your first version with "packscripts package bootstrap".
        To distribute your pack, bundle your pack with "packscripts package bundle" and import it into prism.
        To release new versions, build them with "packscripts package build" and push the generated manifests to your remote provider.`,
    );
}

//#region bootstrapping
export async function build_bootstrap(commit_sha: string, tag: string | undefined) {
    if (PACKAGING == undefined) {
        console.error("ERR: Missing config settings for packaging. Make sure to run 'packscripts package init' first.");
        return;
    }

    commit_sha = await resolve_to_correct_git_ref(commit_sha);
    const short_commit_sha = commit_sha.slice(0, 7);

    const file_oids: Map<string, string> = new Map();
    await walk({
        fs: fs,
        dir: PACKAGING.RELATIVE_INSTANCE_DIRECTORY,
        trees: [TREE({ ref: commit_sha })],
        map: async (filepath, [entry]) => {
            if (!entry) return null;
            const type = await entry.type();
            if (type === 'tree') return undefined;
            file_oids.set(filepath, await entry.oid());
            return null;
        },
    });

    console.info('Building bootstrap for git ref ', commit_sha, ' from ', file_oids.size, ' git objects...');
    const packaging_plan = filter_and_plan_files(Object.fromEntries(file_oids.keys().map((key) => [key, { relative_path: key }])));
    const target_remote_url = PACKAGING.REMOTE_MANIFEST_PROJECT.replace(/[^\/]+?$/m, '') + commit_sha;

    const git_available = await is_git_available(PACKAGING.RELATIVE_INSTANCE_DIRECTORY);
    const file_refs: { path: string; hash: string; size: number; url: string }[] = [];
    const WORKER_COUNT = Math.min(PACKAGING.MAX_WORKER_THREADS, 10);
    const pool = create_worker_pool(packaging_plan.length, WORKER_COUNT);
    pool.start();

    const queue = [...packaging_plan];
    const workers = Array.from({ length: WORKER_COUNT }, async (_, worker_id) => {
        while (queue.length > 0) {
            const plan_item = queue.shift()!;
            if (PACKAGING == undefined) throw Error('Config was initialized but is not available off-thread? Something is wrong.');

            const direct_path = plan_item.relative_path.replace(PACKAGING.RELATIVE_INSTANCE_DIRECTORY, '');
            pool.set_status(worker_id, direct_path);

            const file_oid = file_oids.get(direct_path);

            let blob_hash = undefined;
            let blob_size = 0;
            if (git_available && file_oid != undefined) {
                ({ hash: blob_hash, size: blob_size } = await process_blob(PACKAGING.RELATIVE_INSTANCE_DIRECTORY, file_oid));
            }
            // Fallback to builtin if that didnt work
            if (blob_hash == undefined) {
                const { blob } =
                    file_oid != undefined
                        ? await readBlob({ fs, dir: PACKAGING.RELATIVE_INSTANCE_DIRECTORY, oid: file_oid })
                        : await readBlob({ fs, dir: PACKAGING.RELATIVE_INSTANCE_DIRECTORY, oid: commit_sha, filepath: direct_path });
                blob_hash = await hash_buffer(blob);
                blob_size = blob.byteLength;
            }

            file_refs.push({
                path: direct_path,
                hash: blob_hash,
                size: blob_size,
                url: target_remote_url + '/' + encodeURI(direct_path),
            });

            pool.complete(worker_id);
        }
    });

    await Promise.all(workers);
    pool.finish(`${CLIColor.FgGreen}✓${CLIColor.Reset} Built bootstrap with ${CLIColor.FgWhite}${file_refs.length}${CLIColor.Reset} files.`);

    const main_manifest: manifest_json = await Bun.file(PACKAGING.PACKAGE_DIRECTORY + '/manifest.json').json();
    let version_code = main_manifest.versions.current.code + 1;

    // This might be the first run, where the version is still "initial". If that is the case, fill it with the same content that the bootstrap will get here.
    if (
        main_manifest.versions.current.name === 'initial' &&
        main_manifest.versions.current.code == 1 &&
        main_manifest.versions.history.length == 0
    ) {
        console.info('This is the initial bootstrap, also building an initial version...');
        const changes: {
            path: string;
            from_hash: string | null;
            from_size: number;
            to_hash: string | null;
            to_size: number;
            url?: string;
        }[] = [];
        for (const item of file_refs) {
            changes.push({
                path: item.path,
                from_hash: null,
                from_size: 0,
                to_hash: item.hash,
                to_size: item.size,
                url: item.url,
            });
        }

        if (tag == undefined) {
            console.info(`No tag defined, using 1.0.0 for initial (${short_commit_sha}).`);
            tag = '1.0.0';
        }
        version_code = 1;

        const version_manifest: version_json = {
            unsup_manifest: 'update-1',
            hash_function: 'SHA-2 256',
            changes: changes,
            component_versions: Object.fromEntries(await collect_mmc_component_versions()),
        };
        main_manifest.versions.current = {
            name: `${tag} (${short_commit_sha})`,
            code: version_code,
        };

        await Bun.file(PACKAGING.PACKAGE_DIRECTORY + `/versions/1.json`).write(JSON.stringify(version_manifest, null, 4));
        await Bun.file(PACKAGING.PACKAGE_DIRECTORY + '/manifest.json').write(JSON.stringify(main_manifest, null, 4));
    }

    const manifest_versions = await read_unsup_versions_from_manifest();
    const all_versions = [manifest_versions.current, ...manifest_versions.history];
    const manifest_version_of_tag = all_versions.find((version) => version.name === tag);
    const manifest_version_of_commit = all_versions.find((version) => version.hash === short_commit_sha);

    if (manifest_version_of_tag != undefined) {
        // This tag exists in the manifest — does its hash match?
        if (manifest_version_of_tag.hash === short_commit_sha) {
            // Exact match on both tag and commit — reuse the existing code and tag
            version_code = manifest_version_of_tag.code;
            tag = manifest_versions.current.name;
        } else {
            // Same tag name, different commit — mark dirty
            tag = manifest_version_of_tag.name + '-dirty';
        }
    } else if (manifest_version_of_commit != undefined) {
        // Tag not found, but this commit is already recorded under a different tag — reuse its code
        version_code = manifest_version_of_commit.code;
        tag = manifest_version_of_commit.name;
    } else {
        // Neither tag nor commit found in the manifest — fall back to current + -dirty
        tag = manifest_versions.current.name + '-dirty';
    }

    console.info(`Using tag ${tag} at ${short_commit_sha} (${version_code}) for bootstrap manifest.`);
    const bootstrap_manifest: bootstrap_json = {
        unsup_manifest: 'bootstrap-1',
        version: {
            name: `${tag} (${short_commit_sha})`,
            code: version_code,
        },
        hash_function: 'SHA-2 256',
        files: file_refs,
    };

    await Bun.write(PACKAGING.PACKAGE_DIRECTORY + '/bootstrap.json', JSON.stringify(bootstrap_manifest, null, 4));
    console.info(`Built & saved bootstrap manifest with ${packaging_plan.length} items!`);
}

/**
 * This function filters an array (in form of a record) by paths (its keys)
 * @param files A record, where the key if the path.
 * @returns The value of the record will be returned in a list if it passes the filter.
 */
function filter_and_plan_files<T>(files: Record<string, T>): Array<T> {
    if (PACKAGING == undefined) throw Error('Config not yet initialized.');

    const mod_dir_is_relative = MOD_BASE_DIR.startsWith(PACKAGING.RELATIVE_INSTANCE_DIRECTORY);
    const exclude_patterns = PACKAGING.EXCLUDE_PATTERNS.map((pattern) => RegExp(pattern, 'm'));
    const filtered_files: Array<T> = [];
    for (const [file, obj] of Object.entries(files)) {
        let relative_path;
        if (!file.startsWith(PACKAGING.RELATIVE_INSTANCE_DIRECTORY) && mod_dir_is_relative) {
            relative_path = PACKAGING.RELATIVE_INSTANCE_DIRECTORY + file;
        } else {
            relative_path = file;
        }

        let include_obj: T | undefined = undefined;
        for (const path_filter of [...PACKAGING.TRACK_INCLUDE_PATHS, ...PACKAGING.FORCE_INCLUDE_PATHS.map((item) => item.relative_path)]) {
            if (relative_path.startsWith(path_filter)) {
                include_obj = obj;
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

//#region bundling
export async function bundle_pack_into_starter() {
    if (PACKAGING == undefined) {
        console.error("ERR: Missing config settings for packaging. Make sure to run 'packscripts package init' first.");
        return;
    }

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

    console.info(`Writing ${files.length} files to zip at ${PACKAGING.RELATIVE_INSTANCE_DIRECTORY + 'starter.zip'} ...`);
    await bundle_files_to_zip(files, PACKAGING.RELATIVE_INSTANCE_DIRECTORY + 'starter.zip');
}

//#region building
export async function build_version_for_diff(target_commit_sha: string, base_commit_sha: string | undefined, tag: string | undefined) {
    if (PACKAGING == undefined) {
        console.error("ERR: Missing config settings for packaging. Make sure to run 'packscripts package init' first.");
        return;
    }

    const main_manifest: manifest_json = await Bun.file(PACKAGING.PACKAGE_DIRECTORY + '/manifest.json').json();
    if (main_manifest.versions.current.name === 'initial') {
        console.error(
            `ERR: Tried to build version without first initializing base bootstrap. Make sure to initially create a base version with "packscripts package bootstrap".`,
        );
        return;
    }

    const versions = await read_unsup_versions_from_manifest();

    if (base_commit_sha == undefined) {
        console.info('No base commit specified, selecting from latest...');
        base_commit_sha = await resolve_to_correct_git_ref(versions.current.hash);
        console.info(`Using commit ${base_commit_sha} (${versions.current.name} - ${versions.current.code}) as base`);
    }

    target_commit_sha = await resolve_to_correct_git_ref(target_commit_sha);
    if (base_commit_sha === target_commit_sha) {
        console.warn(
            `W: The newest available ref (${target_commit_sha}) is already available under ${versions.current.name}, refusing to build version without changes.`,
        );
        return;
    }

    console.info(`Building diff between ${base_commit_sha.slice(0, 7)} and ${target_commit_sha.slice(0, 7)} ...`);

    const diffs: { filepath: string; status: 'added' | 'deleted' | 'modified'; old_oid: string | undefined; new_oid: string | undefined }[] =
        await walk({
            fs: fs,
            dir: PACKAGING.RELATIVE_INSTANCE_DIRECTORY,
            trees: [TREE({ ref: base_commit_sha }), TREE({ ref: target_commit_sha })],
            map: async (filepath, [a, b]) => {
                if (filepath === '.') return;

                const type = await (a ?? b)?.type();
                if (type === 'tree') return;

                const a_oid = await a?.oid();
                const b_oid = await b?.oid();

                if (a_oid === b_oid) return;

                return {
                    filepath,
                    status: !a ? 'added' : !b ? 'deleted' : 'modified',
                    old_oid: a_oid,
                    new_oid: b_oid,
                };
            },
        });

    // Filter by filepaths
    const filtered_diffs = filter_and_plan_files(Object.fromEntries(diffs.map((item) => [item.filepath, item])));

    console.info(`Building list of changes from ${filtered_diffs.length} diffs...`);
    // Remove branch / git ref from remote url and use the target ref
    const target_remote_url = PACKAGING.REMOTE_MANIFEST_PROJECT.replace(/[^\/]+?$/m, '') + target_commit_sha;

    const changes: {
        path: string;
        from_hash: string | null;
        from_size: number;
        to_hash: string | null;
        to_size: number;
        url?: string;
    }[] = [];

    const WORKER_COUNT = Math.min(PACKAGING.MAX_WORKER_THREADS, 4);
    const pool = create_worker_pool(filtered_diffs.length, WORKER_COUNT);
    pool.start();

    const queue = [...filtered_diffs];
    const workers = Array.from({ length: WORKER_COUNT }, async (_, worker_id) => {
        while (queue.length > 0) {
            const item = queue.shift()!;
            if (PACKAGING == undefined) throw Error('Config was initialized but is not available off-thread? Something is wrong.');

            pool.set_status(worker_id, `${item.status} ${item.filepath}`);

            if (item.status === 'added') {
                const { blob } = await readBlob({
                    fs: fs,
                    dir: PACKAGING.RELATIVE_INSTANCE_DIRECTORY,
                    oid: item.new_oid || target_commit_sha,
                    ...(item.new_oid == undefined && { filepath: item.filepath }),
                });
                changes.push({
                    path: item.filepath,
                    from_hash: null,
                    from_size: 0,
                    to_hash: await hash_buffer(blob),
                    to_size: blob.byteLength,
                    url: target_remote_url + '/' + encodeURI(item.filepath),
                });
            } else if (item.status === 'deleted') {
                const { blob } = await readBlob({
                    fs: fs,
                    dir: PACKAGING.RELATIVE_INSTANCE_DIRECTORY,
                    oid: item.old_oid || base_commit_sha,
                    ...(item.old_oid == undefined && { filepath: item.filepath }),
                });
                changes.push({
                    path: item.filepath,
                    from_hash: await hash_buffer(blob),
                    from_size: blob.byteLength,
                    to_hash: null,
                    to_size: 0,
                });
            } else if (item.status === 'modified') {
                const [{ blob: old_blob }, { blob: new_blob }] = await Promise.all([
                    readBlob({
                        fs: fs,
                        dir: PACKAGING.RELATIVE_INSTANCE_DIRECTORY,
                        oid: item.old_oid || base_commit_sha,
                        ...(item.old_oid == undefined && { filepath: item.filepath }),
                    }),
                    readBlob({
                        fs: fs,
                        dir: PACKAGING.RELATIVE_INSTANCE_DIRECTORY,
                        oid: item.new_oid || target_commit_sha,
                        ...(item.new_oid == undefined && { filepath: item.filepath }),
                    }),
                ]);
                changes.push({
                    path: item.filepath,
                    from_hash: await hash_buffer(old_blob),
                    from_size: old_blob.byteLength,
                    to_hash: await hash_buffer(new_blob),
                    to_size: new_blob.byteLength,
                    url: target_remote_url + '/' + encodeURI(item.filepath),
                });
            } else {
                throw Error('Encountered an unrecognized git change while building changes from diff: ' + item);
            }

            pool.complete(worker_id);
        }
    });

    await Promise.all(workers);
    pool.finish(
        `${CLIColor.FgGreen}✓${CLIColor.Reset} Built ${CLIColor.FgWhite}${changes.length}${CLIColor.Reset} changes — ${CLIColor.FgGreen}${changes.filter((c) => c.from_hash === null).length} added${CLIColor.Reset}, ${CLIColor.FgYellow}${changes.filter((c) => c.from_hash !== null && c.to_hash !== null).length} modified${CLIColor.Reset}, ${CLIColor.FgRed}${changes.filter((c) => c.to_hash === null).length} deleted${CLIColor.Reset}.`,
    );

    const version_code = versions.current.code + 1;
    if (tag == undefined) {
        console.info('No version tag specified, incrementing patch version from latest...');
        const patch_match = versions.current.name.match(/(\d+)([^0-9]*)$/m);
        if (patch_match && patch_match[1] != undefined && !Number.isNaN(Number(patch_match[1]))) {
            const next_patch = Number(patch_match[1]) + 1;
            const suffix = patch_match[2] ?? '';
            tag = versions.current.name.replace(/(\d+)([^0-9]*)$/m, () => String(next_patch) + suffix);
        } else {
            tag = versions.current.name + '.' + version_code;
        }
        console.info(`Using tag '${tag}' for version ${version_code}.`);
    }

    const version_manifest: version_json = {
        unsup_manifest: 'update-1',
        hash_function: 'SHA-2 256',
        changes: changes,
        component_versions: Object.fromEntries(await collect_mmc_component_versions()),
    };
    main_manifest.versions.history.push(main_manifest.versions.current);
    main_manifest.versions.current = {
        name: `${tag} (${target_commit_sha.slice(0, 7)})`,
        code: version_code,
    };

    await Bun.file(PACKAGING.PACKAGE_DIRECTORY + `/versions/${version_code}.json`).write(JSON.stringify(version_manifest, null, 4));
    await Bun.file(PACKAGING.PACKAGE_DIRECTORY + '/manifest.json').write(JSON.stringify(main_manifest, null, 4));
    console.info(`Built & saved manifests for version ${tag}!`);
}
