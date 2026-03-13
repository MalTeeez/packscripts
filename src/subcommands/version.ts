import { ANNOTATED_FILE, DOWNLOAD_TEMP_DIR, DOWNLOAD_UNDO_DIR, GITHUB_API_KEY, MOD_BASE_DIR } from '../utils/consts';
import { download_file, filter_assets, print_gh_ratelimits, query_gh_project_by_url } from '../utils/fetch';
import { glob_files_in_dir, save_list_to_file, save_map_to_file } from '../utils/fs';
import { are_all_mods_unlocked, read_saved_mods, type mod_object, type SourceType } from '../utils/mods';
import {
    CLIColor,
    finish_live_zone,
    init_live_zone,
    is_finished,
    live_log,
    render_md,
    rev_replace_all,
    update_live_zone,
} from '../utils/utils';
import { mkdir, rename } from 'node:fs/promises';
import { toNamespacedPath } from 'node:path';

const SOURCE_API_KEYS: Map<SourceType, string> = new Map();

export async function list_all_versions_for_mod(
    mod_id: string,
    options: {
        all_pages: boolean;
        wide: boolean;
        count?: string;
    },
    mod_map?: Map<string, mod_object>,
) {
    assert_gh_key();

    let limitToXReleases = Infinity;
    if (options.count != undefined && !Number.isNaN(Number(options.count))) {
        limitToXReleases = Number(options.count);
    }

    mod_map = mod_map == undefined ? await read_saved_mods(ANNOTATED_FILE) : mod_map;

    // Resolve input mod_id to actual mod
    const lower_mod_id = mod_id.toLowerCase();
    const matched_mod_id = mod_map.keys().find((key: string) => key.toLowerCase() === lower_mod_id);
    const mod = mod_map.get(matched_mod_id || '');
    if (matched_mod_id == undefined || !mod || !mod.source) {
        console.warn('W: Failed to resolve mod id ', mod_id, ' to any source-indexed mod.');
        return;
    }

    const source_api_key = SOURCE_API_KEYS.get(mod.update_state.source_type);
    if (!source_api_key) {
        console.warn('W: Missing API key for mods source ', mod.update_state.source_type, ', ignoring.');
        return;
    }

    let { headers, status, body } = await query_gh_project_by_url(mod.source, source_api_key, '/releases?per_page=100');
    if (status == '200' && body != undefined && Array.isArray(body)) {
        const releases = Array.from(body);
        if (options.all_pages && headers?.get('link')?.includes('rel="last"')) {
            let page = 2;
            while (page < 10 && headers?.get('link')?.includes('rel="last"')) {
                ({ headers, status, body } = await query_gh_project_by_url(
                    mod.source,
                    source_api_key,
                    '/releases?per_page=100&page=' + page,
                ));
                if (status == '200' && body != undefined && Array.isArray(body)) {
                    releases.push(...body);
                    page++;
                } else {
                    console.warn('W: Failed to fetch further releases for page ', page, '.');
                    break;
                }
            }
        }

        let longest_tag_length = 0;
        releases.forEach((release) => (longest_tag_length = Math.max(release.tag_name.length || 0, longest_tag_length)));
        longest_tag_length += 3;

        for (const release of releases.slice(0, Math.min(limitToXReleases, releases.length)).reverse()) {
            if (options.wide) {
                console.log(
                    render_wide_release(release, {
                        version_padding: longest_tag_length,
                        add_underscores: true,
                        text_end:
                            release.tag_name === mod.update_state.version
                                ? `   \t${CLIColor.FgGray19}<- ${CLIColor.FgGray14}[${CLIColor.FgGray19}current version${CLIColor.FgGray14}]${CLIColor.Reset}`
                                : undefined,
                    }),
                );
            } else {
                const age_days_raw = (new Date(Date.now()).getTime() - new Date(release.published_at).getTime()) / 86400000;
                const age_days = age_days_raw.toFixed(2);
                const padding = rev_replace_all(' '.repeat(longest_tag_length - release.tag_name.length), '   ', ' . ');
                console.log(
                    `${CLIColor.FgGray} - ${CLIColor.Reset}` +
                        `${CLIColor.FgBlue0}${CLIColor.Bright} ${release.tag_name} ${CLIColor.Reset}` +
                        `${CLIColor.FgGray}${padding}${CLIColor.Reset}` +
                        `${color_by_age(age_days_raw)}${age_days}${CLIColor.Reset}` +
                        `${CLIColor.FgGray} days ago${CLIColor.Reset}${release.tag_name === mod.update_state.version ? `   \t${CLIColor.FgGray19}<- ${CLIColor.FgGray14}[${CLIColor.FgGray19}current version${CLIColor.FgGray14}]${CLIColor.Reset}` : ''}`,
                );
            }
        }

        if (!options.all_pages && headers?.get('link')?.includes('rel="last"')) {
            console.log(
                `\n${CLIColor.FgCyan}Note${CLIColor.FgGray}: ${CLIColor.FgGray19}Older versions were truncated due to pagination. Specify ${CLIColor.Bright}${CLIColor.FgWhite}--all${CLIColor.Reset}${CLIColor.FgGray19} to include all versions.`,
            );
        }
    }

    await print_gh_ratelimits(GITHUB_API_KEY);
}

