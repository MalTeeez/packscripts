import fg from 'fast-glob';
import yauzl from 'yauzl';
import yazl from 'yazl';
import { open, rename } from 'node:fs/promises';
import { run_prettier, type JsonObject } from './utils';
import { closeSync, openSync, readdirSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { text } from 'node:stream/consumers';
import type { SupportedCryptoAlgorithms } from 'bun';

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
 * Glob all files of a specified extension (.jar, .exe, ...) from a target directory
 */
export async function glob_files_in_dir(directory: string, file_ext_pattern: RegExp, recursive: boolean): Promise<string[]> {
    const dirty_files = fg.sync(directory + '**/*', { onlyFiles: true, deep: 4, globstar: recursive });
    const files: string[] = [];
    for (const file_path of dirty_files) {
        if (file_path.match(file_ext_pattern)) {
            files.push(file_path);
        }
    }
    return files;
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
export async function save_list_to_file(file_path: string, data: Array<any>) {
    try {
        await Bun.write(file_path, JSON.stringify(data));
    } catch (err) {
        console.error(err);
    }
}

export async function read_string_arr_from_file(file_path: string): Promise<Array<string>> {
    return (await read_arr_from_file(file_path)).filter((item): item is string => typeof item === 'string');
}

export async function read_arr_from_file(file_path: string): Promise<Array<any>> {
    const array = Array.from(Object.values(await read_from_file(file_path)));
    if (array != undefined && Array.isArray(array)) {
        return array;
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
        console.info(`File ${file.name} with annotated mods does not yet exist. Building from empty state.`);
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
                    resolve(results);
                } else {
                    reject('Failed to find target string in zip file.');
                }
            });
        });
    })
        .then((results) => results)
        .catch((err) => undefined);

    //@ts-ignore
    return results;
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
 * Bundles a list of files into a zip archive written to disk.
 * @param files - Array of file descriptors, each specifying a `relative_path` (source on disk) and `path_inside_zip` (destination path within the archive).
 * @param output_path - The file path where the resulting zip will be written.
 */
export async function bundle_files_to_zip(files: { relative_path: string; path_inside_zip: string }[], output_path: string): Promise<void> {
    const zip_file = new yazl.ZipFile();

    for (const { relative_path, path_inside_zip } of files) {
        zip_file.addFile(relative_path, path_inside_zip);
    }

    zip_file.end();

    const chunks: Buffer[] = [];
    for await (const chunk of zip_file.outputStream) {
        chunks.push(chunk as Buffer);
    }

    await Bun.write(output_path, Buffer.concat(chunks));
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

export async function is_folder_locked(folderPath: string): Promise<boolean> {
    const abs_path = resolve(folderPath);

    switch (process.platform) {
        case 'linux':
        case 'darwin':
            return await is_folder_locked_lsof(abs_path);
        case 'win32':
            return await is_folder_locked_windows(abs_path);
        default:
            return is_folder_locked_fallback(abs_path);
    }
}

async function is_folder_locked_lsof(abs_path: string): Promise<boolean> {
    try {
        const { stdout } = execFile('lsof', ['+D', abs_path]);
        if (stdout != null) {
            const out = await text(stdout);
            const other_procs = out
                .trim()
                .split('\n')
                .slice(1) // skip header
                .filter((line) => {
                    const pid = parseInt(line.split(/\s+/)[1] as string);
                    return pid !== process.pid;
                });
            return other_procs.length > 0;
        }
    } catch (err: any) {
        if (err.code === 1) return false;
        //console.warn('lsof failed, falling back:', err.message);
    }
    return is_folder_locked_fallback(abs_path);
}

async function is_folder_locked_windows(abs_path: string): Promise<boolean> {
    const escaped = abs_path.replace(/'/g, "''");
    const script = `
    $locked = $false
    Get-ChildItem -Path '${escaped}' -Recurse -File | ForEach-Object {
      try {
        $f = [System.IO.File]::Open($_.FullName, 'Open', 'ReadWrite', 'None')
        $f.Close()
      } catch {
        $locked = $true
      }
    }
    Write-Output $locked
  `;
    try {
        const { stdout } = execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
        if (stdout != null) {
            const firstTimeout = setTimeout(() => {
                console.warn('W: Still checking lock of mods folder, waiting 20 more seconds (should be faster on following runs).');
            }, 10000);
            const secondTimeout = setTimeout(() => {
                console.warn('W: Failed to check if mods folder is locked within 30 seconds, assuming its safe to proceed.');
            }, 30000);

            const out = await text(stdout).finally(() => {
                firstTimeout.close();
                secondTimeout.close();
            });
            return out.trim().toLowerCase() === 'true';
        }
    } catch (err: any) {
        console.warn('W: Failed to check if mods folder is locked:', err.message);
    }
    return false;
}

function is_folder_locked_fallback(abs_path: string): boolean {
    const walk = (dir: string): boolean => {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) {
                if (walk(full)) return true;
            } else {
                try {
                    closeSync(openSync(full, 'r+'));
                } catch (err: any) {
                    if (err.code === 'EBUSY') return true; // only flag actual busy errors
                }
            }
        }
        return false;
    };
    return walk(abs_path);
}

export function path_is_directory(path: string): boolean {
    try {
        return statSync(path).isDirectory();
    } catch {
        return false;
    }
}

export async function hash_file(path: string, algorithm: SupportedCryptoAlgorithms = 'sha256'): Promise<string> {
    const hasher = new Bun.CryptoHasher(algorithm);
    const file = await open(path, 'r');

    try {
        for await (const chunk of file.createReadStream()) {
            hasher.update(chunk);
        }
    } finally {
        await file.close();
    }

    return hasher.digest('hex');
}
