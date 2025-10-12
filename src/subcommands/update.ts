import { getUpdateFrequencyOrdinal, read_saved_mods, type mod_object, type update_frequency } from '../utils/mods';
import {
    CLIColor,
    compare_versions,
    finish_live_zone,
    init_live_zone,
    is_finished,
    live_log,
    rev_replace_all,
    update_live_zone,
    type JsonObject,
} from '../utils/utils';
import { GITHUB_API_KEY } from '../../.env.json';
import { rename_file, save_map_to_file } from '../utils/fs';
import { mkdir, rename, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { DOWNLOAD_TEMP_DIR, MOD_BASE_DIR } from '../utils/consts';

export async function check_all_mods_for_updates(
    options: {
        retry_failed: boolean;
        frequency_range: update_frequency;
    } = { retry_failed: false, frequency_range: 'COMMON' },
    dry: boolean = true,
    mod_map?: Map<string, mod_object>,
) {
    mod_map = mod_map == undefined ? await read_saved_mods('./annotated_mods.json') : mod_map;
    const fetch_map: Map<
        string,
        {
            mod_obj: mod_object;
            res: Promise<{ status: string; version?: string; file_name?: string; file_url?: string } | undefined>;
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
            fetch_map.set(mod_id, { mod_obj, res: check_url_for_updates(mod_obj, mod_obj.source) });
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
    }[] = [];

    for (const [mod_id, { mod_obj, res }] of fetch_map.entries()) {
        const content = await res;
        if (content != undefined) {
            const { version: remote_version, status, file_name, file_url } = content;
            if (mod_obj.update_state.version && remote_version && status && file_name && file_url) {
                const id_padding_len = longest_mod_id_length - mod_id.length;
                const vers_padding_len = version_length - Math.min(mod_obj.update_state.version.length, version_length);
                const version_change = compare_versions(mod_obj.update_state.version, remote_version);
                let change_string = `${CLIColor.FgBlack}-${CLIColor.Reset}`;

                if (version_change == -1) {
                    to_update_mods.push({ mod_id, mod_obj, remote_version, file_url, file_name });
                    change_string = `${CLIColor.FgGreen}↑${CLIColor.Reset}`;
                } else if (version_change == 1) {
                    change_string = `${CLIColor.FgYellow}↓${CLIColor.Reset}`;
                }

                console.log(
                    ` ${CLIColor.FgGray}-${CLIColor.Reset} ${mod_id} ${CLIColor.FgGray}${rev_replace_all(' '.repeat(id_padding_len), '   ', ' . ')}` +
                        ` ${CLIColor.FgGray}${CLIColor.Bright}${mod_obj.update_state.version}${CLIColor.Reset}${CLIColor.FgGray}${rev_replace_all(' '.repeat(vers_padding_len), '   ', ' . ')}` +
                        ` ${CLIColor.Reset}${CLIColor.Bright}${change_string}${CLIColor.Reset}${CLIColor.FgGray}  .  ${CLIColor.Reset}${remote_version}`,
                );
            }
            // Update mod_map with status of request
            mod_obj.update_state.last_status = status;
        }
    }
    console.log(
        `\n ${CLIColor.FgWhite}${CLIColor.Bright}${to_update_mods.length}${CLIColor.Reset}${CLIColor.FgGray} of ${CLIColor.FgWhite}${CLIColor.Bright}${mod_map.size}${CLIColor.Reset}${CLIColor.FgGray} mods can be upgraded. ` +
            `${CLIColor.FgGray}(${CLIColor.FgGreen}${to_update_mods.filter(({ mod_obj }) => mod_obj.update_state.source_type === 'GH_RELEASE').length}${CLIColor.FgGray} from ${CLIColor.FgWhite}GitHub${CLIColor.FgGray}, ` +
            `${CLIColor.FgGreen}${to_update_mods.filter(({ mod_obj }) => mod_obj.update_state.source_type === 'CURSEFORGE').length}${CLIColor.FgGray} from ${CLIColor.FgWhite}Curseforge${CLIColor.FgGray}, ` +
            `${CLIColor.FgGreen}${to_update_mods.filter(({ mod_obj }) => mod_obj.update_state.source_type === 'MODRINTH').length}${CLIColor.FgGray} from ${CLIColor.FgWhite}Modrinth${CLIColor.FgGray})` +
            `${CLIColor.Reset}${dry ? `${CLIColor.FgGray} -- ${CLIColor.Reset}Upgrade with --upgrade` : ''}\n`,
    );

    // Save http status codes returned from sources back to map for next time
    await save_map_to_file('./annotated_mods.json', mod_map);

    // to_update_mods = to_update_mods.slice(0, 2);

    // If this is not a dry run and there are mods to download, actually download them
    if (to_update_mods.length > 0 && !dry) {
        const DOWNLOAD_BATCH_SIZE = 5;

        // Prepare temp download directory
        await mkdir(DOWNLOAD_TEMP_DIR, { recursive: true }).catch(() => {
            console.error(`Failed to create temporary download directory at ${path.toNamespacedPath(DOWNLOAD_TEMP_DIR)}`);
            return;
        });

        let running_updates = 0;
        let completed_dls = 0;
        const full_dls = to_update_mods.length;
        const download_map: Map<string, { response: Promise<string>; remote_version: string; start_time: number; file_name: string }> =
            new Map();
        const downloaded_mods: Map<string, { remote_version: string; file_name: string }> = new Map();
        console.log(`Upgrading ${full_dls} mods...`);

        init_live_zone(2);
        while (download_map.size > 0 || to_update_mods.length > 0) {
            const progress = Math.ceil(((completed_dls / full_dls) * 100) / 2);
            update_live_zone([
                `${CLIColor.FgWhite}${'='.repeat(progress)}${CLIColor.FgGray}${'-'.repeat(50 - progress)}${CLIColor.Reset}`,
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
                            ),
                            remote_version: to_download_mod.remote_version,
                            start_time: Date.now(),
                            file_name: to_download_mod.file_name,
                        });
                        running_updates++;
                    }
                }
            }

            const finished_dls: string[] = [];
            for (const [mod_id, { response, remote_version, start_time, file_name }] of download_map.entries()) {
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

                    downloaded_mods.set(mod_id, { file_name, remote_version });
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
            `${CLIColor.FgWhite}${'='.repeat(progress)}${CLIColor.FgGray}${'-'.repeat(50 - progress)}${CLIColor.Reset}`,
            `Upgrading mods${CLIColor.FgGray} - ${CLIColor.FgWhite}${completed_dls}${CLIColor.FgGray} of ${CLIColor.FgWhite}${full_dls}${CLIColor.Reset}`,
        ]);
        finish_live_zone();

        console.log('Finished upgrading all mods!');

        for (const [mod_id, { file_name, remote_version }] of downloaded_mods.entries()) {
            const mod = mod_map.get(mod_id);
            if (mod) {
                await replace_mod_file(mod_id, mod, file_name)
                    .then((new_file_path) => {
                        mod.file_path = new_file_path;
                        mod.update_state.version = remote_version;
                        mod.update_state.last_updated_at = new Date(Date.now()).toISOString();
                    })
                    .catch((err) => {
                        console.warn(err);
                    });
            }
        }

        // Save updated files & versions back to file (only changes when upgrading)
        await save_map_to_file('./annotated_mods.json', mod_map);
    }

    // Clean up temp folder
    try {
        // await rmdir(DOWNLOAD_TEMP_DIR, { recursive: true });
    } catch (err) {
        // Folder is probably missing, which is fine
    }

    await print_gh_ratelimits();
}