export async function switch_version_of_mod(
    mod_id: string,
    version: string,
    options: {
        dry: boolean;
    },
    mod_map?: Map<string, mod_object>,
) {
    assert_gh_key();
    if (!await are_all_mods_unlocked()) {
        console.warn("W: Something is locking a file in the mods directory. Is the game still running?")
        return;
    }

    mod_map = mod_map == undefined ? await read_saved_mods(ANNOTATED_FILE) : mod_map;


    // Resolve input mod_id to actual mod
    const lower_mod_id = mod_id.toLowerCase();
    const matched_mod_id = mod_map.keys().find((key: string) => key.toLowerCase() === lower_mod_id);
    const mod = mod_map.get(matched_mod_id || '');
    if (matched_mod_id == undefined || !mod || !mod.source) {
        console.warn('W: Failed to resolve mod id ', mod_id, ' to any source-indexed mod.');
        return;
    }

    const source_api_key = SOURCE_API_KEYS.get(mod.update_state.source_type);
    if (!source_api_key) {
        console.warn('W: Missing API key for mods source ', mod.update_state.source_type, ', ignoring.');
        return;
    }

    let { headers, status, body } = await query_gh_project_by_url(mod.source, source_api_key, '/releases/tags/' + version, [404]);
    if (status === '200' && body != undefined && body.assets != undefined && Array.isArray(body.assets)) {
        if (options.dry) {
            // Just print the specific release for dry runs
            console.log(
                render_wide_release(body as any, {
                    version_padding: 16,
                    text_start: `  ${CLIColor.BgTeal3}${CLIColor.FgWhite1}${CLIColor.Bright} ${mod.update_state.version} ${CLIColor.Reset} ${CLIColor.Bright}${CLIColor.FgGray17}-> ${CLIColor.Reset}`,
                }),
            );
        } else {
            // Prepare temp directories
            await mkdir(DOWNLOAD_TEMP_DIR, { recursive: true }).catch((err) => {
                console.error(`Failed to create temporary download directory at ${toNamespacedPath(DOWNLOAD_TEMP_DIR)}`);
                throw err;
            });
            await mkdir(DOWNLOAD_UNDO_DIR, { recursive: true }).catch((err) => {
                console.error(`Failed to create temporary download directory at ${toNamespacedPath(DOWNLOAD_TEMP_DIR)}`);
                throw err;
            });

            let assets = body.assets as Array<{ browser_download_url: string; name: string; size: any }>;
            let [file_name, dl_url] = filter_assets(assets, mod.update_state.file_pattern);

            if (file_name == undefined || dl_url == undefined) {
                console.warn(
                    `W: More or less than one asset remaining for ${mod_id}: `,
                    assets.map((asset) => asset.name),
                );
                return;
            }

            // Actually download the remote version
            const res = await download_file(dl_url, mod.update_state.source_type, DOWNLOAD_TEMP_DIR, file_name, source_api_key);
            const is_base_required = mod.tags?.includes('REQUIRED_BASE') || false;

            // And replace the old file
            const old_mod_jar = mod.file_path.replace(MOD_BASE_DIR + '/', '');
            const new_mod_path = `${MOD_BASE_DIR}/${file_name + (mod.enabled ? '' : '.disabled')}`;
            await Bun.file(mod.file_path)
                .delete()
                .catch(() => {
                    console.warn('W: Failed to delete previous version of mod, at ' + old_mod_jar);
                });
            await rename(`${DOWNLOAD_TEMP_DIR}/${file_name}`, new_mod_path)
                .then(async () => {
                    console.log(
                        `Switched version of ${mod_id} from ` +
                            `${CLIColor.BgTeal3}${CLIColor.FgWhite1}${CLIColor.Bright} ${mod.update_state.version} ${CLIColor.Reset} ` +
                            `${CLIColor.FgGray}(${CLIColor.FgGray18}${old_mod_jar}${CLIColor.FgGray})${CLIColor.FgWhite3} to ` +
                            `${CLIColor.BgBlue0}${CLIColor.FgWhite1}${CLIColor.Bright} ${version} ${CLIColor.Reset} ` +
                            `${CLIColor.FgGray}(${CLIColor.FgGray18}${file_name + (mod.enabled ? '' : '.disabled')}${CLIColor.FgGray})${CLIColor.FgGray17}${CLIColor.Reset}`,
                    );

                    mod.file_path = new_mod_path;
                    mod.update_state.version = version;
                    mod.update_state.last_updated_at = new Date(Date.now()).toISOString();
                    if (is_base_required) {
                        console.info(
                            `Mod required by basegame (${mod_id}) changed in version. Don't forget to also change it externally, if required.`,
                        );
                    }
                })
                .catch(() => console.warn(`W: Failed to move switched jar ${file_name} for mod ${mod_id} into the mod directory.`));

            // Save updated files & versions back to file (only changes when upgrading)
            await save_map_to_file(ANNOTATED_FILE, mod_map);
        }
    } else if (status === '404') {
        console.log(
            `\n${CLIColor.FgRed10}Release version '${CLIColor.Bright}${version}${CLIColor.Reset}${CLIColor.FgRed10}' for ${CLIColor.Bright}${mod_id}${CLIColor.Reset}${CLIColor.FgRed10} does not exist on ${mod.update_state.source_type}.${CLIColor.Reset}`,
        );
    }

    await print_gh_ratelimits(GITHUB_API_KEY);
}

