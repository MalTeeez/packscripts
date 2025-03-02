//@ts-check
import fg from "fast-glob";
import fs from "fs";
import yauzl from "yauzl";

/**
 * Scan a folder of mods
 * @param {string} directory The path to this directory, with a trailing slash
 */
async function scan_mods_folder(directory) {
    const files = fg.sync(directory + "**/*", { onlyFiles: true, deep: 4, globstar: true });

    const extension_pattern = /\/mods\/(.+\.(?:jar(?:\.disabled)?))$/m;
    const filtered_files = [];

    for (const file of files) {
        const match = file.match(extension_pattern);
        if (match && match.length > 1) {
            /**
             * @type [string, string]
             */
            const file_tuple = [file, match[1]];
            filtered_files.push([file, await parse_mod_id(file_tuple)]);
        }
    }

    return  filtered_files;
}

/**
 * Save a javascript object to a file
 * @param {string} file Path of the file to save in
 * @param {*} data Data to save. Must be parseable by JSON.stringify
 */
function save_to_file(file, data) {
    try {
        fs.writeFileSync(file, JSON.stringify(Object.fromEntries(data)));
    } catch (err) {
        console.error(err);
    }
}

/**
 * Read a javascript object from a file and parse it with json
 * @param {string} file Path of the file to read
 */
function read_from_file(file) {
    if (!fs.existsSync(file)) {
        return {}
    }
    try {
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (err) {
        console.error(err);
    }
}

/**
 * Extract the content of a file inside a zip archive
 * @param {string} zipFilePath The path to the zip file
 * @param {string} fileName The name of the file to extract
 * @returns {Promise<string>} The content of the file
 */
function extract_file_from_zip(zipFilePath, fileName) {
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
                            const fileData = []
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
export function clone(object) {
    return Object.assign({}, object);
}

/**
 * Parse the mcmod.info inside a mod file, to get its id
 * @param {[string, string]} file A tuple of the full path, and its resource path
 */
async function parse_mod_id(file) {
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
function update_list(files, old_list) {
    const std_object = { 
        file_path: "",
        tags: ["SIDE.CLIENT, SIDE.SERVER"],
        source: "",
        notes: "",
        wanted_by: [],
        wants: [],
        enabled: true
    }
    // Create maps from parameters
    const new_list = new Map(Object.entries(old_list));
    for (const file of files) {
        let file_obj;
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

const annotated_file = "./annotated_mods.json"

const files = await scan_mods_folder("../.minecraft/mods/");
const old_list = read_from_file(annotated_file)

save_to_file(annotated_file, update_list(files, old_list));
