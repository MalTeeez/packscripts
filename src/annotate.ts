//@ts-check
import fg from 'fast-glob';
import {
    read_from_file,
    save_map_to_file,
    extract_file_from_zip,
    type mod_object,
    clone,
    divide_to_full_groups,
    save_list_to_file,
    type JsonObject,
    read_arr_from_file,
} from './utils';

//#region general
/**
 * Read a map of annotated mods from a json file, and return them as parsed objects
 * @param annotated_file The file path to the json file
 * @returns A map, keyed by the mod id
 */
async function read_saved_mods(annotated_file: string): Promise<Map<string, mod_object>> {
    const file_contents = await read_from_file(annotated_file);
    const file_map: Map<string, any> = new Map(Object.entries(file_contents));

    const mod_map = new Map<string, mod_object>();
    for (const [mod_id, mod] of file_map) {
        const modObj: mod_object = {
            file_path: mod.file_path,
            tags: mod.tags || ['SIDE.CLIENT', 'SIDE.SERVER'],
            source: mod.source || '',
            notes: mod.notes || '',
            wanted_by: mod.wanted_by || [],
            wants: mod.wants || [],
            enabled: mod.enabled !== undefined ? mod.enabled : true,
        };
        mod_map.set(mod_id, modObj);
    }

    return mod_map;
}

/**
 * Enable mods with the REQUIRED_BASE flag, as a way to keep mods enabled.
 * This function should be called after broad actions that disable mods.
 * This function does not handle saving mod_map to file, 
 * so the outer calling function must save afterwards.
 */
async function enable_base_mods(mod_map: Map<string, mod_object>) {
    const changed_list: string[] = [];

    // Get base required mods from tag
    for (const [mod_id, mod_object] of mod_map) {
        if (mod_object.tags && mod_object.tags.includes("REQUIRED_BASE") && !mod_object.enabled) {
            console.log("\nRe-Enabling mod required by basegame", mod_id)
            await enable_mod_deep(mod_id, mod_map, changed_list);
        }
    }
}


//#region annotate
async function annotate() {
    const annotated_file = './annotated_mods.json';

    const mod_files = await scan_mods_folder('../.minecraft/mods/');
    await extract_modinfos(mod_files);

    const old_list = await read_saved_mods(annotated_file);

    if (old_list != undefined && typeof old_list === 'object') {
        await save_map_to_file(annotated_file, update_list(mod_files, old_list));
    } else {
        console.error('Failed to read annotated mods from file.');
    }
}

/**
 * Scan a folder of mods
 * @param {string} directory The path to this directory, with a trailing slash
 * @returns {Promise<Map<string, { [key: string]: any }>>} A map of mod jars, keyed by file path and an object with trait basename
 */
async function scan_mods_folder(directory: string): Promise<Map<string, { [key: string]: any }>> {
    const files = fg.sync(directory + '**/*', { onlyFiles: true, deep: 4, globstar: true });

    const extension_pattern = /^.*\/(.+\.(?:jar(?:\.disabled)?))$/m;
    // Array of [file_path, file_name]
    const filtered_files: Map<string, { [key: string]: string | JsonObject | Array<JsonObject> | undefined }> = new Map();

    for (const file_path of files) {
        const match = file_path.match(extension_pattern);
        if (match && match.length >= 2) {
            const file_name = match.at(1);
            if (file_name !== undefined) {
                filtered_files.set(file_path, { basename: file_name });
            }
        }
    }

    return filtered_files;
}

/**
 * Extract more infos about a list of mods from their contained mcmod.info files (json)
 * @param files A list of mod jars, with their path and basename
 */
