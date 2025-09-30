import fg from 'fast-glob';
import yauzl from 'yauzl';
import { rename } from "node:fs/promises";
import { run_prettier, type JsonObject } from './utils';

/**
 * Scan a folder of mods
 * @param {string} directory The path to this directory, with a trailing slash
 * @returns {Promise<Map<string, string>>} A map of <file path, file basename>, should only contain mod jars
 */
export async function scan_mods_folder(directory: string): Promise<Map<string, string>> {
    const files = fg.sync(directory + '**/*', { onlyFiles: true, deep: 4, globstar: true });

    const extension_pattern = /^.*\/(.+\.(?:jar(?:.*\.disabled)?))$/m;
    // Array of [file_path, file_name]
    const filtered_files: Map<string, string> = new Map();

    for (const file_path of files) {
        const match = file_path.match(extension_pattern);
        // Is this file a type we want, and is it not in our ignored directory
        if (match && match.length >= 2 && !file_path.includes('disabled_mods')) {
            const file_name = match.at(1);
            if (file_name !== undefined) {
                filtered_files.set(file_path, file_name);
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
 * Rename a file to a new file
 */
export async function rename_file(old_path: string, new_path: string) {
    const old_file = Bun.file(old_path);
    if (await old_file.exists()) {
        await rename(old_path, new_path);
    } else {
        console.log('File ', old_path, ' does not exist, but we tried to rename it.');
    }
}