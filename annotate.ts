//@ts-check
import fg from "fast-glob";
import yauzl from "yauzl";

//#region helpers
interface file_object {
    "file_path": string;
    "tags": string[] | undefined;
    "source": string | undefined;
    "notes": string | undefined;
    "wanted_by": string[] | undefined;
    "wants": string[] | undefined;
    "enabled": boolean | undefined;
    [key: string]: string | string[] | boolean | undefined;
}

/**
 * @param {number} value
 * @param {number} [decimals]
 */
export function round_to_x_decimals(value: number, decimals: number) {
    if (!decimals) {
        decimals = 2;
    }
    value = value * Math.pow(10, decimals);
    value = Math.round(value);
    value = value / Math.pow(10, decimals);
    return value;
}

export function divide_to_full_groups(base: number, divisor: number) {
    const groups: number[] = new Array()

    const base_size = Math.floor(base / divisor)
    for (let i = divisor; i--;) {
        groups.push(base_size)
    }
    const leftover = base % divisor
    if (leftover) {
        // Add one to each group until leftover is distributed
        for (let i = 0; i < leftover; i++) {
            // @ts-ignore
            groups[i] += 1;
        }
    }

    return groups
}

//#region annotate
async function annotate() {
    const annotated_file = "./annotated_mods.json"

    const files = await scan_mods_folder("../.minecraft/mods/");
    const old_list = await read_from_file(annotated_file)

    await save_map_to_file(annotated_file, update_list(files, old_list));
}

/** 
 * Scan a folder of mods
 * @param {string} directory The path to this directory, with a trailing slash
 * @returns {Promise<Array<[string, string]>>}
 */
async function scan_mods_folder(directory: string): Promise<Array<[string, string]>> {
    const files = fg.sync(directory + "**/*", { onlyFiles: true, deep: 4, globstar: true });

    const extension_pattern = /\/mods\/(.+\.(?:jar(?:\.disabled)?))$/m;
    const filtered_files = new Array();

    for (const file of files) {
        const match = file.match(extension_pattern);
        if (match && match.length >= 2) {
            const file_name = match.at(1);
            if (file_name !== undefined) {
                const file_tuple: [string, string] = [file, file_name];
                filtered_files.push([file, await parse_mod_id(file_tuple)]);
            }
        }
    }

    return filtered_files;
}

/**
 * Save a javascript map object to a file
 * @param {string} file_path Path of the file to save in
 * @param {*} data Data to save. Must be parseable by JSON.stringify
 */
async function save_map_to_file(file_path: string, data: Map<string, file_object>) {
    try {
        // Sort and convert to object
        const map_obj: { [key: string]: any } = {}
        data.keys().toArray().sort().forEach((key) => {
            map_obj[key] = data.get(key)
        })

        await Bun.write(file_path, JSON.stringify(map_obj))
    } catch (err) {
        console.error(err);
    }
}

/**
 * Save a javascript array object to a file
 * @param {string} file_path Path of the file to save in
 * @param {*} data Data to save. Must be parseable by JSON.stringify
 */
async function save_list_to_file(file_path: string, data: Array<string>) {
    try {
        await Bun.write(file_path, JSON.stringify(data))
    } catch (err) {
        console.error(err);
    }
}

/**
 * Read a javascript object from a file and parse it with json
 * @param {string} file_path Path of the file to read
 */
async function read_from_file(file_path: string): Promise<Object> {
    const file = Bun.file(file_path)
    if (await file.exists()) {
        try {
            return JSON.parse(await file.text());
        } catch (err) {
            console.error(err);
            return {}
        }
    } else {
        console.error("File ", file, " does not exist.")
        return {}
    }
}

/**
 * Extract the content of a file inside a zip archive
 * @param {string} zipFilePath The path to the zip file
 * @param {string} fileName The name of the file to extract
 * @returns {Promise<string>} The content of the file
 */
function extract_file_from_zip(zipFilePath: string, fileName: string): Promise<string> {
    return new Promise((resolve, reject) => {
        yauzl.open(zipFilePath, { lazyEntries: true }, function (err, zipfile) {
            if (err) return reject(err);
            zipfile.readEntry();
            zipfile.on("entry", function (entry) {
                if (/\/$/.test(entry.fileName)) {
                    // Directory file names end with '/'.
                    // Note that entries for directories themselves are optional.
                    // An entry's fileName implicitly requires its parent directories to exist.
                    zipfile.readEntry();
                } else {
                    // file entry
                    if (fileName === entry.fileName) {
                        zipfile.openReadStream(entry, function (err, readStream) {
                            if (err) return reject(err);
                            const fileData: string[] = []
                            readStream.on('data', (data) => {
                                fileData.push(data)
                            })
                            readStream.on('end', () => {
                                return resolve(fileData.join(''))
                            });
                        });
                    } else {
                        // Not our file, try next
                        zipfile.readEntry()
                    }
                }
            });
            zipfile.on("end", () => {
                reject(new Error("File not found in zip archive for file " + zipFilePath));
            });
        });
    });
}

