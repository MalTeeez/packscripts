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
 * Clone an object, mostly to forgo refs.
 * @param {Object} object The object to clone
 * @returns A reference to a new object, duplicate of the input object
 */
export function clone(object: object): object {
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
        const full_arr = [...[header], ...array];
        for (const text of full_arr) {
            lengths[i] = Math.max(lengths[i] || 0, text.length);
        }
        lines.push(full_arr);
        max_size = Math.max(max_size, array.length);
        i++;
    }

    // Header & Footer rows
    i = 0;
    let output = '┌─';
    let footer = '└─';
    for (const arr of lines) {
        const header = arr[0] || '';
        // Header is left-aligned, and uses the first entry in each column
        output += header + '─'.repeat((lengths[i] || header.length) - header.length);
        // Footer is right-aligned and contains the number of items in its respective column
        const footer_text = '(' + (arr.length - 1) + ' item' + (arr.length - 1 == 1 ? '' : 's') + ')';
        footer += '─'.repeat((lengths[i] || footer_text.length) - footer_text.length) + footer_text;

        if (i >= lengths.length - 1) {
            output += '─┐\n';
            footer += '─┘\n';
        } else {
            output += '─┬─';
            footer += '─┴─';
        }
        i++;
    }

    // Data rows
    for (i = 1; i <= max_size; i++) {
        let row = '| ';
        let col_num = 0;
        for (const arr of lines) {
            const text = arr[i] || '';
            // Align text left, numbers right
            if (Number.isNaN(+text)) {
                row += text + ' '.repeat((lengths[col_num] || text.length) - text.length);
            } else {
                row += ' '.repeat((lengths[col_num] || text.length) - text.length) + text;
            }

            if (col_num < lengths.length - 1) row += ' | ';
            col_num++;
        }
        output += row + ' |\n';
    }

    output += footer;
    console.log(output);
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

/**
 * Basically string.replace(), but start at the back of the string.
 */
export function rev_replace_all(input: string, target: string, replacer: string): string {
    const block_length = target.length - 1;
    let builder = "";
    for (let i = input.length - 1; i >= 0; i--) {
        if (i - block_length >= 0 && input.slice(i - block_length, i + 1) === target) {
            builder = replacer + builder;
            i -= block_length;
        } else {
            builder = input.at(i) + builder;
        }
    }
    return builder;
}

export enum CLIColor {
    Reset = "\x1b[0m",
    Bright = "\x1b[1m",
    Dim = "\x1b[2m",
    Underscore = "\x1b[4m",
    Blink = "\x1b[5m",
    Reverse = "\x1b[7m",
    Hidden = "\x1b[8m",

    FgBlack = "\x1b[30m",
    FgRed = "\x1b[31m",
    FgGreen = "\x1b[32m",
    FgYellow = "\x1b[33m",
    FgBlue = "\x1b[34m",
    FgMagenta = "\x1b[35m",
    FgCyan = "\x1b[36m",
    FgWhite = "\x1b[37m",
    FgGray = "\x1b[90m",

    BgBlack = "\x1b[40m",
    BgRed = "\x1b[41m",
    BgGreen = "\x1b[42m",
    BgYellow = "\x1b[43m",
    BgBlue = "\x1b[44m",
    BgMagenta = "\x1b[45m",
    BgCyan = "\x1b[46m",
    BgWhite = "\x1b[47m",
    BgGray = "\x1b[100m"
}