/**
 * Replaces a mods file with a newer file from the downloads folder.
 * @returns The relative path to the new mod files location in a promise for resolve, an error message for reject.
 */
async function replace_mod_file(mod_id: string, mod: mod_object, file_name: string): Promise<string> {
    return new Promise(async (resolve, reject) => {
        const new_file = Bun.file(`${DOWNLOAD_TEMP_DIR}/${file_name}`);
        if ((await new_file.exists()) && new_file.name) {
            await rename(new_file.name, `${MOD_BASE_DIR}/${file_name}`)
                .then(async () => {
                    const old_file = Bun.file(mod.file_path);
                    if (await old_file.exists()) {
                        await old_file.delete().catch(() => {
                            console.warn(`W: Failed to delete older file for mod ${mod_id} as ${mod.file_path}, but we upgraded it.`);
                        });
                    } else {
                        // This is not a full failure, since a state with the old file can still mean that the new mod is there - we need to track that
                        console.log(`W: Older file for mod "${mod_id}" at ${mod.file_path} does not exist, but we upgraded it.`);
                    }
                    return resolve(`${MOD_BASE_DIR}/${file_name}`);
                })
                .catch(() => {
                    return reject(`W: Failed to move file ${file_name} to mods folder`);
                });
        } else {
            return reject(`W: Failed to move file ${file_name} to mods folder. File is missing.`);
        }
    });
}

