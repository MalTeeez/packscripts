import yauzl from "yauzl";


export interface mod_object {
    "file_path": string;
    "tags": string[] | undefined;
    "source": string | undefined;
    "notes": string | undefined;
    "wanted_by": string[] | undefined;
    "wants": string[] | undefined;
    "enabled": boolean | undefined;
    [key: string]: string | string[] | boolean | undefined;
}

export type JsonObject = { [key: string]: JsonObject | Array<JsonObject> | string | undefined }

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
 * Save a javascript map object to a file
 * @param {string} file_path Path of the file to save in
 * @param {*} data Data to save. Must be parseable by JSON.stringify
 */
export async function save_map_to_file(file_path: string, data: Map<string, mod_object>) {
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
export async function save_list_to_file(file_path: string, data: Array<string>) {
    try {
        await Bun.write(file_path, JSON.stringify(data))
    } catch (err) {
        console.error(err);
    }
}

export async function read_arr_from_file(file_path: string): Promise<Array<string>> {
    const string_list = Array.from(Object.values(await read_from_file(file_path)));
    if (string_list != undefined && Array.isArray(string_list)) {
        return string_list.filter((item): item is string => typeof item === 'string');
    } else {
        return [];
    }
}

/**
 * Read a javascript object from a file and parse it with json
 * @param {string} file_path Path of the file to read
 */
export async function read_from_file(file_path: string): Promise<JsonObject> {
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
export function extract_file_from_zip(zipFilePath: string, fileName: string): Promise<string> {
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
export function clone(object: mod_object): mod_object {
    return Object.assign({}, object);
}