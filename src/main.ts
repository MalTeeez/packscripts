//@ts-check
import { binary_search_disable } from './subcommands/binary';
import { enable_all_mods, disable_all_mods, get_details_from_mainclass, type update_frequency, isUpdateFrequency } from './utils/mods';
import { MOD_BASE_DIR } from './utils/consts';
import { annotate } from './subcommands/annotate';
import { disable_atomic_deep, enable_atomic_deep, list_mods, toggle_mod } from './subcommands/simple';
import { visualize_graph } from './subcommands/graph';
import { check_all_mods_for_updates } from './subcommands/update';

//#region Command Framework
interface CommandDefinition {
    description: string;
    usage?: string;
    handler: (args: string[]) => Promise<void>;
}

const commands: Record<string, CommandDefinition> = {
    refresh: {
        description: 'Update annotated mod list',
        handler: async () => {
            await annotate();
            console.log('Mod list refreshed successfully!');
        },
    },
    list: {
        description: 'List all indexed mods',
        handler: async () => {
            await list_mods();
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
            await disable_atomic_deep(args);
        },
    },
    update: {
        description: 'Check for mod updates down to a given frequency',
        usage: 'update <COMMON|RARE|EOL> [--retry]',
        handler: async (args) => {
            let frequency: update_frequency = 'COMMON';
            if (args.length > 0 && !isUpdateFrequency(args[0])) {
                console.error('Error: Invalid frequency. Must be one of: COMMON, RARE, EOL');
                return;
            } else if (args.length > 0 && isUpdateFrequency(args[0])) {
                frequency = args[0];
            }
            console.log('Checking mods for updates...');
            await check_all_mods_for_updates({
                frequency_range: frequency,
                retry_failed: args.includes('--retry'),
            });
        },
    },
    debug: {
        description: 'Run debug operations',
        handler: async () => {
            console.log('Debug run...');
            const a = await get_details_from_mainclass(MOD_BASE_DIR + 'buildcraft-7.1.42.jar');
            console.log(a);
        },
    },
};

function showHelp() {
    console.log('Usage: node main.js <command> [arguments]\n');
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
}