/**
 * Clone an object, mostly to forgo refs.
 * @param {Object} object The object to clone
 * @returns A reference to a new object, duplicate of the input object
 */
export function clone(object: file_object): file_object {
    return Object.assign({}, object);
}

/**
 * Parse the mcmod.info inside a mod file, to get its id
 * @param {[string, string]} file A tuple of the full path, and its resource path
 */
async function parse_mod_id(file: [string, string]) {
    let modid = await extract_file_from_zip(file[0], "mcmod.info")
        .then((file_data) => {
            // Try to parse the modinfo file as json
            let file_json = undefined;
            try {
                file_json = JSON.parse(file_data);
            } catch (err) {
                //console.error("Failed to parse mod info for file " + file[1])
            }
            if (file_json) {
                if (file_json[0] && file_json[0].modid) {
                    return file_json[0].modid;
                } else if (file_json.modList && file_json.modList[0] && file_json.modList[0].modid && file_json.modList[0].modid !== "") {
                    return file_json.modList[0].modid;
                }
                //console.error("Failed to find correct in JSON for file " + file[1])
            }
            // Couldn't parse the file as json, try it as a simple key for the id
            const modid_match = file_data.match(/"modid":\s*"(.*?)"/)
            if (modid_match && modid_match.length > 1) {
                if (modid_match[1] !== "") {
                    //console.info("\t ^ Found id through regex")
                    return modid_match[1]
                }
            }
            return undefined;
        })
        .catch((err) => {
            //console.log("Failed to find mcmod.info for file " + file[1])
            return undefined;
        });

    if (modid == undefined) {
        // Modid is still not found, so we try to extract it from its file name
        // Remove preceeding folder 
        const file_string = file[1].replace(/^.*\//m, "")
        const modid_match = file_string.match(/^.*?\/?(.+?)[-_+]?[\d]/m)
        if (modid_match && modid_match.length > 1) {
            //console.info("\t ^^ Found id secondary through regex")
            modid = modid_match[1]
        }
    }
    if (modid == undefined) {
        console.error("Failed to find any id from file " + file[1])
    }
    return modid
}

/**
 * @param {{ [s: string]: any; } | ArrayLike<any>} old_list
 */
function update_list(files: [string, string][], old_list: Object) {
    const std_object: file_object = {
        file_path: "",
        tags: ["SIDE.CLIENT", "SIDE.SERVER"],
        source: "",
        notes: "",
        wanted_by: [],
        wants: [],
        enabled: true
    }
    // Create maps from parameters
    let new_list: Map<string, file_object> = new Map(Object.entries(old_list));
    for (const file of files) {
        let file_obj = new_list.get(file[1])
        if (file_obj != undefined) {
            // Update path
            file_obj["file_path"] = file[0]
            file_obj.enabled = !file[0].includes(".jar.disabled")
            // Add missing attributes
            for (const key in std_object) {
                if (file_obj[key] == undefined) {
                    file_obj[key] = std_object[key]
                }
            }
        } else {
            file_obj = clone(std_object)
            file_obj.file_path = file[0]
            file_obj.enabled = !file[0].includes(".jar.disabled")

            new_list.set(file[1], file_obj)
        }
    }
    // Update list with backtraced deps
    trace_deps(new_list)

    return new_list;
}

/**
 * Figure out what mods a mod is wanted by
 */
function trace_deps(mod_list: Map<string, file_object>) {
    for (const [mod_id, mod] of mod_list) {
        if (mod.wants != undefined && mod.wants.length > 0) {
            for (const dep_id of mod.wants) {
                const dep = mod_list.get(dep_id)
                if (dep) {
                    // Check if wanted_by list contains the current mod that wants this mod
                    if (dep.wanted_by != undefined && !dep.wanted_by.includes(mod_id)) {
                        dep.wanted_by.push(mod_id)
                        console.log("Added missing dependent ", mod_id, " to ", dep_id)
                    } else if (dep.wanted_by == undefined) {
                        dep.wanted_by = [mod_id]
                        console.log("Added missing dependent ", mod_id, " to ", dep_id)
                    }
                }
            }
        }
    }
}


//#region binary
async function binary_search_disable(target_fraction: string) {
    const annotated_file = "./annotated_mods.json"
    const file_contents = await read_from_file(annotated_file)
    const mod_map: Map<string, file_object> = new Map(Object.entries(file_contents));
    const mod_list = Array.from(mod_map.keys())

    // So we don't save again later
    let undo = false;
    if (target_fraction === "undo") {
        const last_rev = await revision_hist_pop();
        if (last_rev != undefined) {
            target_fraction = last_rev;
            undo = true;
        }
    }

    const [section, scope] = target_fraction.split("/").map(Number)

    if (section != undefined && scope != undefined) {
        const groups = divide_to_full_groups(mod_list.length, scope)

        let change_limit: number = groups[section] || 0;
        // Sum of groups up to this one (section)
        //TODO: Does nothing for 32/32
        let start_idx: number = groups.reduce((previousValue: number, currentValue: number, currentIndex: number) => currentIndex < section ? previousValue + currentIndex : previousValue, 0);
        let change_count: number = 0;
        let skip_count: number = 0;
        const changed_list: Array<string> = []

        while (change_count < change_limit) {
            // Are we above the the maximum number of mods?
            if (start_idx + change_count > mod_list.length) {
                start_idx = start_idx + change_count - mod_list.length;
            }

            const mod_id = mod_list[start_idx + change_count + skip_count]
            if (mod_id != undefined) {
                const changed_mods = await disable_mod_deep(mod_id, mod_map, changed_list);
                if (changed_mods == 0) {
                    // We might hit some mods multiple times, and therefore skip them, leading to no changes, 
                    // and us infinitely re-testing the specific index. This increments on skipped mods
                    skip_count++;
                } else {
                    change_count += changed_mods;
                }
            } else {
                //TODO: OOB for i.e. 32/31
                console.error("Mod list OOB")
            }
        }

        if (change_count > 0) {
            save_map_to_file(annotated_file, mod_map)
            if (!undo) revision_hist_push(target_fraction)
            console.log("Changed ", change_count, " mods.")
        } else {
            console.log("No changes made.")
        }
    } else {
        console.error("Received faulty fraction.")
    }
}

async function revision_hist_push(rev: string) {
    const file_path = "./.annotate_history.json"

    const rev_list: Array<string> = Array.from(Object.values(await read_from_file(file_path)))
    rev_list.push(rev)
    console.log("Adding revision ", rev, " to history.")
    await save_list_to_file(file_path, rev_list)
}

async function revision_hist_pop(): Promise<string | undefined> {
    const file_path = "./.annotate_history.json"

    const rev_list: Array<string> = Array.from(Object.values(await read_from_file(file_path)))
    const rev = rev_list.pop()
    if (rev) console.log("Removed revision ", rev, " from history.")
    await save_list_to_file(file_path, rev_list)

    return rev;
}

async function rename_file(old_path: string, new_path: string) {
    const old_file = Bun.file(old_path)
    if (await old_file.exists()) {
        const new_file = Bun.file(new_path)
        await Bun.write(new_file, old_file)
        await old_file.delete()
    } else {
        console.log("File ", old_path, " does not exist, but we tried to rename it.")
    }
}

async function disable_mod_deep(mod_id: string, mod_map: Map<string, file_object>, changed_list: Array<string>): Promise<number> {
    let change_count = 0;

    const mod = mod_map.get(mod_id);
    if (mod && !changed_list.includes(mod_id)) {
        // Disable dependents
        if (mod.wanted_by) {
            for (const dependency of mod.wanted_by) {
                change_count += await disable_mod_deep(dependency, mod_map, changed_list)
            }
        }
        // Disable self
        mod.enabled = !mod.enabled
        if (mod.enabled) {
            // Mod was disabled before (as is the name now), remove .disabled suffix
            const new_path = mod.file_path.replace(/\.disabled$/m, "")
            await rename_file(mod.file_path, new_path)
            mod.file_path = new_path
        } else {
            // Mod was enabled before (as is the name now), add .disabled suffix
            const new_path = mod.file_path + ".disabled"
            await rename_file(mod.file_path, new_path)
            mod.file_path = new_path
        }
        changed_list.push(mod_id)
        change_count++;
    }

    return change_count;
}



//#region Entrypoint
async function main() {
    const args = process.argv.slice(2);
    const mode = args[0]?.toLowerCase();

    try {
        switch (mode) {
            case 'annotate':
                await annotate();
                console.log('Mod list updated successfully!');
                break;
            case 'list':
                for (const [file_path, mod_id] of await scan_mods_folder("../.minecraft/mods/")) {
                    console.log(`${mod_id}: ${file_path}`);
                }
                break;
            case 'binary':
                const opts = args[1];
                if (opts != undefined) {
                    await binary_search_disable(opts)
                } else {
                    console.error("Missing target fraction for mode binary, i.e. [1/4].")
                }
                break;
            default:
                console.log('Usage: node annotate.js [mode]');
                console.log('Modes:');
                console.log('  update                            - Update annotated mod list');
                console.log('  list                              - List all indexed mods');
                console.log('  binary [target fraction | undo]   - Perform a deep-disable for a binary section');
                process.exit(1);
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