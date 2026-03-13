import { getUpdateFrequencyOrdinal, read_saved_mods, type mod_object, type SourceType, type update_frequency } from '../utils/mods';
import {
    CLIColor,
    compare_versions,
    finish_live_zone,
    init_live_zone,
    is_finished,
    live_log,
    rev_replace_all,
    update_live_zone,
} from '../utils/utils';
import { glob_files_in_dir, read_arr_from_file, save_list_to_file, save_map_to_file } from '../utils/fs';
import { mkdir, rename } from 'node:fs/promises';
import { ANNOTATED_FILE, DOWNLOAD_TEMP_DIR, DOWNLOAD_UNDO_DIR, GITHUB_API_KEY, MOD_BASE_DIR } from '../utils/consts';
import { download_file, print_gh_ratelimits, query_gh_project_by_url } from '../utils/fetch';
import { toNamespacedPath } from 'node:path';

const SOURCE_API_KEYS: Map<SourceType, string> = new Map();

export async function check_all_mods_for_updates(
    options: {
        retry_failed: boolean;
        frequency_range: update_frequency;
        force_downgrade: boolean;
    } = {
        retry_failed: false,
        frequency_range: 'COMMON',
        force_downgrade: false,
    },
    dry: boolean = true,
    mod_map?: Map<string, mod_object>,
) {
    if (GITHUB_API_KEY == undefined) {
        // can't throw in ternary
        throw Error('Missing GITHUB_API_KEY.');
    } else {
        SOURCE_API_KEYS.set('GH_RELEASE', GITHUB_API_KEY);
    }

    mod_map = mod_map == undefined ? await read_saved_mods(ANNOTATED_FILE) : mod_map;
    const fetch_map: Map<
        string,
        {
            mod_obj: mod_object;
            res: Promise<
                | {
                      status: string;
                      version: string;
                      file_name: string;
                      file_url: string;
                      source_api_key: string;
                  }
                | undefined
            >;
        }
    > = new Map();
    let longest_mod_id_length = 0;

    for (const [mod_id, mod_obj] of mod_map.entries()) {
        // Skip this mod if errored on a previous check and retry is off
        if (mod_obj.update_state.last_status !== '200' && !options.retry_failed) continue;
        // Skip this mod if its update frequency is below the provided threshold
        if (getUpdateFrequencyOrdinal(mod_obj.update_state.frequency) > getUpdateFrequencyOrdinal(options.frequency_range)) continue;
        // Skip this mod if it has updates disabled
        if (mod_obj.update_state.disable_check) continue;

        longest_mod_id_length = Math.max(mod_id.length, longest_mod_id_length);
        if (mod_obj.source) {
            const source_api_key = SOURCE_API_KEYS.get(mod_obj.update_state.source_type);
            if (source_api_key) {
                fetch_map.set(mod_id, { mod_obj, res: check_url_for_updates(mod_obj, mod_obj.source, source_api_key) });
            }
        }
    }

    longest_mod_id_length++;
    let version_length = 20;
    let to_update_mods: {
        mod_id: string;
        mod_obj: mod_object;
        remote_version: string;
        file_name: string;
        file_url: string;
        source_api_key: string;
    }[] = [];

    for (const [mod_id, { mod_obj, res }] of fetch_map.entries()) {
        const content = await res;
        if (content != undefined) {
            const mod_version = mod_obj.update_state.version || '0';
            const { version: remote_version, status, file_name, file_url, source_api_key } = content;
            const id_padding_len = longest_mod_id_length - mod_id.length;
            const vers_padding_len = version_length - Math.min(mod_version.length, version_length);
            const version_change = compare_versions(mod_version, remote_version);
            let change_string = `${CLIColor.FgBlack}-${CLIColor.Reset}`;

            if (version_change == -1) {
                to_update_mods.push({ mod_id, mod_obj, remote_version, file_url, file_name, source_api_key });
                change_string = `${CLIColor.FgGreen}↑${CLIColor.Reset}`;
            } else if (version_change == 1) {
                change_string = `${CLIColor.FgYellow}↓${CLIColor.Reset}`;
                if (options.force_downgrade) {
                    to_update_mods.push({ mod_id, mod_obj, remote_version, file_url, file_name, source_api_key });
                }
            }

            console.log(
                ` ${CLIColor.FgGray}-${CLIColor.Reset} ${mod_id} ${CLIColor.FgGray}${rev_replace_all(' '.repeat(id_padding_len), '   ', ' . ')}` +
                    ` ${CLIColor.FgGray}${CLIColor.Bright}${mod_version}${CLIColor.Reset}${CLIColor.FgGray}${rev_replace_all(' '.repeat(vers_padding_len), '   ', ' . ')}` +
                    ` ${CLIColor.Reset}${CLIColor.Bright}${change_string}${CLIColor.Reset}${CLIColor.FgGray}  .  ${CLIColor.Reset}${remote_version}`,
            );
            // Update mod_map with status of request
            mod_obj.update_state.last_status = status;
        }
    }
    console.log(
        `\n ${CLIColor.FgWhite}${CLIColor.Bright}${to_update_mods.length}${CLIColor.Reset}${CLIColor.FgGray} of ${CLIColor.FgWhite}${CLIColor.Bright}${mod_map.size}${CLIColor.Reset}${CLIColor.FgGray} mods can be upgraded. ` +
            `${CLIColor.FgGray}(${CLIColor.FgGreen}${to_update_mods.filter(({ mod_obj }) => mod_obj.update_state.source_type === 'GH_RELEASE').length}${CLIColor.FgGray} from ${CLIColor.FgWhite}GitHub${CLIColor.FgGray}, ` +
            `${CLIColor.FgGreen}${to_update_mods.filter(({ mod_obj }) => mod_obj.update_state.source_type === 'CURSEFORGE').length}${CLIColor.FgGray} from ${CLIColor.FgWhite}Curseforge${CLIColor.FgGray}, ` +
            `${CLIColor.FgGreen}${to_update_mods.filter(({ mod_obj }) => mod_obj.update_state.source_type === 'MODRINTH').length}${CLIColor.FgGray} from ${CLIColor.FgWhite}Modrinth${CLIColor.FgGray})` +
            `${CLIColor.Reset}${dry ? `${CLIColor.FgGray}  -  ${CLIColor.Reset}Upgrade with ${CLIColor.FgCyan9}--upgrade${CLIColor.Reset}` : ''}\n`,
    );

    // Save http status codes returned from sources back to map for next time
    await save_map_to_file(ANNOTATED_FILE, mod_map);

    // to_update_mods = to_update_mods.slice(0, 2);

    // If this is not a dry run and there are mods to download, actually download them
    if (to_update_mods.length > 0 && !dry) {
        const DOWNLOAD_BATCH_SIZE = 5;

        // Prepare temp directories
        await mkdir(DOWNLOAD_TEMP_DIR, { recursive: true }).catch((err) => {
            console.error(`Failed to create temporary download directory at ${toNamespacedPath(DOWNLOAD_TEMP_DIR)}`);
            throw err;
        });
        await mkdir(DOWNLOAD_UNDO_DIR, { recursive: true }).catch((err) => {
            console.error(`Failed to create temporary download directory at ${toNamespacedPath(DOWNLOAD_TEMP_DIR)}`);
            throw err;
        });

        let running_updates = 0;
        let completed_dls = 0;
        const full_dls = to_update_mods.length;
        const download_map: Map<
            string,
            { response: Promise<string>; remote_version: string; start_time: number; file_name: string; is_base_required: boolean }
        > = new Map();
        const downloaded_mods: Map<string, { remote_version: string; file_name: string; is_base_required: boolean }> = new Map();
        console.log(`Upgrading ${full_dls} mods...`);

        init_live_zone(2);
        while (download_map.size > 0 || to_update_mods.length > 0) {
            const progress = Math.ceil(((completed_dls / full_dls) * 100) / 2);
            update_live_zone([
                `|${CLIColor.FgWhite}${'='.repeat(progress)}${CLIColor.FgGray}${'-'.repeat(50 - progress)}${CLIColor.Reset}|`,
                `Upgrading mods - ${CLIColor.FgWhite}${completed_dls}${CLIColor.FgGray} of ${CLIColor.FgWhite}${full_dls}${CLIColor.Reset}`,
            ]);

            // If we have empty download slots, fill them with new downloads
            if (running_updates < DOWNLOAD_BATCH_SIZE) {
                for (let i = 0; i < DOWNLOAD_BATCH_SIZE - running_updates; i++) {
                    const to_download_mod = to_update_mods.pop();
                    if (to_download_mod != undefined) {
                        // console.log(`Downloading ${to_download_mod.mod_id} from ${to_download_mod.file_url}...`);
                        download_map.set(to_download_mod.mod_id, {
                            response: download_file(
                                to_download_mod.file_url,
                                to_download_mod.mod_obj.update_state.source_type,
                                DOWNLOAD_TEMP_DIR,
                                to_download_mod.file_name,
                                to_download_mod.source_api_key,
                            ),
                            remote_version: to_download_mod.remote_version,
                            start_time: Date.now(),
                            file_name: to_download_mod.file_name,
                            is_base_required: to_download_mod.mod_obj.tags?.includes('REQUIRED_BASE') || false,
                        });
                        running_updates++;
                    }
                }
            }

            const finished_dls: string[] = [];
            for (const [mod_id, { response, remote_version, start_time, file_name, is_base_required }] of download_map.entries()) {
                if (await is_finished(response)) {
                    const id_padding_len = longest_mod_id_length - mod_id.length;
                    let state_string = '?';

                    await response
                        .then((status) => (state_string = `${CLIColor.FgGreen}✔`))
                        .catch((status) => {
                            live_log(status, console.warn);
                            state_string = `${CLIColor.FgRed}✖${CLIColor.Reset}`;
                        });

                    live_log(
                        ` ${CLIColor.FgGray}-${CLIColor.Reset} ${mod_id} ${CLIColor.FgGray}${rev_replace_all(' '.repeat(id_padding_len), '   ', ' . ')}` +
                            ` ${CLIColor.Reset}${CLIColor.Bright}${state_string}${CLIColor.Reset}`,
                    );

                    downloaded_mods.set(mod_id, { file_name, remote_version, is_base_required });
                    completed_dls++;
                    running_updates--;
                    finished_dls.push(mod_id);
                } else {
                    if (Date.now() - start_time > 20000) {
                        live_log(`W: Mod ${mod_id} has been downloading for more than 20 seconds - stalled?`, console.warn);
                    }
                }
            }
            finished_dls.forEach((mod_id) => download_map.delete(mod_id));
        }
        const progress = Math.ceil(((completed_dls / full_dls) * 100) / 2);
        update_live_zone([
            `|${CLIColor.FgWhite}${'='.repeat(progress)}${CLIColor.FgGray}${'-'.repeat(50 - progress)}${CLIColor.Reset}|`,
            `Downloading mods${CLIColor.FgGray} - ${CLIColor.FgWhite}${completed_dls}${CLIColor.FgGray} of ${CLIColor.FgWhite}${full_dls}${CLIColor.Reset}`,
        ]);
        finish_live_zone();

        console.log('Finished downloading all mods!\n');

        // Replace the mod jars
        if (downloaded_mods.size > 0) {
            const undo_list: Array<{ mod_id: string; old_file: string; new_file: string; old_version: string }> = [];
            // Clear old update undo jars
            (await glob_files_in_dir(DOWNLOAD_UNDO_DIR, /\.jar(?:\.disabled)?$/m, false)).forEach(
                async (file) =>
                    await Bun.file(file)
                        .delete()
                        .catch(() => console.warn('W: Failed to delete leftover update-undo mod ' + file)),
            );

            for (const [mod_id, { file_name, remote_version, is_base_required }] of downloaded_mods.entries()) {
                const mod = mod_map.get(mod_id);
                if (mod && (await Bun.file(`${DOWNLOAD_TEMP_DIR}/${file_name}`).exists())) {
                    const old_mod_jar = mod.file_path.replace(RegExp(String.raw`${MOD_BASE_DIR}.*\/`), '');
                    const new_mod_path = `${MOD_BASE_DIR}/${file_name + (mod.enabled ? '' : '.disabled')}`;

                    await rename(mod.file_path, `${DOWNLOAD_UNDO_DIR}/${old_mod_jar}`).catch((err) => {
                        console.warn(`W: Failed to move the older jar for mod ${mod_id} from the mod dir into the undo dir. Won't be able to undo changes for this mod.`);
                    });

                    await rename(`${DOWNLOAD_TEMP_DIR}/${file_name}`, new_mod_path)
                        .then(async () => {
                            if (!(await Bun.file(new_mod_path).exists())) {
                                console.warn(
                                    `W: Failed to move newer file for ${mod_id} (${file_name}) to mod directory. Reverting to previous version.`,
                                );
                                await rename(`${DOWNLOAD_UNDO_DIR}/${old_mod_jar}`, mod.file_path).catch((err) => {
                                    console.warn(`W: Failed to move the older jar for mod ${mod_id} back from the undo dir into the mod dir.`);
                                });
                            } else {
                                if (await Bun.file(`${DOWNLOAD_UNDO_DIR}/${old_mod_jar}`).exists()) {
                                    undo_list.push({
                                        mod_id,
                                        new_file: file_name + (mod.enabled ? '' : '.disabled'),
                                        old_file: old_mod_jar,
                                        old_version: mod.update_state?.version || '',
                                    });
                                }

                                mod.file_path = new_mod_path;
                                mod.update_state.version = remote_version;
                                mod.update_state.last_updated_at = new Date(Date.now()).toISOString();
                                if (is_base_required) {
                                    console.info(
                                        `Mod required by basegame (${mod_id}) was updated. Don't forget to also update it externally, if required.`,
                                    );
                                }
                            }
                        })
                        .catch(() => console.warn(`W: Failed to move updated jar for mod ${mod_id} into the mod directory.`));
                } else if (mod != undefined) {
                    console.warn(`W: Failed to download mod for ${mod_id} for remote asset ${file_name}!`);
                }
            }
            await save_list_to_file(DOWNLOAD_UNDO_DIR + '/update_undo.json', undo_list);
        }

        // Save updated files & versions back to file (only changes when upgrading)
        await save_map_to_file(ANNOTATED_FILE, mod_map);
    }

    // Clean up temp folder
    try {
        // await rmdir(DOWNLOAD_TEMP_DIR, { recursive: true });
    } catch (err) {
        // Folder is probably missing, which is fine
    }

    await print_gh_ratelimits(GITHUB_API_KEY);
}

