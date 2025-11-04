import { ANNOTATED_FILE, MOD_BASE_DIR } from '../utils/consts';
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
import { print_pretty } from '../utils/utils';

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

export async function list_mods_folder() {
    // Intialize array with 4 cols, and set their headers
    const mods: Array<[string, string[]]> = [
        ['Enabled Mod Id', []],
        ['File Path', []],
        ['Disabled Mod Id', []],
        ['File Path', []],
    ];

    for (const [file_path, mod_object] of await extract_modinfos(await scan_mods_folder(MOD_BASE_DIR))) {
        if (mod_object.enabled && typeof mod_object.mod_id === 'string') {
            //@ts-ignore
            mods[0][1].push(mod_object.mod_id);
            //@ts-ignore
            mods[1][1].push(file_path);
        } else if (typeof mod_object.mod_id === 'string') {
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
