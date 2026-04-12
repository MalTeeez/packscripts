import { ANNOTATED_FILE, MOD_BASE_DIR } from '../utils/config';
import { save_map_to_file, scan_mods_folder } from '../utils/fs';
import {
    disable_mod_deep,
    enable_base_mods,
    enable_mod_deep,
    extract_modinfos,
    read_saved_mods,
    toggle_mod_deep,
    type mod_object,
} from '../utils/mods';
import { CLIColor, print_pretty, rev_replace_all } from '../utils/utils';

/**
 * Enable a list of mods by their id
 */
export async function enable_atomic_deep(opts_mod_id: string[], mod_map?: Map<string, mod_object>) {
    // Initialize map if not provided, since we can't use await in param
    mod_map = mod_map == undefined ? await read_saved_mods(ANNOTATED_FILE) : mod_map;
    const change_list: string[] = [];
    let changes = 0;

    for (let mod_id of opts_mod_id) {
        mod_id = mod_id.toLowerCase();
        const matched_mod_id = mod_map.keys().find((key: string) => key.toLowerCase() === mod_id);

        if (matched_mod_id != undefined) {
            changes += await enable_mod_deep(matched_mod_id, mod_map, change_list);
        }
    }

    if (changes > 0) {
        await save_map_to_file(ANNOTATED_FILE, mod_map);
        console.log('Changed ', changes, ' mods.\n');
    } else {
        console.log('No changes made.');
    }
}

/**
 * Disable a list of mods by their id
 */
export async function disable_atomic_deep(opts_mod_id: string[], mod_map?: Map<string, mod_object>) {
    // Initialize map if not provided, since we can't use await in param
    mod_map = mod_map == undefined ? await read_saved_mods(ANNOTATED_FILE) : mod_map;
    const change_list: string[] = [];
    let changes = 0;

    for (let mod_id of opts_mod_id) {
        mod_id = mod_id.toLowerCase();
        const matched_mod_id = mod_map.keys().find((key: string) => key.toLowerCase() === mod_id);

        if (matched_mod_id != undefined) {
            changes += await disable_mod_deep(matched_mod_id, mod_map, change_list);
        } else {
            console.warn("W: Failed to resolve ", mod_id, " to any annotated mod, skipping it.")
        }
    }
    await enable_base_mods(mod_map);

    if (changes > 0) {
        await save_map_to_file(ANNOTATED_FILE, mod_map);
        console.log('Changed ', changes, ' mods.\n');
    } else {
        console.log('No changes made.');
    }
}

export async function list_mods_folder(only_show_enabled: boolean = false) {
    // Intialize array with 4 cols, and set their headers
    const mods: Array<[string, string[]]> = [
        ['Enabled Mod Id', []],
        ['File Path', []],
    ];
    if (only_show_enabled) {
        mods.push(['Disabled Mod Id', []], ['File Path', []]);
    }

    for (const [file_path, mod_object] of await extract_modinfos(await scan_mods_folder(MOD_BASE_DIR))) {
        if (mod_object.enabled && typeof mod_object.mod_id === 'string') {
            //@ts-ignore
            mods[0][1].push(mod_object.mod_id);
            //@ts-ignore
            mods[1][1].push(file_path);
        } else if (!mod_object.enabled && !only_show_enabled && typeof mod_object.mod_id === 'string') {
            //@ts-ignore
            mods[2][1].push(mod_object.mod_id);
            //@ts-ignore
            mods[3][1].push(file_path);
        }
    }

    print_pretty(...mods);
}

export async function list_mods() {
    // Intialize array with 4 cols, and set their headers
    const mods: Array<[string, string[]]> = [
        ['Enabled Mod Id', []],
        ['File Path', []],
        ['Disabled Mod Id', []],
        ['File Path', []],
    ];

    for (const [mod_id, mod_object] of await read_saved_mods(ANNOTATED_FILE)) {
        if (mod_object.enabled) {
            //@ts-ignore
            mods[0][1].push(mod_id);
            //@ts-ignore
            mods[1][1].push(mod_object.file_path);
        } else {
            //@ts-ignore
            mods[2][1].push(mod_id);
            //@ts-ignore
            mods[3][1].push(mod_object.file_path);
        }
    }

    print_pretty(...mods);
}

export async function list_mods_wide(only_show_enabled: boolean = false) {
    const mod_map = await read_saved_mods(ANNOTATED_FILE);

    let longest_mod_id_length = 0;
    let longest_mod_version_length = 0;
    let longest_mod_filename_length = 0;
    mod_map.keys().forEach((id) => (longest_mod_id_length = Math.max(id.length, longest_mod_id_length)));
    mod_map
        .values()
        .forEach((obj) => {
            longest_mod_version_length = Math.max(obj.update_state?.version?.length || 0, longest_mod_version_length);
            longest_mod_filename_length = Math.max((obj.file_path.split(/[\\/]/).pop() ?? '').length, longest_mod_filename_length);
        });
    let excluded_mods = 0;

    for (const mod_id of Array.from(mod_map.keys()).sort((a, b) => a.localeCompare(b, undefined, { "sensitivity": "base"}))) {
        const mod = mod_map.get(mod_id);
        if (mod == undefined || (!mod.enabled && only_show_enabled)) {
            excluded_mods++;
            continue;
        };

        const id_padding_len = longest_mod_id_length - mod_id.length;
        const vers_padding_len = longest_mod_version_length - (mod.update_state.version?.length || 0);
        const filename = mod.file_path.split(/[\\/]/).pop() ?? mod.file_path;
        const filename_padding_len = longest_mod_filename_length - filename.length;

        console.log(
            ` ${CLIColor.FgGray}-${CLIColor.Reset} ${mod_id} ${CLIColor.FgGray}${rev_replace_all(' '.repeat(id_padding_len), '   ', ' . ')}` +
                ` ${CLIColor.BgBlue0}${CLIColor.FgWhite1}${CLIColor.Bright} ${mod.update_state.version} ${CLIColor.Reset}` +
                ` ${CLIColor.FgGray}${rev_replace_all(' '.repeat(vers_padding_len), '   ', ' . ')} ${CLIColor.FgGray9}(${CLIColor.FgGray19}${filename}${CLIColor.FgGray14})${CLIColor.Reset}${CLIColor.Reset}`,
        );
    }
    if (excluded_mods > 0) {
        console.info("\nNote: " ,excluded_mods, " of ", mod_map.size, " mods were exclude due to --enabled.")
    }
}

export async function toggle_mod(opts: string | undefined) {
    const mod_map = await read_saved_mods(ANNOTATED_FILE);
    if (opts != undefined) {
        opts = opts.toLowerCase();
        const mod_id = mod_map.keys().find((key: string) => key.toLowerCase() === opts);
        if (mod_id != undefined) {
            const change_list: string[] = [];
            let changes = await toggle_mod_deep(mod_id, mod_map, change_list);
            await enable_base_mods(mod_map);

            if (changes > 0) {
                await save_map_to_file(ANNOTATED_FILE, mod_map);
                console.log('Changed ', changes, ' mods.\n');
            } else {
                console.log('No changes made.');
            }
        } else {
            console.error('Mod with id ', opts, ' does not exist.');
        }
    } else {
        console.error('Missing target mod (id) to toggle.');
    }
}