export async function undo_last_update(mod_map?: Map<string, mod_object>) {
    // Load undo list from undo folder
    const undo_list: Array<{ mod_id: string; old_file: string; new_file: string; old_version: string }> = await read_arr_from_file(
        DOWNLOAD_UNDO_DIR + '/update_undo.json',
    ).catch(() => {
        console.warn('W: Failed to read previous update undo state.');
        return [];
    });

    if (undo_list.length > 0) {
        const undoed_mods: Set<string> = new Set();
        mod_map = mod_map == undefined ? await read_saved_mods(ANNOTATED_FILE) : mod_map;
        for (const { mod_id, new_file, old_file, old_version } of undo_list) {
            const mod = mod_map.get(mod_id);
            if (mod) {
                const restored_old_path = `${MOD_BASE_DIR}/${old_file}`;
                await rename(`${DOWNLOAD_UNDO_DIR}/${old_file}`, restored_old_path)
                    .then(async () => {
                        console.info(`Restored mod ${mod_id} to version ${old_version}.`);
                        await Bun.file(`${MOD_BASE_DIR}/${new_file}`)
                            .delete()
                            .catch(() => console.warn(`W: Failed to delete newer mod file for mod ${mod_id}.`));
                        mod.file_path = restored_old_path;
                        mod.update_state.version = old_version;
                        mod.update_state.last_updated_at = new Date(Date.now()).toISOString();
                        if (mod.tags?.includes('REQUIRED_BASE')) {
                            console.info(
                                `Mod required by basegame (${mod_id}) was un-upgraded. Don't forget to also change it externally if required.`,
                            );
                        }

                        undoed_mods.add(mod_id);
                    })
                    .catch(() => console.warn(`W: Failed to move back the older jar for mod ${mod_id} into the mod directory.`));
            }
        }

        // Save updated files & versions back to file
        await save_map_to_file(ANNOTATED_FILE, mod_map);
        // Remove undoed mods from undo list in file
        await save_list_to_file(
            DOWNLOAD_UNDO_DIR + '/update_undo.json',
            undo_list.filter((entry) => !undoed_mods.has(entry.mod_id)),
        );
    } else {
        console.log("No mods found in last update state, won't be able to undo anything.");
    }
}

