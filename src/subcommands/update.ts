import { getUpdateFrequencyOrdinal, read_saved_mods, type mod_object, type update_frequency } from '../utils/mods';
import { CLIColor, compare_versions, rev_replace_all, type JsonObject } from '../utils/utils';
import { GITHUB_API_KEY } from '../../.env.json';
import { save_map_to_file } from '../utils/fs';

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
            res: Promise<{ status: string; version?: string; file_name?: string; file_url?: string; source_type?: string } | undefined>;
        }
    > = new Map();
    let longest_mod_id_length = 0;

    for (const [mod_id, mod_obj] of mod_map.entries()) {
        // Skip this mod if errored on a previous check and retry is off
        if (mod_obj.update_state.last_status !== '200' && !options.retry_failed) continue;
        // Skip this mod if its update frequency is below the provided threshold
        if (getUpdateFrequencyOrdinal(mod_obj.update_state.frequency) > getUpdateFrequencyOrdinal(options.frequency_range)) continue;

        // console.log(
        // `mod ${mod_id} has freq \t${mod_obj.update_state.frequency} (${getUpdateFrequencyOrdinal(mod_obj.update_state.frequency)}) for threshold ${options.frequency_range} (${getUpdateFrequencyOrdinal(options.frequency_range)})`,
        // );

        longest_mod_id_length = Math.max(mod_id.length, longest_mod_id_length);
        if (mod_obj.source) {
            fetch_map.set(mod_id, { mod_obj, res: check_url_for_updates(mod_obj.source, mod_obj.update_state.file_pattern) });
        }
    }

    longest_mod_id_length++;
    let version_length = 20;
    const to_update_mods: {
        mod_id: string;
        mod_obj: mod_object;
        remote_version: string;
        file_name: string;
        file_url: string;
        source_type: string;
    }[] = [];

    for (const [mod_id, { mod_obj, res }] of fetch_map.entries()) {
        const content = await res;
        if (content != undefined) {
            const { version: remote_version, status, file_name, file_url, source_type } = content;
            if (mod_obj.update_state.version && remote_version && status && file_name && file_url && source_type) {
                const id_padding_len = longest_mod_id_length - mod_id.length;
                const vers_padding_len = version_length - Math.min(mod_obj.update_state.version.length, version_length);
                const version_change = compare_versions(mod_obj.update_state.version, remote_version);
                let change_string = `${CLIColor.FgBlack}-${CLIColor.Reset}`;

                if (version_change == -1) {
                    to_update_mods.push({ mod_id, mod_obj, remote_version, file_url, file_name, source_type });
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
        `\n ${CLIColor.FgWhite}${CLIColor.Bright}${to_update_mods.length}${CLIColor.FgGray} of ${CLIColor.FgWhite}${CLIColor.Bright}${mod_map.size}${CLIColor.FgGray} mods can be upgraded. ` +
            `${CLIColor.FgGray}(${CLIColor.FgGreen}${to_update_mods.filter(({ source_type }) => source_type === 'GitHub').length}${CLIColor.FgGray} from ${CLIColor.FgWhite}GitHub${CLIColor.FgGray}, ` +
            `${CLIColor.FgGreen}${to_update_mods.filter(({ source_type }) => source_type === 'CurseForge').length}${CLIColor.FgGray} from ${CLIColor.FgWhite}Curseforge${CLIColor.FgGray}, ` +
            `${CLIColor.FgGreen}${to_update_mods.filter(({ source_type }) => source_type === 'Modrinth').length}${CLIColor.FgGray} from ${CLIColor.FgWhite}Modrinth${CLIColor.FgGray})${CLIColor.Reset}\n`,
    );

    const rate_limits = (await ((await gh_request('/rate_limit')) as any)?.json()).resources?.core;
    const reset_in = (rate_limits.reset - Date.now() / 1000) / 60;
    console.log(`rate limits - used: ${rate_limits.used}, remaining: ${rate_limits.remaining}, reset in: ${reset_in.toFixed(1)} mins`);

    save_map_to_file('./annotated_mods.json', mod_map);
}

async function check_url_for_updates(
    url: string,
    file_pattern: string | undefined,
): Promise<
    | { status: string; version?: string; file_name?: string; file_url?: string; source_type?: 'GitHub' | 'CurseForge' | 'Modrinth' }
    | undefined
> {
    if (url.startsWith('https://github.com/')) {
        const { status, body } = await check_gh_releases(url);
        if (status == '200' && body != undefined) {
            const version = body.tag_name;
            let assets: Array<{ url: string; name: string }> = (body.assets as Array<{ [key: string]: string }>).map((asset) => {
                return {
                    url: asset.url as string,
                    name: asset.name as string,
                };
            });
            if (assets.length < 1) {
                console.warn('W: Got response with empty assets for: ', url, status);
                return undefined;
            }

            let filtered_assets: Array<{ url: string; name: string }> = [];

            // Use file_pattern if available
            if (assets.length > 1 && file_pattern != undefined && file_pattern.length > 0) {
                const pattern = new RegExp(file_pattern, 'gm');
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
                            !asset.name.endsWith('-prestub.jar')
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

            return { version: version as string, status, file_name: file, file_url: dl_url, source_type: 'GitHub' };
        } else {
            return { version: undefined, status, file_name: undefined, file_url: undefined, source_type: undefined };
        }
    }
    return undefined;
}

async function check_gh_releases(url: string): Promise<{ status: string; body: JsonObject | undefined }> {
    const project = url.match(/(?:github.com\/(.+?\/.+?))(?:\/|$)/m)?.at(1);
    if (project) {
        const res: Response | undefined = await gh_request(`/repos/${project}/releases/latest`, 'GET');
        if (res == undefined || !res.ok) {
            console.warn(`W: Failed to get releases for ${project}`);
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

async function gh_request(path: string, method: string = 'GET'): Promise<Response> {
    const res = await fetch(`https://api.github.com${path}`, {
        method,
        headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'mod-updater-script',
            Authorization: `Bearer ${GITHUB_API_KEY}`,
        },
    });

    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
        const reset = res.headers.get('x-ratelimit-reset');
        const secs = reset ? Math.max(0, parseInt(reset) * 1000 - Date.now()) / 1000 : undefined;
        console.warn(`W: GitHub rate limit exceeded. Resets in ~${secs?.toFixed(0)}s`);
    } else if (!res.ok) {
        console.warn(`W: Req failed with ${res.status} | ${res.statusText} for ${path}`);
    }

    return res;
}
