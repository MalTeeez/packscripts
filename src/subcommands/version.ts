import { ANNOTATED_FILE, DOWNLOAD_TEMP_DIR, DOWNLOAD_UNDO_DIR, GITHUB_API_KEY, MOD_BASE_DIR } from '../utils/consts';
import { download_file, print_gh_ratelimits, query_gh_project_by_url } from '../utils/fetch';
import { save_map_to_file } from '../utils/fs';
import { read_saved_mods, type mod_object, type SourceType } from '../utils/mods';
import { CLIColor, render_md, rev_replace_all } from '../utils/utils';
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
    if (GITHUB_API_KEY == undefined) {
        // can't throw in ternary
        throw Error('Missing GITHUB_API_KEY.');
    } else {
        SOURCE_API_KEYS.set('GH_RELEASE', GITHUB_API_KEY);
    }

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
                console.log(render_wide_release(release, { version_padding: longest_tag_length, add_underscores: true }));
            } else {
                const age_days_raw = (new Date(Date.now()).getTime() - new Date(release.published_at).getTime()) / 86400000;
                const age_days = age_days_raw.toFixed(2);
                const padding = rev_replace_all(' '.repeat(longest_tag_length - release.tag_name.length), '   ', ' . ');
                console.log(
                    `${CLIColor.FgGray} - ${CLIColor.Reset}` +
                        `${CLIColor.FgBlue0}${CLIColor.Bright} ${release.tag_name} ${CLIColor.Reset}` +
                        `${CLIColor.FgGray}${padding}${CLIColor.Reset}` +
                        `${color_by_age(age_days_raw)}${age_days}${CLIColor.Reset}` +
                        `${CLIColor.FgGray} days ago${CLIColor.Reset}`,
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
    if (GITHUB_API_KEY == undefined) {
        // can't throw in ternary
        throw Error('Missing GITHUB_API_KEY.');
    } else {
        SOURCE_API_KEYS.set('GH_RELEASE', GITHUB_API_KEY);
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

            let filtered_assets: Array<{ browser_download_url: string; name: string }> = [];
            let assets = body.assets as Array<{ browser_download_url: string; name: string }>;

            // Use file_pattern if available
            if (assets.length > 1 && mod.update_state.file_pattern != undefined && mod.update_state.file_pattern.length > 0) {
                const pattern = new RegExp(mod.update_state.file_pattern, 'gm');
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

            let file_name: string;
            let dl_url: string;
            if (assets.length === 1) {
                file_name = assets[0]?.name as string;
                dl_url = assets[0]?.browser_download_url as string;
            } else {
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
            await Bun.file(mod.file_path).delete().catch(() => {
                console.warn("W: Failed to delete previous version of mod, at " + old_mod_jar)
            });
            await rename(`${DOWNLOAD_TEMP_DIR}/${file_name}`, new_mod_path)
                .then(async () => {
                    console.log(`Switched version of ${mod_id} from ` +
                        `${CLIColor.BgTeal3}${CLIColor.FgWhite1}${CLIColor.Bright} ${mod.update_state.version} ${CLIColor.Reset} ` + 
                        `${CLIColor.FgGray}(${CLIColor.FgGray18}${old_mod_jar}${CLIColor.FgGray})${CLIColor.FgWhite3} to ` + 
                        `${CLIColor.BgBlue0}${CLIColor.FgWhite1}${CLIColor.Bright} ${version} ${CLIColor.Reset} ` + 
                        `${CLIColor.FgGray}(${CLIColor.FgGray18}${file_name + (mod.enabled ? '' : '.disabled')}${CLIColor.FgGray})${CLIColor.FgGray17}${CLIColor.Reset}` 
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
        author;
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