export async function restore_to_asset_versions(
    options: {
        dry: boolean;
    },
    mod_map?: Map<string, mod_object>,
) {
    assert_gh_key();
    if (!await are_all_mods_unlocked()) {
        console.warn("W: Something is locking a file in the mods directory. Is the game still running?")
        return;
    }
    
    mod_map = mod_map == undefined ? await read_saved_mods(ANNOTATED_FILE) : mod_map;
    let to_update_mods: {
        mod_id: string;
        mod_obj: mod_object;
        file_name: string;
        file_url: string;
        source_api_key: string;
    }[] = [];
    let longest_mod_id_length = 0;

    for (const [mod_id, mod] of mod_map) {
        if (mod.source == undefined || !mod.update_state.version) continue;

        const source_api_key = SOURCE_API_KEYS.get(mod.update_state.source_type);
        if (!source_api_key) {
            console.warn('W: Missing API key for mods source ', mod.update_state.source_type, ', ignoring.');
            continue;
        }

        let { headers, status, body } = await query_gh_project_by_url(
            mod.source,
            source_api_key,
            '/releases/tags/' + mod.update_state.version,
            [404],
        );
        if (status === '200' && body != undefined && body.assets != undefined && Array.isArray(body.assets)) {
            let assets = body.assets as Array<{ browser_download_url: string; name: string; size: any }>;
            let [file_name, dl_url, size] = filter_assets(assets, mod.update_state.file_pattern);
            const old_mod_jar = mod.file_path.replace(RegExp(String.raw`${MOD_BASE_DIR}.*\/`), '');

            if (file_name == undefined || dl_url == undefined) {
                console.warn(
                    `W: More or less than one asset remaining for ${mod_id}: `,
                    assets.map((asset) => asset.name),
                    ', ignoring.',
                );
                continue;
            } else {
                // Only re-download the asset if the file on disk differs from the remote asset, or the file is missing
                const file = Bun.file(mod.file_path);
                if (old_mod_jar !== file_name || !(await file.exists()) || (await file.stat()).size != Number(size)) {
                    to_update_mods.push({ file_name, file_url: dl_url, mod_id, mod_obj: mod, source_api_key });
                    longest_mod_id_length = Math.max(mod_id.length, longest_mod_id_length);
                }
            }
        } else if (status === '404') {
            console.warn(
                `W: ${CLIColor.FgRed10}Release version '${CLIColor.Bright}${mod.update_state.version}${CLIColor.Reset}${CLIColor.FgRed10}' for ${CLIColor.Bright}${mod_id}${CLIColor.Reset}${CLIColor.FgRed10} does not exist on ${mod.update_state.source_type}, ignoring.${CLIColor.Reset}`,
            );
        }
    }


    // Print list of mods that would be restored
    let longest_mod_version_length = 0;
    let longest_mod_filename_length = 0;
    to_update_mods.forEach((item) => (longest_mod_id_length = Math.max(item.mod_id.length, longest_mod_id_length)));
    to_update_mods.forEach((item) => {
        longest_mod_version_length = Math.max(item.mod_obj.update_state?.version?.length || 0, longest_mod_version_length);
        longest_mod_filename_length = Math.max((item.mod_obj.file_path.split(/[\\/]/).pop() ?? '').length, longest_mod_filename_length);
    });

    console.log(`\nFound ${to_update_mods.length} mods that ${!options.dry ? "will be" : "can be"} restored from their remote asset:`)
    for (const item of to_update_mods) {
        const id_padding_len = longest_mod_id_length - item.mod_id.length;
        const vers_padding_len = longest_mod_version_length - (item.mod_obj.update_state.version?.length || 0);
        const filename = item.file_name;

        console.log(
            ` ${CLIColor.FgGray}-${CLIColor.Reset} ${item.mod_id} ${CLIColor.FgGray}${rev_replace_all(' '.repeat(id_padding_len), '   ', ' . ')}` +
                ` ${CLIColor.BgBlue0}${CLIColor.FgWhite1}${CLIColor.Bright} ${item.mod_obj.update_state.version} ${CLIColor.Reset}` +
                ` ${CLIColor.FgGray}${rev_replace_all(' '.repeat(vers_padding_len), '   ', ' . ')} ${CLIColor.FgGray9}(${CLIColor.FgGray19}${filename}${CLIColor.FgGray14})${CLIColor.Reset}${CLIColor.Reset}`,
        );
    }


    // If this is not a dry run and there are mods to download, actually download them
    if (to_update_mods.length > 0 && !options.dry) {
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

        let running_downloads = 0;
        let completed_downloads = 0;
        const full_dls = to_update_mods.length;
        const download_map: Map<
            string,
            { response: Promise<string>; start_time: number; file_name: string; is_base_required: boolean; mod_obj: mod_object }
        > = new Map();
        const downloaded_mods: Map<string, { file_name: string; is_base_required: boolean; mod_obj: mod_object }> = new Map();
        console.log(`\nRedownloading ${full_dls} mods...`);

        init_live_zone(2);
        while (download_map.size > 0 || to_update_mods.length > 0) {
            const progress = Math.ceil(((completed_downloads / full_dls) * 100) / 2);
            update_live_zone([
                `|${CLIColor.FgWhite}${'='.repeat(progress)}${CLIColor.FgGray}${'-'.repeat(50 - progress)}${CLIColor.Reset}|`,
                `Redownloading mods - ${CLIColor.FgWhite}${completed_downloads}${CLIColor.FgGray} of ${CLIColor.FgWhite}${full_dls}${CLIColor.Reset}`,
            ]);

            // If we have empty download slots, fill them with new downloads
            if (running_downloads < DOWNLOAD_BATCH_SIZE) {
                for (let i = 0; i < DOWNLOAD_BATCH_SIZE - running_downloads; i++) {
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
                            start_time: Date.now(),
                            file_name: to_download_mod.file_name,
                            is_base_required: to_download_mod.mod_obj.tags?.includes('REQUIRED_BASE') || false,
                            mod_obj: to_download_mod.mod_obj,
                        });
                        running_downloads++;
                    }
                }
            }

            const finished_dls: string[] = [];
            for (const [mod_id, { response, start_time, file_name, is_base_required, mod_obj }] of download_map.entries()) {
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

                    downloaded_mods.set(mod_id, { file_name, is_base_required, mod_obj: mod_obj });
                    completed_downloads++;
                    running_downloads--;
                    finished_dls.push(mod_id);
                } else {
                    if (Date.now() - start_time > 20000) {
                        live_log(`W: Mod ${mod_id} has been downloading for more than 20 seconds - stalled?`, console.warn);
                    }
                }
            }
            finished_dls.forEach((mod_id) => download_map.delete(mod_id));
        }
        const progress = Math.ceil(((completed_downloads / full_dls) * 100) / 2);
        update_live_zone([
            `|${CLIColor.FgWhite}${'='.repeat(progress)}${CLIColor.FgGray}${'-'.repeat(50 - progress)}${CLIColor.Reset}|`,
            `Downloading mods${CLIColor.FgGray} - ${CLIColor.FgWhite}${completed_downloads}${CLIColor.FgGray} of ${CLIColor.FgWhite}${full_dls}${CLIColor.Reset}`,
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
                        .catch(() => console.warn('W: Failed to delete leftover undo-file for previously downloaded mod ' + file)),
            );

            for (const [mod_id, { file_name, is_base_required, mod_obj }] of downloaded_mods.entries()) {
                const mod = mod_map.get(mod_id);
                if (mod && (await Bun.file(`${DOWNLOAD_TEMP_DIR}/${file_name}`).exists())) {
                    const old_mod_jar = mod.file_path.replace(RegExp(String.raw`${MOD_BASE_DIR}.*\/`), '');
                    const new_mod_path = `${MOD_BASE_DIR}/${file_name + (mod.enabled ? '' : '.disabled')}`;

                    if (await Bun.file(`${DOWNLOAD_UNDO_DIR}/${old_mod_jar}`).exists()) {
                        await rename(mod.file_path, `${DOWNLOAD_UNDO_DIR}/${old_mod_jar}`).catch((err) => {
                            console.warn(
                                `W: Failed to move the older jar for mod ${mod_id} from the mod dir into the undo dir. Won't be able to undo the changed file for this mod.`,
                            );
                        });
                    }

                    await rename(`${DOWNLOAD_TEMP_DIR}/${file_name}`, new_mod_path)
                        .then(async () => {
                            if (!(await Bun.file(new_mod_path).exists())) {
                                console.warn(
                                    `W: Failed to move newer file for ${mod_id} (${file_name}) to mod directory. Reverting to previous version.`,
                                );
                                await rename(`${DOWNLOAD_UNDO_DIR}/${old_mod_jar}`, mod.file_path).catch((err) => {
                                    console.warn(
                                        `W: Failed to move the older jar for mod ${mod_id} back from the undo dir into the mod dir.`,
                                    );
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
                                mod.update_state.last_updated_at = new Date(Date.now()).toISOString();
                                if (is_base_required) {
                                    console.info(
                                        `Mod required by basegame (${mod_id}) was changed. Don't forget to also change it externally, if required.`,
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

    await print_gh_ratelimits(GITHUB_API_KEY);
}

function assert_gh_key() {
    if (GITHUB_API_KEY == undefined) {
        // can't throw in ternary
        throw Error('Missing GITHUB_API_KEY.');
    } else {
        SOURCE_API_KEYS.set('GH_RELEASE', GITHUB_API_KEY);
    }
}

function color_by_age(days: number): CLIColor {
    if (days < 30) return CLIColor.FgGreen11;
    if (days < 180) return CLIColor.FgYellow1;
    if (days < 365) return CLIColor.FgOrange5;
    return CLIColor.FgRed1;
}

function render_wide_release(
    release: {
        tag_name: string;
        author: { login: string };
        name: string;
        draft: string;
        prerelease: string;
        published_at: string;
        assets: { name: string; download_count: number; size: number }[];
        body: string;
    },
    options: {
        version_padding: number;
        add_underscores?: boolean;
        text_start?: string;
        text_end?: string;
    },
): string {
    const age_days_raw = (new Date(Date.now()).getTime() - new Date(release.published_at).getTime()) / 86400000;
    const age_days = age_days_raw.toFixed(2);
    const padding = rev_replace_all(' '.repeat(options.version_padding - release.tag_name.length), '   ', ' . ');
    const release_name =
        release.name && release.name !== release.tag_name
            ? ` ${CLIColor.FgGray}·${CLIColor.Reset} ${CLIColor.FgWhite2}${release.name}${CLIColor.Reset}`
            : '';
    const badges =
        (release.draft ? ` ${CLIColor.BgYellow0}${CLIColor.FgBlack}${CLIColor.Bright} DRAFT ${CLIColor.Reset}` : '') +
        (release.prerelease ? ` ${CLIColor.BgMagenta0}${CLIColor.FgWhite}${CLIColor.Bright} PRE ${CLIColor.Reset}` : '');
    const author = release.author?.login
        ? `${options.add_underscores ? CLIColor.Underscore : ''}${CLIColor.FgGray} by ${CLIColor.FgGray15}${release.author.login}${CLIColor.Reset}`
        : '';
    let result_text =
        (options.text_start || `${options.add_underscores ? CLIColor.Underscore : ''}${CLIColor.FgGray} - ${CLIColor.Reset}`) +
        `${options.add_underscores ? CLIColor.Underscore : ''}${CLIColor.BgBlue0}${CLIColor.FgWhite1}${CLIColor.Bright} ${release.tag_name} ${CLIColor.Reset}` +
        `${options.add_underscores ? CLIColor.Underscore : ''}${CLIColor.FgGray}${padding}${CLIColor.Reset}` +
        `${options.add_underscores ? CLIColor.Underscore : ''}${color_by_age(age_days_raw)}${CLIColor.Bright}${age_days}${CLIColor.Reset}` +
        `${options.add_underscores ? CLIColor.Underscore : ''}${CLIColor.FgGray} days ago${CLIColor.Reset}` +
        release_name +
        badges +
        author +
        (options.text_end || '');
    result_text += '\n';

    // Assets section — colored gutter, transparent content background
    if (Array.isArray(release.assets) && release.assets.length > 0) {
        const gutter_a = `${CLIColor.BgGray5}${CLIColor.Dim}${CLIColor.FgMagenta11}▌${CLIColor.Reset}    `;
        const longest_asset = (release.assets as { name: string }[]).reduce((m, a) => Math.max(m, a.name.length), 0);
        for (const asset of release.assets as { name: string; size: number; download_count: number }[]) {
            const kb = (asset.size / 1024).toFixed(0);
            const name_pad = ' '.repeat(longest_asset - asset.name.length + 2);
            result_text +=
                gutter_a +
                `${CLIColor.FgGray} - ${CLIColor.Reset}` +
                `${CLIColor.Dim}${CLIColor.FgMagenta11}${asset.name}${CLIColor.Reset}${name_pad}` +
                `${CLIColor.FgGray10}(${CLIColor.Reset}` +
                `${CLIColor.FgGray20}${asset.download_count}↓${CLIColor.FgGray11}, ` +
                `${CLIColor.FgGray18}${kb} ${CLIColor.FgGray14}KB` +
                `${CLIColor.FgGray10})${CLIColor.Reset}\n`;
        }
        result_text += '\n';
    }

    // Body section — colored gutter, transparent content background
    const gutter_b = `${CLIColor.BgGray3}${CLIColor.FgGray5}▌${CLIColor.Reset}    `;
    const rendered_body = render_md(release.body);
    result_text += rendered_body
        .split('\n')
        .map((line) => gutter_b + `${CLIColor.FgGray19}${line}${CLIColor.Reset}`)
        .join('\n');

    return result_text + '\n';
}
