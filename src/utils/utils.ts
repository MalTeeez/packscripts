import type { SupportedCryptoAlgorithms } from "bun";
import { IS_LIMITED_ENV } from "./config";

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
 * Deep-Clone an object, mostly to forgo refs.
 * @param {Object} object The object to clone
 * @returns A reference to a new object, duplicate of the input object
 */
export function clone(object: object): object {
    if (Array.isArray(object)) {
        const copy: Array<any> = object.slice();
        for (let i = 0; i < object.length; i++) {
            if (typeof object[i] === 'object') {
                copy[i] = clone(object[i]);
            }
        }
        return copy;
    } else {
        const copy: { [key: string]: any } = Object.assign({}, object);
        for (const [key, value] of Object.entries(object)) {
            if (typeof value === 'object') {
                copy[key] = clone(value);
            }
        }
        return copy;
    }
}

export async function run_prettier_on_file(file_path: string) {
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
 * @param return_value An optional value to return once the delay is done
 * @returns A promise to await
 */
export function delay(t: number | undefined, return_value?: any) {
    return new Promise((resolve) => setTimeout(() => resolve(return_value), t));
}

/**
 * Basically string.replace(), but start at the back of the string.
 */
export function rev_replace_all(input: string, target: string, replacer: string): string {
    const block_length = target.length - 1;
    let builder = '';
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
    Reset = '\x1b[0m',
    Bright = '\x1b[1m',
    Dim = '\x1b[2m',
    Underscore = '\x1b[4m',
    Blink = '\x1b[5m',
    Reverse = '\x1b[7m',
    Hidden = '\x1b[8m',

    FgBlack = '\x1b[30m',
    FgRed = '\x1b[31m',
    FgGreen = '\x1b[32m',
    FgYellow = '\x1b[33m',
    FgBlue = '\x1b[34m',
    FgMagenta = '\x1b[35m',
    FgCyan = '\x1b[36m',
    FgWhite = '\x1b[37m',
    FgGray = '\x1b[90m',

    BgBlack = '\x1b[40m',
    BgRed = '\x1b[41m',
    BgGreen = '\x1b[42m',
    BgYellow = '\x1b[43m',
    BgBlue = '\x1b[44m',
    BgMagenta = '\x1b[45m',
    BgCyan = '\x1b[46m',
    BgWhite = '\x1b[47m',
    BgGray = '\x1b[100m',

    /** #000000 */
    BgBlack0 = '\x1b[48;5;0m',
    /** #7F7F7F */
    BgBlack1 = '\x1b[48;5;8m',

    /** #CD0000 */
    BgRed0 = '\x1b[48;5;1m',
    /** #FF0000 */
    BgRed1 = '\x1b[48;5;9m',

    /** #00CD00 */
    BgGreen0 = '\x1b[48;5;2m',
    /** #00FF00 */
    BgGreen1 = '\x1b[48;5;10m',

    /** #CDCD00 */
    BgYellow0 = '\x1b[48;5;3m',
    /** #FFFF00 */
    BgYellow1 = '\x1b[48;5;11m',

    /** #0000EE */
    BgBlue0 = '\x1b[48;5;4m',
    /** #5C5CFF */
    BgBlue1 = '\x1b[48;5;12m',

    /** #CD00CD */
    BgMagenta0 = '\x1b[48;5;5m',
    /** #FF00FF */
    BgMagenta1 = '\x1b[48;5;13m',

    /** #00CDCD */
    BgCyan0 = '\x1b[48;5;6m',
    /** #00FFFF */
    BgCyan1 = '\x1b[48;5;14m',

    /** #E5E5E5 */
    BgWhite0 = '\x1b[48;5;7m',
    /** #FFFFFF */
    BgWhite1 = '\x1b[48;5;15m',

    // ── Red family (16–231 cube) ──────────────────────────────────────────────
    // Pure reds: r ramps, g=0, b=0

    /** #5F0000 */
    BgRed2 = '\x1b[48;5;52m',
    /** #870000 */
    BgRed3 = '\x1b[48;5;88m',
    /** #AF0000 */
    BgRed4 = '\x1b[48;5;124m',
    /** #D70000 */
    BgRed5 = '\x1b[48;5;160m',
    /** #FF0000 */
    BgRed6 = '\x1b[48;5;196m',

    // Warm reds: r=max, slight green tint

    /** #FF5F00 */
    BgRed7 = '\x1b[48;5;202m',
    /** #FF8700 */
    BgRed8 = '\x1b[48;5;208m',
    /** #FF5F5F */
    BgRed9 = '\x1b[48;5;203m',
    /** #FF8787 */
    BgRed10 = '\x1b[48;5;210m',
    /** #FFAFAF */
    BgRed11 = '\x1b[48;5;217m',

    // ── Green family (16–231 cube) ────────────────────────────────────────────
    // Pure greens: g ramps, r=0, b=0

    /** #005F00 */
    BgGreen2 = '\x1b[48;5;22m',
    /** #008700 */
    BgGreen3 = '\x1b[48;5;28m',
    /** #00AF00 */
    BgGreen4 = '\x1b[48;5;34m',
    /** #00D700 */
    BgGreen5 = '\x1b[48;5;40m',
    /** #00FF00 */
    BgGreen6 = '\x1b[48;5;46m',

    // Warm greens: g=max, slight yellow/teal tint

    /** #5FFF00 */
    BgGreen7 = '\x1b[48;5;82m',
    /** #87FF00 */
    BgGreen8 = '\x1b[48;5;118m',
    /** #AFFF00 */
    BgGreen9 = '\x1b[48;5;154m',
    /** #5FFF5F */
    BgGreen10 = '\x1b[48;5;83m',
    /** #87FF87 */
    BgGreen11 = '\x1b[48;5;120m',

    // ── Blue family (16–231 cube) ─────────────────────────────────────────────
    // Pure blues: b ramps, r=0, g=0

    /** #00005F */
    BgBlue2 = '\x1b[48;5;17m',
    /** #000087 */
    BgBlue3 = '\x1b[48;5;18m',
    /** #0000AF */
    BgBlue4 = '\x1b[48;5;19m',
    /** #0000D7 */
    BgBlue5 = '\x1b[48;5;20m',
    /** #0000FF */
    BgBlue6 = '\x1b[48;5;21m',

    // Cool blues: b=max, slight cyan/purple tint

    /** #005FFF */
    BgBlue7 = '\x1b[48;5;27m',
    /** #0087FF */
    BgBlue8 = '\x1b[48;5;33m',
    /** #00AFFF */
    BgBlue9 = '\x1b[48;5;39m',
    /** #5F5FFF */
    BgBlue10 = '\x1b[48;5;63m',
    /** #8787FF */
    BgBlue11 = '\x1b[48;5;105m',

    // ── Yellow family (16–231 cube) ───────────────────────────────────────────
    // Pure yellows: r+g ramp together, b=0

    /** #5F5F00 */
    BgYellow2 = '\x1b[48;5;58m',
    /** #878700 */
    BgYellow3 = '\x1b[48;5;100m',
    /** #AFAF00 */
    BgYellow4 = '\x1b[48;5;142m',
    /** #D7D700 */
    BgYellow5 = '\x1b[48;5;184m',
    /** #FFFF00 */
    BgYellow6 = '\x1b[48;5;226m',

    // Warm yellows: r=max, g varies

    /** #FFD700 */
    BgYellow7 = '\x1b[48;5;220m',
    /** #FFAF00 */
    BgYellow8 = '\x1b[48;5;214m',
    /** #FFFF5F */
    BgYellow9 = '\x1b[48;5;227m',
    /** #FFFF87 */
    BgYellow10 = '\x1b[48;5;228m',
    /** #FFFFAF */
    BgYellow11 = '\x1b[48;5;229m',

    // ── Cyan family (16–231 cube) ─────────────────────────────────────────────
    // Pure cyans: g+b ramp together, r=0

    /** #005F5F */
    BgCyan2 = '\x1b[48;5;23m',
    /** #008787 */
    BgCyan3 = '\x1b[48;5;30m',
    /** #00AFAF */
    BgCyan4 = '\x1b[48;5;37m',
    /** #00D7D7 */
    BgCyan5 = '\x1b[48;5;44m',
    /** #00FFFF */
    BgCyan6 = '\x1b[48;5;51m',

    // Blue-leaning cyans: b > g

    /** #00AFD7 */
    BgCyan7 = '\x1b[48;5;38m',
    /** #00D7FF */
    BgCyan8 = '\x1b[48;5;45m',
    /** #5FD7FF */
    BgCyan9 = '\x1b[48;5;81m',
    /** #87D7FF */
    BgCyan10 = '\x1b[48;5;117m',
    /** #AFFFFF */
    BgCyan11 = '\x1b[48;5;159m',

    // ── Magenta family (16–231 cube) ──────────────────────────────────────────
    // Pure magentas: r+b ramp together, g=0

    /** #5F005F */
    BgMagenta2 = '\x1b[48;5;53m',
    /** #870087 */
    BgMagenta3 = '\x1b[48;5;90m',
    /** #AF00AF */
    BgMagenta4 = '\x1b[48;5;127m',
    /** #D700D7 */
    BgMagenta5 = '\x1b[48;5;164m',
    /** #FF00FF */
    BgMagenta6 = '\x1b[48;5;201m',

    // Pink-leaning magentas: b > r or both bright

    /** #FF00AF */
    BgMagenta7 = '\x1b[48;5;199m',
    /** #FF00D7 */
    BgMagenta8 = '\x1b[48;5;200m',
    /** #FF5FFF */
    BgMagenta9 = '\x1b[48;5;207m',
    /** #FF87FF */
    BgMagenta10 = '\x1b[48;5;213m',
    /** #FFAFFF */
    BgMagenta11 = '\x1b[48;5;219m',

    // ── Orange family ─────────────────────────────────────────────────────────
    // r=max or near-max, g=low-mid, b=0

    /** #875F00 */
    BgOrange0 = '\x1b[48;5;94m',
    /** #AF5F00 */
    BgOrange1 = '\x1b[48;5;130m',
    /** #D75F00 */
    BgOrange2 = '\x1b[48;5;166m',
    /** #FF5F00 */
    BgOrange3 = '\x1b[48;5;202m',
    /** #FF8700 */
    BgOrange4 = '\x1b[48;5;208m',
    /** #FFAF00 */
    BgOrange5 = '\x1b[48;5;214m',
    /** #FFD700 */
    BgOrange6 = '\x1b[48;5;220m',
    /** #FF875F */
    BgOrange7 = '\x1b[48;5;209m',
    /** #FFAF5F */
    BgOrange8 = '\x1b[48;5;215m',
    /** #FFD75F */
    BgOrange9 = '\x1b[48;5;221m',

    // ── Pink family ───────────────────────────────────────────────────────────
    // r=max, b=mid-high, g=0 or low

    /** #FF005F */
    BgPink0 = '\x1b[48;5;197m',
    /** #FF0087 */
    BgPink1 = '\x1b[48;5;198m',
    /** #FF5F87 */
    BgPink2 = '\x1b[48;5;204m',
    /** #FF5FAF */
    BgPink3 = '\x1b[48;5;205m',
    /** #FF87AF */
    BgPink4 = '\x1b[48;5;211m',
    /** #FF87D7 */
    BgPink5 = '\x1b[48;5;212m',
    /** #FFAFD7 */
    BgPink6 = '\x1b[48;5;218m',
    /** #FFAFFF */
    BgPink7 = '\x1b[48;5;219m',
    /** #FFD7FF */
    BgPink8 = '\x1b[48;5;225m',
    /** #FF87FF */
    BgPink9 = '\x1b[48;5;213m',

    // ── Purple family ─────────────────────────────────────────────────────────
    // r=low-mid, b=high, g=0

    /** #5F0087 */
    BgPurple0 = '\x1b[48;5;55m',
    /** #5F00AF */
    BgPurple1 = '\x1b[48;5;56m',
    /** #5F00D7 */
    BgPurple2 = '\x1b[48;5;57m',
    /** #5F00FF */
    BgPurple3 = '\x1b[48;5;57m',
    /** #8700AF */
    BgPurple4 = '\x1b[48;5;91m',
    /** #8700D7 */
    BgPurple5 = '\x1b[48;5;92m',
    /** #8700FF */
    BgPurple6 = '\x1b[48;5;93m',
    /** #AF00FF */
    BgPurple7 = '\x1b[48;5;129m',
    /** #D700FF */
    BgPurple8 = '\x1b[48;5;165m',
    /** #875FD7 */
    BgPurple9 = '\x1b[48;5;98m',

    // ── Teal family ───────────────────────────────────────────────────────────
    // g=mid-high, b=mid-high, r=0 or low (off-axis cyans leaning green)

    /** #005F5F */
    BgTeal0 = '\x1b[48;5;23m',
    /** #005F87 */
    BgTeal1 = '\x1b[48;5;24m',
    /** #005FAF */
    BgTeal2 = '\x1b[48;5;25m',
    /** #00875F */
    BgTeal3 = '\x1b[48;5;29m',
    /** #008787 */
    BgTeal4 = '\x1b[48;5;30m',
    /** #0087AF */
    BgTeal5 = '\x1b[48;5;31m',
    /** #00AF87 */
    BgTeal6 = '\x1b[48;5;36m',
    /** #00AFAF */
    BgTeal7 = '\x1b[48;5;37m',
    /** #00AFD7 */
    BgTeal8 = '\x1b[48;5;38m',
    /** #5FAF87 */
    BgTeal9 = '\x1b[48;5;72m',

    // ── Lime family ───────────────────────────────────────────────────────────
    // g=max, slight red or blue tint

    /** #5FD700 */
    BgLime0 = '\x1b[48;5;76m',
    /** #87D700 */
    BgLime1 = '\x1b[48;5;112m',
    /** #AFD700 */
    BgLime2 = '\x1b[48;5;148m',
    /** #D7D700 */
    BgLime3 = '\x1b[48;5;184m',
    /** #D7FF00 */
    BgLime4 = '\x1b[48;5;190m',
    /** #AFFF00 */
    BgLime5 = '\x1b[48;5;154m',
    /** #87FF00 */
    BgLime6 = '\x1b[48;5;118m',
    /** #5FFF00 */
    BgLime7 = '\x1b[48;5;82m',
    /** #5FD75F */
    BgLime8 = '\x1b[48;5;77m',
    /** #87D75F */
    BgLime9 = '\x1b[48;5;113m',

    // ── White / light gray (cube) ─────────────────────────────────────────────

    /** #D7D7D7 */
    BgWhite2 = '\x1b[48;5;188m',
    /** #EEEEEE */
    BgWhite3 = '\x1b[48;5;255m',
    /** #FFFFFF */
    BgWhite4 = '\x1b[48;5;231m',

    // ── Grayscale ramp (codes 232–255) ───────────────────────────────────────
    // 0 = near-black, 23 = near-white

    /** #080808 */
    BgGray0 = '\x1b[48;5;232m',
    /** #121212 */
    BgGray1 = '\x1b[48;5;233m',
    /** #1C1C1C */
    BgGray2 = '\x1b[48;5;234m',
    /** #262626 */
    BgGray3 = '\x1b[48;5;235m',
    /** #303030 */
    BgGray4 = '\x1b[48;5;236m',
    /** #3A3A3A */
    BgGray5 = '\x1b[48;5;237m',
    /** #444444 */
    BgGray6 = '\x1b[48;5;238m',
    /** #4E4E4E */
    BgGray7 = '\x1b[48;5;239m',
    /** #585858 */
    BgGray8 = '\x1b[48;5;240m',
    /** #626262 */
    BgGray9 = '\x1b[48;5;241m',
    /** #6C6C6C */
    BgGray10 = '\x1b[48;5;242m',
    /** #767676 */
    BgGray11 = '\x1b[48;5;243m',
    /** #808080 */
    BgGray12 = '\x1b[48;5;244m',
    /** #8A8A8A */
    BgGray13 = '\x1b[48;5;245m',
    /** #949494 */
    BgGray14 = '\x1b[48;5;246m',
    /** #9E9E9E */
    BgGray15 = '\x1b[48;5;247m',
    /** #A8A8A8 */
    BgGray16 = '\x1b[48;5;248m',
    /** #B2B2B2 */
    BgGray17 = '\x1b[48;5;249m',
    /** #BCBCBC */
    BgGray18 = '\x1b[48;5;250m',
    /** #C6C6C6 */
    BgGray19 = '\x1b[48;5;251m',
    /** #D0D0D0 */
    BgGray20 = '\x1b[48;5;252m',
    /** #DADADA */
    BgGray21 = '\x1b[48;5;253m',
    /** #E4E4E4 */
    BgGray22 = '\x1b[48;5;254m',
    /** #EEEEEE */
    BgGray23 = '\x1b[48;5;255m',

    /** #000000 */
    FgBlack0 = '\x1b[38;5;0m',
    /** #7F7F7F */
    FgBlack1 = '\x1b[38;5;8m',

    /** #CD0000 */
    FgRed0 = '\x1b[38;5;1m',
    /** #FF0000 */
    FgRed1 = '\x1b[38;5;9m',

    /** #00CD00 */
    FgGreen0 = '\x1b[38;5;2m',
    /** #00FF00 */
    FgGreen1 = '\x1b[38;5;10m',

    /** #CDCD00 */
    FgYellow0 = '\x1b[38;5;3m',
    /** #FFFF00 */
    FgYellow1 = '\x1b[38;5;11m',

    /** #0000EE */
    FgBlue0 = '\x1b[38;5;4m',
    /** #5C5CFF */
    FgBlue1 = '\x1b[38;5;12m',

    /** #CD00CD */
    FgMagenta0 = '\x1b[38;5;5m',
    /** #FF00FF */
    FgMagenta1 = '\x1b[38;5;13m',

    /** #00CDCD */
    FgCyan0 = '\x1b[38;5;6m',
    /** #00FFFF */
    FgCyan1 = '\x1b[38;5;14m',

    /** #E5E5E5 */
    FgWhite0 = '\x1b[38;5;7m',
    /** #FFFFFF */
    FgWhite1 = '\x1b[38;5;15m',

    // ── Red family (16–231 cube) ──────────────────────────────────────────────
    // Pure reds: r ramps, g=0, b=0

    /** #5F0000 */
    FgRed2 = '\x1b[38;5;52m',
    /** #870000 */
    FgRed3 = '\x1b[38;5;88m',
    /** #AF0000 */
    FgRed4 = '\x1b[38;5;124m',
    /** #D70000 */
    FgRed5 = '\x1b[38;5;160m',
    /** #FF0000 */
    FgRed6 = '\x1b[38;5;196m',

    // Warm reds: r=max, slight green tint

    /** #FF5F00 */
    FgRed7 = '\x1b[38;5;202m',
    /** #FF8700 */
    FgRed8 = '\x1b[38;5;208m',
    /** #FF5F5F */
    FgRed9 = '\x1b[38;5;203m',
    /** #FF8787 */
    FgRed10 = '\x1b[38;5;210m',
    /** #FFAFAF */
    FgRed11 = '\x1b[38;5;217m',

    // ── Green family (16–231 cube) ────────────────────────────────────────────
    // Pure greens: g ramps, r=0, b=0

    /** #005F00 */
    FgGreen2 = '\x1b[38;5;22m',
    /** #008700 */
    FgGreen3 = '\x1b[38;5;28m',
    /** #00AF00 */
    FgGreen4 = '\x1b[38;5;34m',
    /** #00D700 */
    FgGreen5 = '\x1b[38;5;40m',
    /** #00FF00 */
    FgGreen6 = '\x1b[38;5;46m',

    // Warm greens: g=max, slight yellow/teal tint

    /** #5FFF00 */
    FgGreen7 = '\x1b[38;5;82m',
    /** #87FF00 */
    FgGreen8 = '\x1b[38;5;118m',
    /** #AFFF00 */
    FgGreen9 = '\x1b[38;5;154m',
    /** #5FFF5F */
    FgGreen10 = '\x1b[38;5;83m',
    /** #87FF87 */
    FgGreen11 = '\x1b[38;5;120m',

    // ── Blue family (16–231 cube) ─────────────────────────────────────────────
    // Pure blues: b ramps, r=0, g=0

    /** #00005F */
    FgBlue2 = '\x1b[38;5;17m',
    /** #000087 */
    FgBlue3 = '\x1b[38;5;18m',
    /** #0000AF */
    FgBlue4 = '\x1b[38;5;19m',
    /** #0000D7 */
    FgBlue5 = '\x1b[38;5;20m',
    /** #0000FF */
    FgBlue6 = '\x1b[38;5;21m',

    // Cool blues: b=max, slight cyan/purple tint

    /** #005FFF */
    FgBlue7 = '\x1b[38;5;27m',
    /** #0087FF */
    FgBlue8 = '\x1b[38;5;33m',
    /** #00AFFF */
    FgBlue9 = '\x1b[38;5;39m',
    /** #5F5FFF */
    FgBlue10 = '\x1b[38;5;63m',
    /** #8787FF */
    FgBlue11 = '\x1b[38;5;105m',

    // ── Yellow family (16–231 cube) ───────────────────────────────────────────
    // Pure yellows: r+g ramp together, b=0

    /** #5F5F00 */
    FgYellow2 = '\x1b[38;5;58m',
    /** #878700 */
    FgYellow3 = '\x1b[38;5;100m',
    /** #AFAF00 */
    FgYellow4 = '\x1b[38;5;142m',
    /** #D7D700 */
    FgYellow5 = '\x1b[38;5;184m',
    /** #FFFF00 */
    FgYellow6 = '\x1b[38;5;226m',

    // Warm yellows: r=max, g varies

    /** #FFD700 */
    FgYellow7 = '\x1b[38;5;220m',
    /** #FFAF00 */
    FgYellow8 = '\x1b[38;5;214m',
    /** #FFFF5F */
    FgYellow9 = '\x1b[38;5;227m',
    /** #FFFF87 */
    FgYellow10 = '\x1b[38;5;228m',
    /** #FFFFAF */
    FgYellow11 = '\x1b[38;5;229m',

    // ── Cyan family (16–231 cube) ─────────────────────────────────────────────
    // Pure cyans: g+b ramp together, r=0

    /** #005F5F */
    FgCyan2 = '\x1b[38;5;23m',
    /** #008787 */
    FgCyan3 = '\x1b[38;5;30m',
    /** #00AFAF */
    FgCyan4 = '\x1b[38;5;37m',
    /** #00D7D7 */
    FgCyan5 = '\x1b[38;5;44m',
    /** #00FFFF */
    FgCyan6 = '\x1b[38;5;51m',

    // Blue-leaning cyans: b > g

    /** #00AFD7 */
    FgCyan7 = '\x1b[38;5;38m',
    /** #00D7FF */
    FgCyan8 = '\x1b[38;5;45m',
    /** #5FD7FF */
    FgCyan9 = '\x1b[38;5;81m',
    /** #87D7FF */
    FgCyan10 = '\x1b[38;5;117m',
    /** #AFFFFF */
    FgCyan11 = '\x1b[38;5;159m',

    // ── Magenta family (16–231 cube) ──────────────────────────────────────────
    // Pure magentas: r+b ramp together, g=0

    /** #5F005F */
    FgMagenta2 = '\x1b[38;5;53m',
    /** #870087 */
    FgMagenta3 = '\x1b[38;5;90m',
    /** #AF00AF */
    FgMagenta4 = '\x1b[38;5;127m',
    /** #D700D7 */
    FgMagenta5 = '\x1b[38;5;164m',
    /** #FF00FF */
    FgMagenta6 = '\x1b[38;5;201m',

    // Pink-leaning magentas: b > r or both bright

    /** #FF00AF */
    FgMagenta7 = '\x1b[38;5;199m',
    /** #FF00D7 */
    FgMagenta8 = '\x1b[38;5;200m',
    /** #FF5FFF */
    FgMagenta9 = '\x1b[38;5;207m',
    /** #FF87FF */
    FgMagenta10 = '\x1b[38;5;213m',
    /** #FFAFFF */
    FgMagenta11 = '\x1b[38;5;219m',

    // ── Orange family ─────────────────────────────────────────────────────────
    // r=max or near-max, g=low-mid, b=0

    /** #875F00 */
    FgOrange0 = '\x1b[38;5;94m',
    /** #AF5F00 */
    FgOrange1 = '\x1b[38;5;130m',
    /** #D75F00 */
    FgOrange2 = '\x1b[38;5;166m',
    /** #FF5F00 */
    FgOrange3 = '\x1b[38;5;202m',
    /** #FF8700 */
    FgOrange4 = '\x1b[38;5;208m',
    /** #FFAF00 */
    FgOrange5 = '\x1b[38;5;214m',
    /** #FFD700 */
    FgOrange6 = '\x1b[38;5;220m',
    /** #FF875F */
    FgOrange7 = '\x1b[38;5;209m',
    /** #FFAF5F */
    FgOrange8 = '\x1b[38;5;215m',
    /** #FFD75F */
    FgOrange9 = '\x1b[38;5;221m',

    // ── Pink family ───────────────────────────────────────────────────────────
    // r=max, b=mid-high, g=0 or low

    /** #FF005F */
    FgPink0 = '\x1b[38;5;197m',
    /** #FF0087 */
    FgPink1 = '\x1b[38;5;198m',
    /** #FF5F87 */
    FgPink2 = '\x1b[38;5;204m',
    /** #FF5FAF */
    FgPink3 = '\x1b[38;5;205m',
    /** #FF87AF */
    FgPink4 = '\x1b[38;5;211m',
    /** #FF87D7 */
    FgPink5 = '\x1b[38;5;212m',
    /** #FFAFD7 */
    FgPink6 = '\x1b[38;5;218m',
    /** #FFAFFF */
    FgPink7 = '\x1b[38;5;219m',
    /** #FFD7FF */
    FgPink8 = '\x1b[38;5;225m',
    /** #FF87FF */
    FgPink9 = '\x1b[38;5;213m',

    // ── Purple family ─────────────────────────────────────────────────────────
    // r=low-mid, b=high, g=0

    /** #5F0087 */
    FgPurple0 = '\x1b[38;5;55m',
    /** #5F00AF */
    FgPurple1 = '\x1b[38;5;56m',
    /** #5F00D7 */
    FgPurple2 = '\x1b[38;5;57m',
    /** #5F00FF */
    FgPurple3 = '\x1b[38;5;57m',
    /** #8700AF */
    FgPurple4 = '\x1b[38;5;91m',
    /** #8700D7 */
    FgPurple5 = '\x1b[38;5;92m',
    /** #8700FF */
    FgPurple6 = '\x1b[38;5;93m',
    /** #AF00FF */
    FgPurple7 = '\x1b[38;5;129m',
    /** #D700FF */
    FgPurple8 = '\x1b[38;5;165m',
    /** #875FD7 */
    FgPurple9 = '\x1b[38;5;98m',

    // ── Teal family ───────────────────────────────────────────────────────────
    // g=mid-high, b=mid-high, r=0 or low (off-axis cyans leaning green)

    /** #005F5F */
    FgTeal0 = '\x1b[38;5;23m',
    /** #005F87 */
    FgTeal1 = '\x1b[38;5;24m',
    /** #005FAF */
    FgTeal2 = '\x1b[38;5;25m',
    /** #00875F */
    FgTeal3 = '\x1b[38;5;29m',
    /** #008787 */
    FgTeal4 = '\x1b[38;5;30m',
    /** #0087AF */
    FgTeal5 = '\x1b[38;5;31m',
    /** #00AF87 */
    FgTeal6 = '\x1b[38;5;36m',
    /** #00AFAF */
    FgTeal7 = '\x1b[38;5;37m',
    /** #00AFD7 */
    FgTeal8 = '\x1b[38;5;38m',
    /** #5FAF87 */
    FgTeal9 = '\x1b[38;5;72m',

    // ── Lime family ───────────────────────────────────────────────────────────
    // g=max, slight red or blue tint

    /** #5FD700 */
    FgLime0 = '\x1b[38;5;76m',
    /** #87D700 */
    FgLime1 = '\x1b[38;5;112m',
    /** #AFD700 */
    FgLime2 = '\x1b[38;5;148m',
    /** #D7D700 */
    FgLime3 = '\x1b[38;5;184m',
    /** #D7FF00 */
    FgLime4 = '\x1b[38;5;190m',
    /** #AFFF00 */
    FgLime5 = '\x1b[38;5;154m',
    /** #87FF00 */
    FgLime6 = '\x1b[38;5;118m',
    /** #5FFF00 */
    FgLime7 = '\x1b[38;5;82m',
    /** #5FD75F */
    FgLime8 = '\x1b[38;5;77m',
    /** #87D75F */
    FgLime9 = '\x1b[38;5;113m',

    // ── White / light gray (cube) ─────────────────────────────────────────────

    /** #D7D7D7 */
    FgWhite2 = '\x1b[38;5;188m',
    /** #EEEEEE */
    FgWhite3 = '\x1b[38;5;255m',
    /** #FFFFFF */
    FgWhite4 = '\x1b[38;5;231m',

    // ── Grayscale ramp (codes 232–255) ───────────────────────────────────────
    // 0 = near-black, 23 = near-white

    /** #080808 */
    FgGray0 = '\x1b[38;5;232m',
    /** #121212 */
    FgGray1 = '\x1b[38;5;233m',
    /** #1C1C1C */
    FgGray2 = '\x1b[38;5;234m',
    /** #262626 */
    FgGray3 = '\x1b[38;5;235m',
    /** #303030 */
    FgGray4 = '\x1b[38;5;236m',
    /** #3A3A3A */
    FgGray5 = '\x1b[38;5;237m',
    /** #444444 */
    FgGray6 = '\x1b[38;5;238m',
    /** #4E4E4E */
    FgGray7 = '\x1b[38;5;239m',
    /** #585858 */
    FgGray8 = '\x1b[38;5;240m',
    /** #626262 */
    FgGray9 = '\x1b[38;5;241m',
    /** #6C6C6C */
    FgGray10 = '\x1b[38;5;242m',
    /** #767676 */
    FgGray11 = '\x1b[38;5;243m',
    /** #808080 */
    FgGray12 = '\x1b[38;5;244m',
    /** #8A8A8A */
    FgGray13 = '\x1b[38;5;245m',
    /** #949494 */
    FgGray14 = '\x1b[38;5;246m',
    /** #9E9E9E */
    FgGray15 = '\x1b[38;5;247m',
    /** #A8A8A8 */
    FgGray16 = '\x1b[38;5;248m',
    /** #B2B2B2 */
    FgGray17 = '\x1b[38;5;249m',
    /** #BCBCBC */
    FgGray18 = '\x1b[38;5;250m',
    /** #C6C6C6 */
    FgGray19 = '\x1b[38;5;251m',
    /** #D0D0D0 */
    FgGray20 = '\x1b[38;5;252m',
    /** #DADADA */
    FgGray21 = '\x1b[38;5;253m',
    /** #E4E4E4 */
    FgGray22 = '\x1b[38;5;254m',
    /** #EEEEEE */
    FgGray23 = '\x1b[38;5;255m',
}

export function render_md(text: string): string {
    const normal_text_color = CLIColor.FgGray19;
    return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
        .map((line) => {
            // Headings
            if (/^### /.test(line)) return `${CLIColor.FgCyan1}${CLIColor.Bright}${line.slice(4)}${CLIColor.Reset}`;
            if (/^## /.test(line)) return `${CLIColor.FgCyan0}${CLIColor.Bright}${line.slice(3)}${CLIColor.Reset}`;
            if (/^# /.test(line)) return `${CLIColor.FgCyan1}${CLIColor.Bright}${CLIColor.Underscore}${line.slice(2)}${CLIColor.Reset}`;
            // Horizontal rule
            if (/^[-*_]{3,}$/.test(line.trim())) return `${CLIColor.FgGray5}${'─'.repeat(48)}${CLIColor.Reset}`;
            // Bullet list items (- or *)
            if (/^[*-] /.test(line)) line = `${CLIColor.FgGray}•${CLIColor.Reset} ${normal_text_color}` + line.slice(2);
            // Inline: **bold**
            line = line.replaceAll(/\*\*(.+?)\*\*/g, `${CLIColor.Bright}$1${CLIColor.Reset}${normal_text_color}`);
            // Inline: *italic* or _italic_
            line = line.replaceAll(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, `${CLIColor.Dim}$1${CLIColor.Reset}${normal_text_color}`);
            line = line.replaceAll(/_(.+?)_/g, `${CLIColor.Dim}$1${CLIColor.Reset}${normal_text_color}`);
            // Inline: `code`
            line = line.replaceAll(/`(.+?)`/g, `${CLIColor.BgBlack1}${CLIColor.FgGreen1} $1 ${CLIColor.Reset}${normal_text_color}`);
            return line;
        })
        .join('\n');
}


export async function is_resolved(promise: Promise<any>) {
    return await Promise.race([
        delay(0, false),
        promise.then(
            () => true,
            () => false,
        ),
    ]);
}

export async function is_rejected(promise: Promise<any>) {
    return await Promise.race([
        delay(0, false),
        promise.then(
            () => false,
            () => true,
        ),
    ]);
}

export async function is_finished(promise: Promise<any>) {
    return await Promise.race([
        delay(0, false),
        promise.then(
            () => true,
            () => true,
        ),
    ]);
}

export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
    const queue = [...items];
    const workers = Array.from({ length: limit }, async () => {
        while (queue.length > 0) {
            const item = queue.shift()!;
            await fn(item);
        }
    });
    await Promise.all(workers);
}

let live_lines = 0;
let live_content: string[] = [];

export function init_live_zone(lines: number) {
    if (IS_LIMITED_ENV) return;
    // Initial empty space above live zone
    for (let i = 0; i <= lines; i++) {
        process.stdout.write('\n');
    }
    // Move cursor up to above the live zone
    process.stdout.moveCursor(0, -(lines + 1));
    live_lines = lines;
}

export function finish_live_zone() {
    if (IS_LIMITED_ENV) return;
    // Move cursor back down past the live zone
    process.stdout.moveCursor(0, live_lines);
    process.stdout.write('\n');
    live_lines = 0;
    live_content = [];
}

export function update_live_zone(lines: string[]) {
    if (IS_LIMITED_ENV) return;
    live_lines = lines.length;

    // Print line updates
    for (const line of lines) {
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(line + '\n');
    }

    // Move cursor back up to above the live zone
    process.stdout.moveCursor(0, -live_lines);
    live_content = lines;
}

export function set_live_zone(lines: string[]) {
    if (IS_LIMITED_ENV) return;
    live_content = lines;
}

export function live_log(input: any, func: (message: any) => void = console.log) {
    if (IS_LIMITED_ENV) return;
    process.stdout.clearLine(0);
    func(input);
    update_live_zone(live_content);
}

/**
 * Deduplicate an array of strings case-insensitive, only keep first occurence of duplicate.
 */
export function dedup_array(arr: string[]) {
    const seen = new Set<string>();
    arr = arr.filter((dep) => {
        const lower = dep.toLowerCase();
        if (seen.has(lower)) return false;
        seen.add(lower);
        return true;
    });

    return arr;
}

export async function hash_buffer(buffer: Uint8Array, algorithm: SupportedCryptoAlgorithms = 'sha256'): Promise<string> {
    const hasher = new Bun.CryptoHasher(algorithm);
    hasher.update(buffer);
    return hasher.digest('hex');
}