async function extract_modinfos(files: Map<string, { [key: string]: any }>) {
    for (const [file_path, file_object] of files) {
        let info_json: Array<JsonObject> | JsonObject | string | undefined = await extract_file_from_zip(file_path, 'mcmod.info')
            .then((file_data: string) => {
                // Try to parse the modinfo file as json
                try {
                    return JSON.parse(file_data);
                } catch (err) {
                    //console.error("Failed to parse mod info for file ", file_name)
                    if (file_data.length > 0) {
                        return file_data;
                    }
                    return undefined;
                }
            })
            .catch(() => {
                return undefined;
            });
        file_object['info_json'] = info_json;
        const [mod_id, wants] = parse_mod_id(info_json, file_path);
        file_object['mod_id'] = mod_id;
        if (wants) {
            file_object['wants'] = wants;
        }
    }
    return files;
}

/**
 * Parse the mcmod.info inside a mod file, to get its id
 * @param info_json Contents of the mods mcmod.info file, might be a json object, a string or undefined
 * @param basename The basename of the file, with extension
 */
function parse_mod_id(
    info_json: Array<JsonObject> | JsonObject | string | undefined,
    file_path: string,
): [string | undefined, Array<string> | undefined] {
    let mod_id: undefined | string = undefined;
    let wants: undefined | Array<string> = undefined;

    // Get mod id (with fallbacks)
    if (typeof info_json === 'object') {
        if (
            Array.isArray(info_json) &&
            info_json[0] &&
            info_json[0].modid &&
            typeof info_json[0].modid === 'string' &&
            info_json[0].modid.length > 0
        ) {
            // if (info_json.length > 1) {
            //     console.log("Multiple Mod-Ids for ", basename)
            //     for (const entry of info_json) {
            //         console.log(": ", entry.modid)
            //     }
            // }
            mod_id = info_json[0].modid;
        } else if (
            !Array.isArray(info_json) &&
            info_json.modList &&
            Array.isArray(info_json.modList) &&
            info_json.modList[0] &&
            info_json.modList[0].modid &&
            typeof info_json.modList[0].modid === 'string' &&
            info_json.modList[0].modid.length > 0
        ) {
            mod_id = info_json.modList[0].modid;
        }
    }
    // If the json was existent, but had empty values, we might still be undefined, so we dont chain this one
    if (typeof info_json === 'string' && mod_id == undefined) {
        // Couldn't parse the file as json, try it as a simple key for the id
        const modid_match = info_json.match(/"modid":\s*"(.*?)"/);
        if (modid_match && modid_match.length > 1) {
            if (modid_match.at(1) !== '') {
                mod_id = modid_match.at(1);
            }
        }
    } else if (info_json === undefined || mod_id == undefined) {
        // mod_id is still not found, so we try to extract it from its file name
        // oh god what have I created.
        // Basically, this first matches the folder path in front of the file. Then it filters out any non word chars in front of the name or a tag group, such as [CLIENT].
        // Then to mark the start of the name, it looks for a alphanum character, 
        // and from thereout grabs everything (alphanum) OR (a single digit) OR (another part of the name, seperated by + OR - and (starting with 2 alphanum chars OR a i or a for single words))
        // This stops at a non fitting seperator, such as [,],-,_ or a digit
        const modid_match = file_path.match(
            /(?<path>^.*\/)(?<pre>(?:(?:\[[A-Z]+?\])|[\-\[\]\+\d\.])*)(?<middle>(?<first_char>[a-zA-Z])(?:[a-zA-Z]|\d{1}|[\+\-](?:[a-zA-Z]{2}|[aI]))+)(?<post>[\[\]\-_]*?\d?.*?)(?:\.jar)/m,
        );
        if (modid_match && modid_match.length > 1 && modid_match.groups?.middle) {
            //console.info("\t ^^ Found id secondary through regex")
            mod_id = modid_match.groups.middle;
        }
    }
    if (mod_id == undefined) {
        console.error('Failed to find any id from file ', file_path);
    }

    // Get mod wants (just json)
    if (typeof info_json === 'object') {
        if (Array.isArray(info_json) && info_json[0]) {
            if (info_json[0].requiredMods && Array.isArray(info_json[0].requiredMods) && info_json[0].requiredMods.length > 0) {
                //@ts-ignore
                wants = info_json[0].requiredMods;
            } else if (info_json[0].dependencies && Array.isArray(info_json[0].dependencies) && info_json[0].dependencies.length > 0) {
                //@ts-ignore
                wants = info_json[0].dependencies;
            }
        } else if (!Array.isArray(info_json) && info_json.modList && Array.isArray(info_json.modList) && info_json.modList[0]) {
            if (
                info_json.modList[0].requiredMods &&
                Array.isArray(info_json.modList[0].requiredMods) &&
                info_json.modList[0].requiredMods.length > 0
            ) {
                //@ts-ignore
                wants = info_json.modList[0].requiredMods;
            } else if (
                info_json.modList[0].dependencies &&
                Array.isArray(info_json.modList[0].dependencies) &&
                info_json.modList[0].dependencies.length > 0
            ) {
                //@ts-ignore
                wants = info_json.modList[0].dependencies;
            }
        }
    }

    return [mod_id, wants];
}

