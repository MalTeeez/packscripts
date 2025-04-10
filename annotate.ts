//@ts-check
import fg from "fast-glob";
import yauzl from "yauzl";

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

/** 
 * Scan a folder of mods
 * @param {string} directory The path to this directory, with a trailing slash
 * @returns {Promise<Array<[string, string | undefined]>>}
 */
async function scan_mods_folder(directory: string): Promise<Array<[string, string | undefined]>> {
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
 * Save a javascript object to a file
 * @param {string} file_path Path of the file to save in
 * @param {*} data Data to save. Must be parseable by JSON.stringify
 */
async function save_to_file(file_path: string, data: any) {
    const file = Bun.file(file_path)
    try {
        if (await file.exists()) {
            file.write(JSON.stringify(Object.fromEntries(data)))
        }
    } catch (err) {
        console.error(err);
    }
}

/**
 * Read a javascript object from a file and parse it with json
 * @param {string} file_path Path of the file to read
 */
async function read_from_file(file_path: string) {
    const file = Bun.file(file_path)
    
    if (await file.exists()) {
        try {
            return JSON.parse(await file.text());
        } catch (err) {
            console.error(err);
        }
    } else {
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
                reject(new Error("File not found in zip archive for file "+ zipFilePath));
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
 * @param {Array<*>} files
 * @param {{ [s: string]: any; } | ArrayLike<any>} old_list
 */
function update_list(files: any[], old_list: { [s: string]: unknown; } | ArrayLike<unknown> | Promise<any>) {
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
    const new_list = new Map(Object.entries(old_list));
    for (const file of files) {
        let file_obj: file_object;
        if (new_list.has(file[1])) {
            file_obj = new_list.get(file[1])
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
    return new_list;
}


async function annotate() {
    const annotated_file = "./annotated_mods.json"

    const files = await scan_mods_folder("../.minecraft/mods/");
    const old_list = read_from_file(annotated_file)
    
    save_to_file(annotated_file, update_list(files, old_list));
}


async function binary_search_disable(target_fraction: string) {
    const annotated_file = "./annotated_mods.json"
    const mod_map: Map<string, file_object> = new Map(Object.entries(read_from_file(annotated_file)));
    const mod_list = Array.from(mod_map.keys())

    const [section, scope] = target_fraction.split("/").map(Number)

    if (section != undefined && scope != undefined) {
        const groups = divide_to_full_groups(mod_list.length, scope)
    
    let change_limit: number = groups[section] || 0;
    let start_idx: number = groups.reduce((previousValue: number, currentValue: number, currentIndex: number) => currentIndex < section ? previousValue + currentIndex : previousValue, 0);
    let change_count: number = 0;

    while (change_count < change_limit) {
        // Are we above the the maximum number of mods?
        if (start_idx + change_count > mod_list.length) {
            start_idx = start_idx + change_count - mod_list.length;
        }
        
        const mod_id = mod_list[start_idx + change_count]
        if (mod_id != undefined) {
            change_count += disable_mod_deep(mod_id, mod_map)
        } else {
            console.error("Mod list OOB")
        }
    }
    }
}

function disable_mod_deep(mod_id: string, mod_map: Map<string, file_object>): number {
    let change_count = 0;

    const mod = mod_map.get(mod_id);
    if (mod) {
        if (mod.wanted_by) {
            for (const dependency of mod.wanted_by) {
                change_count += disable_mod_deep(dependency, mod_map)
            }
        }
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
                    binary_search_disable(opts)
                } else {
                    console.error("Missing target fraction for mode binary, i.e. [1/4].")
                }
                break;
            default:
                console.log('Usage: node annotate.js [mode]');
                console.log('Modes:');
                console.log('  update                     - Update annotated mod list');
                console.log('  list                       - List all indexed mods');
                console.log('  binary [target fraction]   - Perform a deep-disable for a binary section');
                process.exit(1);
        }
        process.exit(0);
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