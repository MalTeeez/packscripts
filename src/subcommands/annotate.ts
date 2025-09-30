import { MOD_BASE_DIR } from '../utils/consts';
import { save_map_to_file, scan_mods_folder, search_zip_for_string } from '../utils/fs';
import { extract_modinfos, isModPropertySafe, read_saved_mods, type mod_object, type mod_object_unsafe } from '../utils/mods';
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
    const std_object: mod_object = {
        file_path: '',
        other_mod_ids: [],
        tags: ['SIDE.CLIENT', 'SIDE.SERVER'],
        source: '',
        notes: '',
        wanted_by: [],
        wants: [],
        enabled: true,
    };
    // Create maps from parameters
    for (const [file_path, new_mod_obj] of files) {
        let old_mod_obj = mod_map.get(new_mod_obj.mod_id);

        // Did the mod exist in the already annotated mods?
        if (old_mod_obj != undefined) {
            // Update path & enabled state
            old_mod_obj.file_path = new_mod_obj.file_path;
            old_mod_obj.enabled = new_mod_obj.enabled;
            // Add missing attributes, try from new obj, then from standard
            for (const key in std_object) {
                if (old_mod_obj[key] == undefined) {
                    if (new_mod_obj[key] != undefined && isModPropertySafe(new_mod_obj[key])) {
                        old_mod_obj[key] = new_mod_obj[key] as string | string[] | boolean;
                    } else {
                        old_mod_obj[key] = std_object[key];
                    }
                } else if (
                    Array.isArray(old_mod_obj[key]) &&
                    isModPropertySafe(new_mod_obj[key]) &&
                    Array.isArray(new_mod_obj[key]) &&
                    new_mod_obj[key].length > 0
                ) {
                    old_mod_obj[key] = Array.from(new Set([...old_mod_obj[key], ...(new_mod_obj[key] as string[])]));
                }
            }
        } else if (new_mod_obj.mod_id != undefined) {
            old_mod_obj = clone(std_object) as mod_object;
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
    trace_deps(mod_map, files);

    return mod_map;
}

/**
 * Figure out what mods a mod is wanted by
 * Will log probable deps, and set non-bidirectional deps
 */
export function trace_deps(mod_list: Map<string, mod_object>, new_mods: Map<string, mod_object_unsafe>) {
    for (const [mod_id, mod_object] of mod_list) {
        const file = new_mods.get(mod_object.file_path);
        if (file && file.wants && Array.isArray(file.wants)) {
            for (const dep of file.wants) {
                // Check our stored dependencies contain this mods annotated depedencies (from its mcmod.info)
                // Filter out deps to forge, and filter each of our entries by their fit in the contained dep, to also match versioned deps (both in lowercase)
                if (
                    !dep.match(/((?:Minecraft)?Forge(?:@|$))|(^\s*FML\s*$)/im) &&
                    mod_object.wants &&
                    !mod_object.wants.find(
                        (val: string) => dep.toLowerCase().includes(val.toLowerCase()) || val.toLowerCase().includes(dep.toLowerCase()),
                    ) &&
                    mod_id !== dep
                ) {
                    console.log('Mod ', mod_id, ' might be missing dep ', dep);
                }
            }
        }
        if (mod_object.wants != undefined && mod_object.wants.length > 0) {
            for (const dep_id of mod_object.wants) {
                if (!dep_id.match(/((?:Minecraft)?Forge(?:@|$))|(^\s*FML\s*$)/im)) {
                    const dep = getModDeep(mod_list, dep_id);
                    if (dep) {
                        // Check if wanted_by list contains the current mod that wants this mod
                        if (dep.wanted_by != undefined && !dep.wanted_by.includes(mod_id)) {
                            dep.wanted_by.push(mod_id);
                            console.log('Added missing dependent ', mod_id, ' to ', dep_id);
                        } else if (dep.wanted_by == undefined) {
                            dep.wanted_by = [mod_id];
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
 */
function getModDeep(mod_list: Map<string, mod_object>, target_mod_id: string): mod_object | undefined {
    if (mod_list.has(target_mod_id)) {
        return mod_list.get(target_mod_id);
    }
    for (const mod_obj of mod_list.values()) {
        if (
            mod_obj.other_mod_ids?.find(
                (mod_id) =>
                    mod_id.toLowerCase().includes(target_mod_id.toLowerCase()) || target_mod_id.toLowerCase().includes(mod_id.toLowerCase()),
            )
        ) {
            return mod_obj;
        }
    }
    return undefined;
}
