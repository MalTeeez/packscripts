//@ts-check
import { binary_search_disable } from './subcommands/binary';
import { enable_all_mods, disable_all_mods, get_deps_from_mainclass } from './utils/mods';
import { MOD_BASE_DIR } from './utils/consts';
import { annotate } from './subcommands/annotate';
import { disable_atomic_deep, enable_atomic_deep, list_mods, toggle_mod } from './subcommands/simple';
import { visualize_graph } from './subcommands/graph';

//#region Entrypoint
async function main() {
    const args = process.argv.slice(2);
    const mode = args[0]?.toLowerCase();
    const opts = args[1];

    try {
        if (mode === 'refresh') {
            await annotate();
            console.log('Mod list refreshed successfully!');
        } else if (mode === 'list') {
            await list_mods();
        } else if (mode === 'binary' || mode === 'binary_dry') {
            if (opts != undefined) {
                await binary_search_disable(args.slice(1), mode === 'binary_dry');
            } else {
                console.error('Missing target fraction for mode binary, i.e. [1/4].');
            }
        } else if (mode === 'graph') {
            await visualize_graph();
        } else if (mode === 'toggle') {
            await toggle_mod(opts);
        } else if (mode === 'enable_all') {
            await enable_all_mods();
        } else if (mode === 'disable_all') {
            await disable_all_mods();
        } else if (mode === 'enable') {
            if (opts != undefined) {
                await enable_atomic_deep(args.slice(1));
            } else {
                console.error('Missing target mod (id) to enable.');
            }
        } else if (mode === 'disable') {
            if (opts != undefined) {
                await disable_atomic_deep(args.slice(1));
            } else {
                console.error('Missing target mod (id) to disable.');
            }
        } else if (mode === 'debug') {
            console.log('debug run..');
            const a = await get_deps_from_mainclass(MOD_BASE_DIR + 'buildcraft-7.1.42.jar', "Buildcraft|Core");
            console.log(a);
        } else {
            console.log('Usage: node annotate.js [mode]');
            console.log('Modes:');
            console.log('  refresh                               - Update annotated mod list');
            console.log('  list                                  - List all indexed mods');
            console.log('  binary [target fraction(s)]           - Perform a deep-disable for a binary section');
            console.log('  binary_dry [target fraction]          - List the mods that would be disabled with the target fraction');
            console.log('  graph                                 - Build a html file, that visualizes dependencies');
            console.log('  toggle [mod_id]                       - Disable / Enable a specific mod by its id');
            console.log('  enable_all                            - Enable all mods');
            console.log('  disable_all                           - Disable all mods');
            console.log('  enable [mod_id(s)]                    - Deep-Enable a specific mod by its id, accepts multiple');
            console.log('  disable [mod_id(s)]                   - Deep-Disable a specific mod by its id, accepts multiple');
        }
    } catch (error: any) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

// Forward to main function with arguments
if (import.meta.url === import.meta.resolve('file://' + process.argv[1])) {
    main().catch(console.error);
}