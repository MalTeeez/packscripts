import yauzl from 'yauzl';

export interface mod_object {
    file_path: string;
    tags: string[] | undefined;
    source: string | undefined;
    notes: string | undefined;
    wanted_by: string[] | undefined;
    wants: string[] | undefined;
    enabled: boolean | undefined;
    [key: string]: string | string[] | boolean | undefined;
}

export type JsonObject = { [key: string]: JsonObject | Array<JsonObject> | string | undefined };

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
    const groups: number[] = new Array();

    const base_size = Math.floor(base / divisor);
    for (let i = divisor; i--; ) {
        groups.push(base_size);
    }
    const leftover = base % divisor;
    if (leftover) {
        // Add one to each group until leftover is distributed
        for (let i = 0; i < leftover; i++) {
            // @ts-ignore
            groups[i] += 1;
        }
    }

    return groups;
}

/**
 * Save a javascript map object to a file
 * @param {string} file_path Path of the file to save in
 * @param {*} data Data to save. Must be parseable by JSON.stringify
 */
export async function save_map_to_file(file_path: string, data: Map<string, { [key: string]: any }>) {
    try {
        // Sort and convert to object
        const map_obj: { [key: string]: any } = {};
        data.keys()
            .toArray()
            .sort()
            .forEach((key) => {
                map_obj[key] = data.get(key);
            });

        await Bun.write(file_path, JSON.stringify(map_obj));
        await run_prettier(file_path);
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
        await Bun.write(file_path, JSON.stringify(data));
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
    const file = Bun.file(file_path);
    if (await file.exists()) {
        try {
            return JSON.parse(await file.text());
        } catch (err) {
            console.error(err);
            return {};
        }
    } else {
        console.error('File ', file, ' does not exist.');
        return {};
    }
}

export async function search_zip_for_string(zipFilePath: string, target: string): Promise<Map<string, string> | undefined> {
    const results = await new Promise((resolve, reject) => {
        yauzl.open(zipFilePath, { lazyEntries: true }, (err, zipfile) => {
            if (err) return reject(err);
            const results: Map<string, string> = new Map();
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                if (/\/$/.test(entry.fileName)) {
                    // Directory file names end with '/'.
                    // Note that entries for directories themselves are optional.
                    // An entry's fileName implicitly requires its parent directories to exist.
                    zipfile.readEntry();
                } else {
                    // file entry
                    zipfile.openReadStream(entry, (err, readStream) => {
                        let found_target = false;
                        if (err) return reject(err);
                        const fileData: string[] = [];
                        readStream.on('data', (data) => {
                            if (String(data).includes(target)) {
                                found_target = true;
                            }
                            fileData.push(data);
                        });
                        readStream.on('end', () => {
                            if (found_target) {
                                results.set(entry.fileName, fileData.join(''));
                            }
                        });
                    });
                    // Not our file, try next
                    zipfile.readEntry();
                }
            });
            zipfile.on('end', () => {
                if (results.size > 0) {
                    resolve(results)
                } else {
                    reject('Failed to find target string in zip file.')
                }
            });
        });
    }).then((results) => results).catch((err) => undefined);

    //@ts-ignore
    return results
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
            zipfile.on('entry', function (entry) {
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
                            const fileData: string[] = [];
                            readStream.on('data', (data) => {
                                fileData.push(data);
                            });
                            readStream.on('end', () => {
                                return resolve(fileData.join(''));
                            });
                        });
                    } else {
                        // Not our file, try next
                        zipfile.readEntry();
                    }
                }
            });
            zipfile.on('end', () => {
                reject(new Error('File not found in zip archive for file ' + zipFilePath));
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

export async function run_prettier(file_path: string) {
    try {
        const proc = Bun.spawn(['bunx', 'prettier', '--write', file_path]);
        const output = await new Response(proc.stdout).text();
        const error = await new Response(proc.stderr).text();

        if (error) {
            console.error('Prettier error:', error);
        }
        return output;
    } catch (err) {
        console.error('Failed to run prettier:', err);
    }
}

/**
 * Convert a string that defines a version to an array of individual smaller versions, to compare with
 * another version array. Can also handle letters, but will treat them as less significant than numbers.
 */
export function version_string_to_comparable(version_string: string) {
    // Get all tokens (digits and letters together)
    const version_tokens: number[] = [];

    for (const match of version_string.matchAll(/(\d+|[a-zA-Z]+)/g)) {
        const token = match[1];
        if (token != undefined) {
            if (!Number.isNaN(+token)) {
                let number_token = +token;
                // Get count of zeroes
                const leading_zero_length = token.match(/^(0*)/m)?.[1]?.length;
                if (leading_zero_length != undefined && leading_zero_length > 0) {
                    number_token = round_to_x_decimals(number_token / 10 ** leading_zero_length, 4);
                }
                version_tokens.push(number_token);
            } else {
                for (const char of token) {
                    let number_token = char.charCodeAt(0) / 128;
                    version_tokens.push(round_to_x_decimals(number_token, 4));
                }
            }
        }
    }

    return version_tokens;
}

/**
 * Compare 2 version strings, for which one is bigger (newer).
 * @param version_a The first version string to compare against.
 * @param version_b The second version to compare to.
 * @returns -1 if {other} is newer, 0 if both are the same, 1 if {base} is newer.
 */
export function compare_versions(base: string, other: string) {
    const version_a = version_string_to_comparable(base);
    const version_b = version_string_to_comparable(other);

    let i = 0;
    let j = 0;

    while (i < version_a.length && j < version_b.length) {
        if (version_a[i] == version_b[j]) {
            i++;
            j++;
            //@ts-ignore Safe by bounds
        } else if (version_a[i] > version_b[j]) {
            return 1;
        } else {
            return -1;
        }
    }

    // Are both the same?
    if (i == version_a.length && j == version_b.length) return 0;
    // Was b longer? (Still has items)
    if (i == version_a.length) return -1;
    // Was a longer? (still has items)
    return 1;
}

/**
 * Prints the values in an array in a column-like fashion.
 * Accepts arrays as a tuple, of type [header text, array values].
 */
export function print_pretty(...args: [string, string[]][]) {
    let lengths: number[] = Array(args.length).fill(0);
    const lines: Array<string[]> = [];
    let i = 0;
    let max_size = 0;

    // Calculate maximum lengths per col
    for (const [header, array] of args) {
        const full_arr = [...[header], ...array]
        for (const text of full_arr) {
            lengths[i] = Math.max(lengths[i] || 0, text.length);
        }
        lines.push(full_arr);
        max_size = Math.max(max_size, array.length);
        i++;
    }
    
    // Header & Footer rows
    i = 0;
    let output = "┌─";
    let footer = "└─";
    for (const arr of lines) {
        const header = arr[0] || "";
        // Header is left-aligned, and uses the first entry in each column
        output += header + "─".repeat((lengths[i] || header.length) - header.length);
        // Footer is right-aligned and contains the number of items in its respective column
        const footer_text = "(" + (arr.length - 1) + " item" + ((arr.length - 1) == 1 ? "" : "s") + ")";
        footer += "─".repeat((lengths[i] || footer_text.length) - footer_text.length) + footer_text

        if (i >= lengths.length - 1) {
            output += "─┐\n";
            footer += "─┘\n";
        } else {
            output += "─┬─";
            footer += "─┴─";
        }
        i++;
    }
    
    // Data rows
    for (i = 1; i <= max_size; i++) {
        let row = "| ";
        let col_num = 0;
        for (const arr of lines) {
            const text = arr[i] || "";
            // Align text left, numbers right
            if (Number.isNaN(+text)) {
                row += text + " ".repeat((lengths[col_num] || text.length) - text.length);
            } else {
                row += " ".repeat((lengths[col_num] || text.length) - text.length) + text;
            }
            
            if (col_num < lengths.length - 1) row += " | ";
            col_num++;
        }
        output += row + " |\n"
    }

    output += footer;
    console.log(output)
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