/**
 * Update a loaded mod map with the actual state from fs
 */
function update_list(files: Map<string, { [key: string]: any }>, mod_map: Map<string, mod_object>) {
    const std_object: mod_object = {
        file_path: '',
        tags: ['SIDE.CLIENT', 'SIDE.SERVER'],
        source: '',
        notes: '',
        wanted_by: [],
        wants: [],
        enabled: true,
    };
    // Create maps from parameters
    for (const [file_path, file_object] of files) {
        let file_obj = mod_map.get(file_object['mod_id']);
        if (file_obj != undefined) {
            // Update path
            file_obj['file_path'] = file_path;
            file_obj.enabled = !file_path.includes('.jar.disabled');
            // Add missing attributes
            for (const key in std_object) {
                if (file_obj[key] == undefined) {
                    file_obj[key] = std_object[key];
                }
            }
        } else {
            file_obj = clone(std_object);
            file_obj.file_path = file_path;
            file_obj.enabled = !file_path.includes('.jar.disabled');

            mod_map.set(file_object['mod_id'], file_obj);
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
function trace_deps(mod_list: Map<string, mod_object>, files: Map<string, { [key: string]: any }>) {
    for (const [mod_id, mod_object] of mod_list) {
        const file = files.get(mod_object.file_path);
        if (file && file.wants && Array.isArray(file.wants)) {
            for (const dep of file.wants) {
                // Check our stored dependencies contain this mods annotated depedencies (from its mcmod.info)
                // Filter out deps to forge, and filter each of our entries by their fit in the contained dep, to also match versioned deps (both in lowercase)
                if (
                    !dep.match(/((?:Minecraft)?Forge(?:@|$))/m) &&
                    mod_object.wants &&
                    !mod_object.wants.find((val: string) => 
                        dep.toLowerCase().includes(val.toLowerCase()) || 
                        val.toLowerCase().includes(dep.toLowerCase())
                )
                ) {
                    console.log('Mod ', mod_id, ' might be missing dep ', dep);
                }
            }
        }
        if (mod_object.wants != undefined && mod_object.wants.length > 0) {
            for (const dep_id of mod_object.wants) {
                const dep = mod_list.get(dep_id);
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

//#region binary
async function binary_search_disable(target_fraction: string) {
    const mod_map = await read_saved_mods('./annotated_mods.json');
    const mod_list = Array.from(mod_map.keys());

    // So we don't save again later
    let undo = false;
    if (target_fraction === 'undo') {
        const last_rev = await revision_hist_pop();
        if (last_rev != undefined) {
            target_fraction = last_rev;
            undo = true;
        }
    }

    let [section, scope] = target_fraction.split('/').map(Number);

    if (section != undefined && scope != undefined && section <= scope && section > 0) {
        // First disable all mods
        await disable_all_mods(mod_map);

        // Then enable targeted fraction
        const groups = divide_to_full_groups(mod_list.length, scope);
        // Start at 0 for mods indexed at 0
        // Using a new variable for section here, since typescript apparently hates me mutating it before using at groups.reduce()
        const safe_section = section - 1;
        let change_limit: number = groups[safe_section] || 0;
        // Sum of groups up to this one (section)
        let start_idx: number = groups.reduce(
            (previousValue: number, currentValue: number, currentIndex: number) =>
                currentIndex < safe_section ? previousValue + currentValue : previousValue,
            0,
        );
        let change_count: number = 0;
        let skip_count: number = 0;
        const changed_list: Array<string> = [];

        while (change_count < change_limit) {
            // Are we above the the maximum number of mods?
            if (start_idx + change_count + skip_count >= mod_list.length) {
                // Set to start (0), reset skip count since the starting base is different
                skip_count = 0;
                start_idx = 0;
            }

            const mod_id = mod_list[start_idx + change_count + skip_count];
            if (mod_id != undefined) {
                const changed_mods = await enable_mod_deep(mod_id, mod_map, changed_list);
                if (changed_mods == 0) {
                    // We might hit some mods multiple times, and therefore skip them, leading to no changes,
                    // and us infinitely re-testing the specific index. This increments on skipped mods
                    skip_count++;
                } else {
                    change_count += changed_mods;
                }
            } else {
                console.error('Mod list OOB');
                await save_map_to_file('./annotated_mods.json', mod_map)
                process.exit(1)
            }
        }

        await enable_base_mods(mod_map);
        await save_map_to_file('./annotated_mods.json', mod_map);
        if (change_count > 0) {
            if (!undo) await revision_hist_push(target_fraction);
            console.log('Changed ', change_count, ' mods.\n');
        } else {
            console.log('No changes made.');
        }
    } else {
        console.error('Received faulty fraction.');
    }
}

/**
 * Push a binary action to history
 */
async function revision_hist_push(rev: string) {
    const file_path = './.annotate_history.json';

    const rev_list: Array<string> = await read_arr_from_file(file_path);
    rev_list.push(rev);
    console.log('Adding revision ', rev, ' to history.');
    await save_list_to_file(file_path, rev_list);
}

/**
 * Pop and return the last binary action from history
 */
async function revision_hist_pop(): Promise<string | undefined> {
    const file_path = './.annotate_history.json';

    const rev_list: Array<string> = await read_arr_from_file(file_path);
    const rev = rev_list.pop();
    if (rev) console.log('Removed revision ', rev, ' from history.');
    await save_list_to_file(file_path, rev_list);

    return rev;
}

/**
 * Rename a file to a new file
 */
async function rename_file(old_path: string, new_path: string) {
    const old_file = Bun.file(old_path);
    if (await old_file.exists()) {
        const new_file = Bun.file(new_path);
        await Bun.write(new_file, old_file);
        await old_file.delete();
    } else {
        console.log('File ', old_path, ' does not exist, but we tried to rename it.');
    }
}

/**
 * Disable a mod, with its dependents
 * @param mod_id The mod to disable
 * @param mod_map A mod map, from read_saved_mods()
 * @param changed_list A list of mod ids, to keep track of which mods we have already updated
 * @returns The number of mods that were changed
 */
async function toggle_mod_deep(mod_id: string, mod_map: Map<string, mod_object>, changed_list: Array<string>): Promise<number> {
    let change_count = 0;

    const mod = mod_map.get(mod_id);
    if (mod != undefined) {
        if (mod.enabled) {
            // Disable self
            change_count += await disable_mod_deep(mod_id, mod_map, changed_list);
        } else {
            // Enable self
            change_count += await enable_mod_deep(mod_id, mod_map, changed_list);
        }
    }

    return change_count;
}

/**
 * Disable a mod, with its dependents
 * @param mod_id The mod to disable
 * @param mod_map A mod map, from read_saved_mods()
 * @param changed_list A list of mod ids, to keep track of which mods we have already updated
 * @returns The number of mods that were changed
 */
async function disable_mod_deep(mod_id: string, mod_map: Map<string, mod_object>, changed_list: Array<string>): Promise<number> {
    let change_count = 0;

    const mod = mod_map.get(mod_id);
    if (mod != undefined) {
        // Disable dependents
        if (mod.wanted_by && mod.wanted_by.length > 0) {
            for (const dependency of mod.wanted_by) {
                change_count += await disable_mod_deep(dependency, mod_map, changed_list);
            }
        }
        // Make sure we didnt already touch this mod before & its enabled
        if (!changed_list.includes(mod_id) && mod.enabled) {
            console.log('Disabling mod ', mod_id);
            // Mod was enabled before (as is the name now), add .disabled suffix
            const new_path = mod.file_path + '.disabled';
            await rename_file(mod.file_path, new_path);
            mod.file_path = new_path;

            mod.enabled = false;
            changed_list.push(mod_id);
            change_count++;
        }
    }

    return change_count;
}

/**
 * Disable a mod, with its dependents
 * @param mod_id The mod to disable
 * @param mod_map A mod map, from read_saved_mods()
 * @param changed_list A list of mod ids, to keep track of which mods we have already updated
 * @returns The number of mods that were changed
 */
async function enable_mod_deep(mod_id: string, mod_map: Map<string, mod_object>, changed_list: Array<string>): Promise<number> {
    let change_count = 0;

    const mod = mod_map.get(mod_id);
    if (mod != undefined) {
        // Enable dependencies
        if (mod.wants && mod.wants.length > 0) {
            for (const dependency of mod.wants) {
                change_count += await enable_mod_deep(dependency, mod_map, changed_list);
            }
        }
        // Make sure we didnt already touch this mod before & its disabled
        if (!changed_list.includes(mod_id) && !mod.enabled) {
            console.log('Enabling mod ', mod_id);
            // Mod was disabled before (as is the name now), remove .disabled suffix
            const new_path = mod.file_path.replace(/\.disabled$/m, '');
            await rename_file(mod.file_path, new_path);
            mod.file_path = new_path;

            mod.enabled = true;
            changed_list.push(mod_id);
            change_count++;
        }
    }

    return change_count;
}

//#region graph
async function visualize_graph() {
    const annotated_file = './annotated_mods.json';
    const file_contents = await read_from_file(annotated_file);
    const mod_map: Map<string, any> = new Map(Object.entries(file_contents));

    // Build Cytoscape elements
    const nodes = mod_map
        .entries()
        .map(([id, val]) => ({
            data: { id, label: id, degree: val.wanted_by ? val.wanted_by.length : 0 },
        }))
        .toArray();

    const edges: Array<{ data: { source: string; target: string; label: string } }> = [];
    for (const [mod_id, mod] of mod_map) {
        if (mod.wants) {
            for (const dep of mod.wants) {
                if (mod_map.has(dep)) {
                    edges.push({ data: { source: mod_id, target: dep, label: 'wants' } });
                }
            }
        }
        // Derived connections go two-way, so we just use one
        // if (mod.wanted_by) {
        //     for (const dep of mod.wanted_by) {
        //         if (mod_map.has(dep)) {
        //             edges.push({ data: { source: dep, target: mod_id, label: "wanted_by" } });
        //         }
        //     }
        // }
    }

    // Remove duplicate edges (optional)
    const edgeSet = new Set();
    const uniqueEdges = edges.filter((e) => {
        const key = `${e.data.source}->${e.data.target}`;
        if (edgeSet.has(key)) return false;
        edgeSet.add(key);
        return true;
    });

    // HTML template for Cytoscape
    const html = `
<!DOCTYPE html>
<html>

<head>
    <meta charset="utf-8">
    <title>Mod Dependency Graph</title>
    <style>
        body {
            background-color: #152333;
        }

        #cy {
            width: 100vw;
            height: 100vh;
            display: block;
        }
    </style>
    <script src="https://unpkg.com/cytoscape/dist/cytoscape.min.js"></script>
</head>

<body>
    <div id="cy"></div>
    <script>
        const cy = cytoscape({
            container: document.getElementById('cy'),
            elements: ${JSON.stringify([...nodes, ...uniqueEdges])},
            style: [
            {
                selector: 'node',
                style: {
                    'label': 'data(label)',
                    'background-color': '#0074D9',
                    'color': '#fff',
                    'text-valign': 'center',
                    'text-halign': 'center',
                    'font-size': 11,
                    'width': 'mapData(degree, 1, 10, 30, 80)',
                    'height': 'mapData(degree, 1, 10, 30, 80)'
                }
            },
            {
                selector: 'edge[label="wants"]',
                style: {
                    'width': 2,
                    'color': '#bbb',
                    'line-color': '#00c853',
                    'target-arrow-color': '#00c853',
                    'target-arrow-shape': 'triangle',
                    'curve-style': 'bezier',
                    'label': 'data(label)',
                    'font-size': 6,
                    'text-rotation': 'autorotate',
                    'text-margin-y': -8
                }
            },
            {
                selector: 'edge[label="wanted_by"]',
                style: {
                    'width': 2,
                    'color': '#bbb',
                    'line-color': '#ff9800',
                    'target-arrow-color': '#ff9800',
                    'target-arrow-shape': 'tee',
                    'curve-style': 'bezier',
                    'label': 'data(label)',
                    'font-size': 6,
                    'text-rotation': 'autorotate',
                    'text-margin-y': -8
                }
            }
        ],
            layout: {
            name: 'cose',
            animate: true
        },
            wheelSensitivity: 0.1
            });
    </script>
</body>

</html>
    `;

    Bun.file('graph.html').write(html);
}

//#region toggle, all modes
async function toggle_mod(opts: string | undefined) {
    const mod_map = await read_saved_mods('./annotated_mods.json');
    if (opts != undefined) {
        const mod = mod_map.get(opts);
        if (mod != undefined) {
            const change_list: string[] = [];
            let changes = await toggle_mod_deep(opts, mod_map, change_list);
            await enable_base_mods(mod_map);

            if (changes > 0) {
                await save_map_to_file('./annotated_mods.json', mod_map);
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

async function enable_all_mods(mod_map?: Map<string, mod_object>) {
    // Initialize map if not provided, since we can't use await in param
    mod_map = mod_map == undefined ? await read_saved_mods('./annotated_mods.json') : mod_map;
    const change_list: string[] = [];
    let changes = 0;
    
    for (const [mod_id, mod_object] of mod_map) {
        changes += await enable_mod_deep(mod_id, mod_map, change_list);
    }

    if (changes > 0) {
        await save_map_to_file('./annotated_mods.json', mod_map);
        console.log('Changed ', changes, ' mods.\n');
    } else {
        console.log('No changes made.');
    }
}

async function disable_all_mods(mod_map?: Map<string, mod_object>) {
    // Initialize map if not provided, since we can't use await in param
    mod_map = mod_map == undefined ? await read_saved_mods('./annotated_mods.json') : mod_map;
    const change_list: string[] = [];
    let changes = 0;

    for (const [mod_id, mod_object] of mod_map) {
        changes += await disable_mod_deep(mod_id, mod_map, change_list);
    }
    await enable_base_mods(mod_map);

    if (changes > 0) {
        await save_map_to_file('./annotated_mods.json', mod_map);
        console.log('Changed ', changes, ' mods.\n');
    } else {
        console.log('No changes made.');
    }
}

async function enable_atomic_deep(opts_mod_id: string, mod_map?: Map<string, mod_object>) {
    // Initialize map if not provided, since we can't use await in param
    mod_map = mod_map == undefined ? await read_saved_mods('./annotated_mods.json') : mod_map;
    const change_list: string[] = [];
    let changes = 0;
    
    opts_mod_id = opts_mod_id.toLowerCase();
    const mod_id = mod_map.keys().find((key: string) => 
        key.toLowerCase() === opts_mod_id
    );

    if (mod_id != undefined) {
        changes += await enable_mod_deep(mod_id, mod_map, change_list);
    }
    
    if (changes > 0) {
        await save_map_to_file('./annotated_mods.json', mod_map);
        console.log('Changed ', changes, ' mods.\n');
    } else {
        console.log('No changes made.');
    }
}

async function disable_atomic_deep(opts_mod_id: string, mod_map?: Map<string, mod_object>) {
    // Initialize map if not provided, since we can't use await in param
    mod_map = mod_map == undefined ? await read_saved_mods('./annotated_mods.json') : mod_map;
    const change_list: string[] = [];
    let changes = 0;

    opts_mod_id = opts_mod_id.toLowerCase();
    const mod_id = mod_map.keys().find((key: string) => 
        key.toLowerCase() === opts_mod_id
    );

    if (mod_id != undefined) {
        changes += await disable_mod_deep(mod_id, mod_map, change_list);
    }
    await enable_base_mods(mod_map);

    if (changes > 0) {
        await save_map_to_file('./annotated_mods.json', mod_map);
        console.log('Changed ', changes, ' mods.\n');
    } else {
        console.log('No changes made.');
    }
}


//#region Entrypoint
async function main() {
    const args = process.argv.slice(2);
    const mode = args[0]?.toLowerCase();
    const opts = args[1];

    try {
        if (mode === 'update') {
            await annotate();
            console.log('Mod list updated successfully!');
        } else if (mode === 'list') {
            for (const [file_path, mod_object] of await extract_modinfos(await scan_mods_folder('../.minecraft/mods/'))) {
                console.log(`${mod_object.mod_id}: ${file_path}`);
            }
        } else if (mode === 'binary') {
            if (opts != undefined) {
                await binary_search_disable(opts);
            } else {
                console.error('Missing target fraction for mode binary, i.e. [1/4].');
            }
        } else if (mode === 'graph') {
            await visualize_graph();
        } else if (mode === 'toggle') {
            await toggle_mod(opts)
        } else if (mode === 'enable_all') {
            await enable_all_mods()
        } else if (mode === 'disable_all') {
            await disable_all_mods()
        } else if (mode === 'enable') {
            if (opts != undefined) {
                await enable_atomic_deep(opts)
            } else {
                console.error("Missing target mod (id) to enable.")
            }
        } else if (mode === 'disable') {
            if (opts != undefined) {
                await disable_atomic_deep(opts)
            } else {
                console.error("Missing target mod (id) to disable.")
            }
        } else {
            console.log('Usage: node annotate.js [mode]');
            console.log('Modes:');
            console.log('  update                            - Update annotated mod list');
            console.log('  list                              - List all indexed mods');
            console.log('  binary [target fraction | undo]   - Perform a deep-disable for a binary section');
            console.log('  graph                             - Build a html file, that visualizes dependencies');
            console.log('  toggle [mod_id]                   - Disable / Enable a specific mod by its id');
            console.log('  enable_all                        - Enable all mods');
            console.log('  disable_all                       - Disable all mods');
            console.log('  enable [mod_id]                   - Deep-Enable a specific mod by its id');
            console.log('  disable [mod_id]                  - Deep-Disable a specific mod by its id');
        }
    } catch (error: any) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

/**
 * Delay execution by a given time
 * @param {number} t Time in millis
 * @returns A promise to await
 */
export function delay(t: number | undefined) {
    return /** @type {Promise<void>} */ new Promise<void>(function (resolve) {
        setTimeout(function () {
            resolve();
        }, t);
    });
}

//// Add this at the end of the file
if (import.meta.url === import.meta.resolve('file://' + process.argv[1])) {
    main().catch(console.error);
}
