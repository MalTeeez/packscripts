//@ts-check
import { binary_search_disable } from './subcommands/binary';
import {
    enable_all_mods,
    disable_all_mods,
    get_details_from_mainclass,
    type update_frequency,
    isUpdateFrequency,
    read_saved_mods,
    are_all_mods_unlocked,
    filter_for_faulty_dependencies,
} from './utils/mods';
import { ANNOTATED_FILE, MOD_BASE_DIR } from './utils/config';
import { annotate } from './subcommands/annotate';
import { disable_atomic_deep, enable_atomic_deep, list_mods, list_mods_folder, list_mods_wide, toggle_mod } from './subcommands/simple';
import { visualize_graph } from './subcommands/graph';
import { check_all_mods_for_updates, undo_last_update } from './subcommands/update';
import { list_all_versions_for_mod, restore_to_asset_versions, switch_version_of_mod } from './subcommands/version';
import { initHandler } from './subcommands/init';

//#region Command Framework
interface CommandDefinition {
    description: string;
    usage?: string;
    is_subcommand?: boolean;
    handler: (args: string[]) => Promise<void>;
}

const commands: Record<string, CommandDefinition> = {
    init: {
        description: 'Initialize packscripts by setting up your mod folder',
        handler: async () => {
            await initHandler();
        },
    },
    refresh: {
        description: 'Update annotated mod list',
        handler: async () => {
            await annotate();
            console.log('Mod list refreshed successfully!');
        },
    },
    list: {
        description: 'List all indexed mods',
        usage: 'list [--files] [--enabled] [--wide]',
        handler: async (args) => {
            if (args.includes('--files')) {
                await list_mods_folder(args.includes('--enabled'));
                return;
            } else if (args.includes('--wide')) {
                await list_mods_wide(args.includes('--enabled'));
            } else {
                await list_mods();
            }
        },
    },
    binary: {
        description: 'Perform a deep-disable for a binary section',
        usage: 'binary <fraction> [fraction2...]',
        handler: async (args) => {
            if (args.length === 0) {
                console.error('Error: Missing target fraction(s), e.g. [1/4]');
                return;
            }
            await binary_search_disable(args, false);
        },
    },
    binary_dry: {
        description: 'List the mods that would be disabled with the target fraction',
        usage: 'binary_dry <fraction>',
        handler: async (args) => {
            if (args.length === 0) {
                console.error('Error: Missing target fraction, e.g. [1/4]');
                return;
            }
            await binary_search_disable(args, true);
        },
    },
    graph: {
        description: 'Build an HTML file that visualizes dependencies',
        handler: async () => {
            await visualize_graph();
        },
    },
    toggle: {
        description: 'Toggle a specific mod by its ID',
        usage: 'toggle <mod_id>',
        handler: async (args) => {
            if (args.length === 0) {
                console.error('Error: Missing mod ID to toggle');
                return;
            }
            if (!(await are_all_mods_unlocked())) {
                console.warn('W: Something is locking a file in the mods directory. Is the game still running?');
                return;
            }
            await toggle_mod(args[0]);
        },
    },
    enable_all: {
        description: 'Enable all mods',
        handler: async () => {
            await enable_all_mods();
        },
    },
    disable_all: {
        description: 'Disable all mods',
        handler: async () => {
            await disable_all_mods();
        },
    },
    enable: {
        description: 'Deep-enable specific mod(s) by ID',
        usage: 'enable <mod_id> [mod_id2...]',
        handler: async (args) => {
            if (args.length === 0) {
                console.error('Error: Missing mod ID(s) to enable');
                return;
            }
            if (!(await are_all_mods_unlocked())) {
                console.warn('W: Something is locking a file in the mods directory. Is the game still running?');
                return;
            }
            await enable_atomic_deep(args);
        },
    },
    disable: {
        description: 'Deep-disable specific mod(s) by ID',
        usage: 'disable <mod_id> [mod_id2...]',
        handler: async (args) => {
            if (args.length === 0) {
                console.error('Error: Missing mod ID(s) to disable');
                return;
            }
            if (!(await are_all_mods_unlocked())) {
                console.warn('W: Something is locking a file in the mods directory. Is the game still running?');
                return;
            }
            await disable_atomic_deep(args);
        },
    },
    update: {
        description: 'Check for mod updates down to a given frequency',
        usage: 'update <COMMON|RARE|EOL> [--retry] [--upgrade] [--downgrade]',
        handler: async (args) => {
            let frequency: update_frequency = 'COMMON';
            const freq_provided = args.length > 0 && !args[0]?.startsWith('--');
            if (freq_provided && !isUpdateFrequency(args[0])) {
                console.error('Error: Invalid frequency. Must be one of: COMMON, RARE, EOL');
                return;
            } else if (freq_provided && isUpdateFrequency(args[0])) {
                frequency = args[0];
            }
            console.log('Checking mods for updates...');
            await check_all_mods_for_updates(
                {
                    frequency_range: frequency,
                    retry_failed: args.includes('--retry'),
                    force_downgrade: args.includes('--downgrade'),
                },
                !args.includes('--upgrade'),
            );
        },
    },
    undo: {
        description: 'Undo certain previously run commands',
        usage: 'undo <UPGRADE>',
        handler: async (args) => {
            if (args.length === 0) {
                console.error('Error: Missing action to undo');
                return;
            }
            const mode = args[0]?.toLowerCase();
            if (mode != undefined) {
                if (mode.toLowerCase() === 'upgrade') {
                    await undo_last_update();
                    return;
                }
            }
            console.error('Mode', mode, 'did not match any known modes.');
        },
    },
    version: {
        description: 'Interact with remote versions of a mod',
        usage: 'version <list|set|restore_all> <mod_id>',
        handler: async (args) => {
            const mode = args[0]?.toLowerCase();
            const cmdArgs = args.slice(1);

            if (!mode || mode === 'help' || mode === '--help' || mode === '-h') {
                console.log(commands['version']?.usage);
                return;
            }

            const command = commands['version_' + mode];
            if (command) {
                await command.handler(cmdArgs);
            } else {
                console.error(`Error: Unknown subcommand '${mode}'`);
                console.log(commands['version']?.usage);
                process.exit(1);
            }
        },
    },
    version_list: {
        description: 'List remote version of a mod',
        usage: 'version list <mod_id> [--all] [--wide] [-c=X]',
        is_subcommand: true,
        handler: async (args) => {
            if (args.includes('--help')) {
                console.log(commands['version_list']?.usage);
                return;
            }
            if (args.length == 0) {
                console.error('Error: Missing mod id');
                return;
            }

            const mod_id = args[0];
            if (mod_id != undefined) {
                const count = args.filter((arg) => arg.startsWith('-c='))[0]?.split('=', 2)[1];
                await list_all_versions_for_mod(mod_id, { all_pages: args.includes('--all'), wide: args.includes('--wide'), count: count });
                return;
            }
        },
    },
    version_set: {
        description: 'Switch an already indexed mod to a specified version, from its remote release',
        usage: 'version set <mod_id> <version> [--dry]',
        is_subcommand: true,
        handler: async (args) => {
            if (args.includes('--help')) {
                console.log(commands['version_set']?.usage);
                return;
            }
            if (args.length == 0) {
                console.error('Error: Missing mod id and version');
                return;
            } else if (args.length == 1) {
                console.error('Error: Missing remote mod version');
                return;
            }

            const mod_id = args[0];
            const mod_vers = args[1];
            if (mod_id != undefined && mod_vers != undefined) {
                await switch_version_of_mod(mod_id, mod_vers, { dry: args.includes('--dry') });
                return;
            }
        },
    },
    version_restore_all: {
        description:
            'Restore all mods, which can be downloaded from a remote asset, to that remote asset if it differs from the currently stored file.\n\t\t\tWill redownload if the file on disk is missing, renamed or has a different size',
        usage: 'version restore_all [--dry]',
        is_subcommand: true,
        handler: async (args) => {
            if (args.includes('--help')) {
                console.log(commands['version_restore_all']?.usage);
                return;
            }
            await restore_to_asset_versions({ dry: args.includes('--dry') });
            return;
        },
    },
    debug: {
        description: 'Run debug operations',
        handler: async (args) => {
            console.log(filter_for_faulty_dependencies((await get_details_from_mainclass(MOD_BASE_DIR + "/" + args[0])).main_deps, args[1] as string, []))
        },
    },
};

function showHelp() {
    console.log('Usage: packscripts <command> [arguments]\n');
    console.log('Available commands:\n');

    const maxCmdLength = Math.max(...Object.keys(commands).map((k) => k.length));

    for (const [cmd, def] of Object.entries(commands)) {
        const cmdPadded = cmd.padEnd(maxCmdLength + 2);
        const usage = def.usage || cmd;
        console.log(`  ${cmdPadded}${def.description}`);
        if (def.usage) {
            console.log(`  ${''.padEnd(maxCmdLength + 2)}Usage: ${usage}`);
        }
        console.log();
    }
}

//#region Entrypoint
async function main() {
    const args = process.argv.slice(2);
    const mode = args[0]?.toLowerCase();
    const cmdArgs = args.slice(1);

    if (!mode || mode === 'help' || mode === '--help' || mode === '-h') {
        showHelp();
        return;
    }

    const command = commands[mode];
    if (command) {
        await command.handler(cmdArgs);
    } else {
        console.error(`Error: Unknown command '${mode}'`);
        showHelp();
        process.exit(1);
    }
}

// Forward to main function with arguments
if (import.meta.url === import.meta.resolve('file://' + process.argv[1])) {
    main().catch(console.error);
} else {
    main().catch(console.error);
}