async function check_url_for_updates(
    mod_obj: mod_object,
    url: string,
): Promise<{ status: string; version?: string; file_name?: string; file_url?: string } | undefined> {
    if (mod_obj.update_state.source_type === 'GH_RELEASE') {
        const { status, body } = await check_gh_releases(url);
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
                            !asset.name.endsWith('-javadoc.jar')
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

            return { version: version as string, status, file_name: file, file_url: dl_url };
        } else {
            return { version: undefined, status, file_name: undefined, file_url: undefined };
        }
    }
    return undefined;
}

async function check_gh_releases(url: string): Promise<{ status: string; body: JsonObject | undefined }> {
    const project = url.match(/(?:github.com\/(.+?\/.+?))(?:\/|$)/m)?.at(1);
    if (project) {
        const res: Response | undefined = await gh_request(`/repos/${project}/releases/latest`, 'GET');
        if (res == undefined || !res.ok) {
            console.warn(`W: Failed to get releases with ${res.status} | ${res.statusText} for ${project}`);
            return { body: undefined, status: String(res.status) };
        } else {
            if (res.headers.get('content-type')?.includes('application/json')) {
                const body = (await res.json()) as JsonObject;
                return { body, status: String(res.status) };
            }
        }
    } else {
        console.warn(`W: GitHub URL ${url} is fauly, can't check..`);
    }
    return { body: undefined, status: '400' };
}

function download_file(
    source: string,
    source_type: 'GH_RELEASE' | 'CURSEFORGE' | 'MODRINTH' | 'OTHER',
    destination: string,
    file_name: string,
): Promise<string> {
    return new Promise(async (resolve, reject) => {
        let res: Response;
        if (source_type === 'GH_RELEASE') {
            res = await gh_request(source, 'GET');
        } else {
            res = await fetch(source, { method: 'GET', redirect: 'follow' });
        }
        let content_length: string | number | null = res.headers.get('Content-Length');
        if (!res.ok || !content_length || (content_length && Number(content_length) < 1) || !res.body) {
            return reject(
                `W: Failed to download file ${file_name} from ${source_type} with ${res.status} | ${res.statusText}. Headers: ${JSON.stringify(res.headers.toJSON())}`,
            );
        }
        content_length = Number(content_length);

        const file = Bun.file(`${destination}/${file_name}`);
        const writer = file.writer({ highWaterMark: 1024 * 1024 });

        let written_bytes = 0;
        for await (const chunk of res.body) {
            // Await is actually needed here, since .write() returns a promise
            written_bytes += await (writer.write(chunk) as unknown as Promise<number>).catch(() => {
                reject(`W: Failed to write chunk of ${destination}/${file_name} to disk`);
                return 0;
            });
        }

        await writer.flush();

        if (written_bytes == content_length) {
            resolve(`Wrote ${written_bytes} bytes to disk for ${file_name}`);
        } else {
            reject(`W: Failed to write filestream to disk. Wrote ${written_bytes} bytes, expected ${content_length}`);
        }
    });
}

async function gh_request(path: string, method: string = 'GET'): Promise<Response> {
    const url = path.startsWith('http://') || path.startsWith('https://') ? path : `https://api.github.com${path}`;
    const res = await fetch(url, {
        method,
        headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'mod-updater-script',
            Authorization: `Bearer ${GITHUB_API_KEY}`,
        },
        redirect: 'follow',
    });

    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
        const reset = res.headers.get('x-ratelimit-reset');
        const secs = reset ? Math.max(0, parseInt(reset) * 1000 - Date.now()) / 1000 : undefined;
        console.warn(`W: GitHub rate limit exceeded. Resets in ~${secs?.toFixed(0)}s`);
    }

    return res;
}

async function print_gh_ratelimits() {
    const rate_limits = (await ((await gh_request('/rate_limit')) as any)?.json()).resources?.core;
    const reset_in = (rate_limits.reset - Date.now() / 1000) / 60;
    console.log(`rate limits - used: ${rate_limits.used}, remaining: ${rate_limits.remaining}, reset in: ${reset_in.toFixed(1)} mins`);
}
