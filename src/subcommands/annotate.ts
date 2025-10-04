import { MOD_BASE_DIR } from '../utils/consts';
import { save_map_to_file, scan_mods_folder } from '../utils/fs';
import { default_mod_object, extract_modinfos, isModPropertySafe, read_saved_mods, type mod_object, type mod_object_unsafe } from '../utils/mods';
import { clone } from '../utils/utils';

export async function annotate() {
    const annotated_file = './annotated_mods.json';

    const mod_files = await scan_mods_folder(MOD_BASE_DIR);
    const old_list = await read_saved_mods(annotated_file);

    const enriched_mods = await extract_modinfos(mod_files);

    if (old_list != undefined && typeof old_list === 'object') {
        await save_map_to_file(annotated_file, update_list(enriched_mods, old_list));
    } else {
        console.error('Failed to read annotated mods from file.');
    }
}

/**
 * Update a loaded mod map with the actual state from fs
 */
export function update_list(files: Map<string, mod_object_unsafe>, mod_map: Map<string, mod_object>) {
    // Create maps from parameters
    for (const [file_path, new_mod_obj] of files) {
        let old_mod_obj = mod_map.get(new_mod_obj.mod_id);

        // Did the mod exist in the already annotated mods?
        if (old_mod_obj != undefined) {
            // Update properties that we should always set programtically (update each time)
            old_mod_obj.file_path = new_mod_obj.file_path;
            old_mod_obj.enabled = new_mod_obj.enabled;

            // Add missing attributes, try from new obj, then from standard
            for (const key in default_mod_object) {
                set_new_or_default_property(key, old_mod_obj, new_mod_obj, default_mod_object);
            }
        } else if (new_mod_obj.mod_id != undefined) {
            old_mod_obj = clone(default_mod_object) as mod_object;
            old_mod_obj.file_path = file_path;
            old_mod_obj.enabled = new_mod_obj.enabled;

            mod_map.set(new_mod_obj.mod_id, old_mod_obj);
        }
    }
    for (const [mod_id, mod] of mod_map) {
        if (!files.has(mod.file_path)) {
            console.warn('W: Mod ', mod_id, ' is missing its linked file. Was it renamed / moved?');
        }
    }

    // Update list with backtraced deps
    trace_deps(mod_map);

    return mod_map;
}

interface str_obj {
    [key: string]: string | str_obj | string[] | boolean | undefined;
}

function set_new_or_default_property(
    property_name: string,
    base_mod: mod_object | str_obj,
    new_mod: mod_object_unsafe | str_obj,
    std_object: mod_object | str_obj,
) {
    if (typeof std_object[property_name] === 'object' && !Array.isArray(std_object[property_name])) {
        let sub_prop: str_obj = base_mod[property_name] as str_obj || {};
        for (const key in std_object[property_name]) {
            set_new_or_default_property(key, sub_prop, new_mod[property_name] as str_obj, std_object[property_name]);
        }
        base_mod[property_name] = sub_prop;
    } else {
        // If the attribute is new and isnt parsed from mods, it might be empty in a recusive pull
        if (!new_mod) new_mod = {} as str_obj;
        const new_prop = new_mod[property_name] as string | string[] | boolean | undefined;

        // Is this a new property? If yes take the value from the newer mod if set there
        if (base_mod[property_name] == undefined || base_mod[property_name] === "") {
            if (new_prop != undefined && isModPropertySafe(new_prop) && new_prop !== "") {
                base_mod[property_name] = new_prop;
            } else {
                base_mod[property_name] = std_object[property_name];
            }
            // Or is this an newer array? If yes, merge both the old and new one
        } else if (Array.isArray(base_mod[property_name]) && isModPropertySafe(new_prop) && Array.isArray(new_prop) && new_prop.length > 0) {
            base_mod[property_name] = Array.from(new Set([...base_mod[property_name], ...(new_prop as string[])]));
        }
    }
}

/**
 * Figure out what mods a mod is wanted by
 * Will log probable deps, and set non-bidirectional deps
 */
export function trace_deps(mod_list: Map<string, mod_object>) {
    for (const [mod_id, mod_object] of mod_list) {
        if (mod_object.wants != undefined) {
            for (const dep_id of mod_object.wants || []) {
                const [, dep_obj] = getModDeep(mod_list, dep_id);
                if (!dep_obj) {
                    console.log(`Mod ${mod_id} might be missing dep "${dep_id}"`);
                }

                if (!dep_id.match(/((?:Minecraft)?Forge(?:@|$))|(^\s*FML\s*$)/im)) {
                    const [actual_dep_id, dep_obj] = getModDeep(mod_list, dep_id);
                    const wants_idx = mod_object.wants.indexOf(dep_id);
                    if (dep_obj && actual_dep_id && wants_idx != -1) {
                        // Check if wanted_by list contains the current mod that wants this mod
                        if (dep_obj.wanted_by != undefined && !dep_obj.wanted_by.includes(mod_id)) {
                            dep_obj.wanted_by.push(mod_id);
                            mod_object.wants[wants_idx] = actual_dep_id;
                            console.log('Added missing dependent ', mod_id, ' to ', dep_id);
                        } else if (dep_obj.wanted_by == undefined) {
                            dep_obj.wanted_by = [mod_id];
                            mod_object.wants[wants_idx] = actual_dep_id;
                            console.log('Added missing dependent ', mod_id, ' to ', dep_id);
                        }
                    }
                }
            }
        }
    }
}

/**
 * Get a mod from the mod_list, while also allowing for matches of a mods alternate ids
 * @returns A tuple of the optional values: [Mod Id the Mod is actually known as, The Mod Object]
 */
function getModDeep(mod_list: Map<string, mod_object>, target_mod_id: string): [string | undefined, mod_object | undefined] {
    if (mod_list.has(target_mod_id)) {
        return [target_mod_id, mod_list.get(target_mod_id)];
    }
    const rough_match_key = mod_list.keys().find((key) => key.toLowerCase() === target_mod_id.toLowerCase());
    if (rough_match_key) {
        return [rough_match_key, mod_list.get(rough_match_key)];
    }
    for (const mod_obj of mod_list.values()) {
        if (mod_obj.other_mod_ids?.find((mod_id) => mod_id.toLowerCase() === target_mod_id.toLowerCase())) {
            return [mod_list.entries().find(([mod_id, sub_mod_obj]) => sub_mod_obj == mod_obj)?.[0], mod_obj];
        }
    }
    return [undefined, undefined];
}