async function check_url_for_updates(
    mod_obj: mod_object,
    url: string,
    source_api_key: string,
): Promise<{ status: string; version: string; file_name: string; file_url: string; source_api_key: string } | undefined> {
    if (mod_obj.update_state.source_type === 'GH_RELEASE') {
        const { status, body } = await query_gh_project_by_url(url, source_api_key, '/releases/latest');
        if (status == '200' && body != undefined) {
            const version = body.tag_name;
            let assets: Array<{ url: string; name: string }> = (body.assets as Array<{ [key: string]: string }>).map((asset) => {
                return {
                    url: asset.browser_download_url as string,
                    name: asset.name as string,
                };
            });
            if (assets.length < 1) {
                console.warn('W: Got response with empty assets for: ', url, status);
                return undefined;
            }

            let filtered_assets: Array<{ url: string; name: string }> = [];

            // Use file_pattern if available
            if (assets.length > 1 && mod_obj.update_state.file_pattern != undefined && mod_obj.update_state.file_pattern.length > 0) {
                const pattern = new RegExp(mod_obj.update_state.file_pattern, 'gm');
                for (const asset of assets) {
                    if (asset.name.match(pattern)) {
                        filtered_assets.push(asset);
                    }
                }
                assets = filtered_assets;
                filtered_assets = [];
            }
            // If no file pattern was set, or we still matched multiple jars, remove common suffixes
            if (assets.length > 1) {
                for (const asset of assets) {
                    if (asset.name.endsWith('.jar')) {
                        if (
                            !asset.name.endsWith('-sources.jar') &&
                            !asset.name.endsWith('-dev.jar') &&
                            !asset.name.endsWith('-api.jar') &&
                            !asset.name.endsWith('-preshadow.jar') &&
                            !asset.name.endsWith('-prestub.jar') &&
                            !asset.name.endsWith('-javadoc.jar') &&
                            !asset.name.endsWith('-reobf.jar') &&
                            !asset.name.includes('-panama-') &&
                            !asset.name.includes('-deploader')
                        ) {
                            filtered_assets.push(asset);
                        }
                    }
                }
                assets = filtered_assets;
            }

            let file: string;
            let dl_url: string;
            if (assets.length === 1) {
                file = assets[0]?.name as string;
                dl_url = assets[0]?.url as string;
            } else {
                console.warn(
                    `W: More or less than one asset remaining for ${url}: `,
                    assets.map((asset) => asset.name),
                );
                return undefined;
            }

            return { version: version as string, status, file_name: file, file_url: dl_url, source_api_key };
        } else {
            return undefined;
        }
    }
    return undefined;
}
