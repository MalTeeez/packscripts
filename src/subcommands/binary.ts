import { save_map_to_file } from '../utils/fs';
import { disable_all_mods, enable_base_mods, enable_mod_deep, isNotItself, read_saved_mods, type mod_object } from '../utils/mods';
import { divide_to_full_groups, print_pretty } from '../utils/utils';

type ModGroupOptions = {
    dep_key: 'wants' | 'wanted_by';
    show_deps: boolean;
};

/**
 * Gets a list of mods in a specific group section along with their dependencies
 * @param {Map<string, mod_object>} mod_map - Map of all mods indexed by mod ID
 * @param {Array<string>} mod_list - Ordered list of mod IDs
 * @param {number[]} groups - Array of even group sizes that sum up to the total number of mods
 * @param {number} section - Zero-based index of the group section to retrieve
 * @param {object} options - Options to use for dependency lookup ("wanted_by" or "wants")
 * @returns {string[]} Array of mod IDs in the specified group section including dependencies
 */
function get_mods_in_group(
    mod_map: Map<string, mod_object>,
    mod_list: Array<string>,
    groups: number[],
    section: number,
    options: ModGroupOptions = { dep_key: 'wants', show_deps: false },
): string[] {
    const group_limit = groups[section] || 0;
    const group_start_index = groups.reduce(
        (previousValue: number, currentValue: number, currentIndex: number) =>
            currentIndex < section ? previousValue + currentValue : previousValue,
        0,
    );
    // Slice mod_ids from mod_list
    const group_list = new Set(mod_list.slice(group_start_index, group_start_index + group_limit));

    // Recursively collect dependencies
    if (options.show_deps) group_list.add('-- deps --');
    const get_deps = (mod_id: string) => {
        const deps: string[] = [];
        const mod = mod_map.get(mod_id);

        if (mod != undefined) {
            const mod_deps = mod[options.dep_key];
            if (mod_deps != undefined && Array.isArray(mod_deps)) {
                for (const dep of mod_deps) {
                    if (isNotItself(dep, mod_id, mod.other_mod_ids || [])) {
                        deps.push(...get_deps(dep));
                        deps.push(dep);
                    }
                }
            }
        }

        return deps;
    };
    // Add dependencies for each mod in group
    group_list.forEach((mod_id) => {
        for (const dep of get_deps(mod_id)) group_list.add(dep);
    });

    return Array.from(group_list);
}

export async function binary_search_disable(target_fractions: string[], dry_run: boolean) {
    const mod_map = await read_saved_mods('./annotated_mods.json');
    const mod_list = Array.from(mod_map.keys());
    const fractions: { section: number; scope: number; groups: number[] }[] = [];

    for (const fraction of target_fractions) {
        let [section, scope] = fraction.split('/').map(Number);
        if (section != undefined && scope != undefined && section <= scope && section > 0) {
            // Split our list into even groups
            const groups = divide_to_full_groups(mod_list.length, scope);
            // Start at 0 for mods indexed at 0
            // Using a new variable for section here, since typescript apparently hates me mutating it before using at groups.reduce()
            const safe_section = section - 1;
            fractions.push({ section: safe_section, groups, scope });
        }
    }

    const first_fraction = fractions[0];
    if (first_fraction != undefined) {
        const { section, scope, groups } = first_fraction;

        if (mod_list.length / 2 < scope) {
            console.warn(
                `W: The current scope (${scope}) is bigger than half of your mods, which will lead to imprecisions. Use binary_dry with manual toggling.\n`,
            );
        }

        // Only print the mods we would have touched
        if (dry_run) {
            let print_groups: Array<[string, string[]]> = [];

            console.info(`Mod groups for target ${target_fractions[0]}:`);
            // Only take pre-group (left) if we can go left from section
            if (section > 0) {
                print_groups.push([
                    'group #' + section + ' (pre)',
                    get_mods_in_group(mod_map, mod_list, groups, section - 1, { dep_key: 'wants', show_deps: true }),
                ]);
            }

            // Middle section is always safe
            print_groups.push([
                'group #' + (section + 1) + ' (target)',
                get_mods_in_group(mod_map, mod_list, groups, section, { dep_key: 'wants', show_deps: true }),
            ]);

            // Only take post-group (right) if we can go right from section
            if (section < scope - 1) {
                print_groups.push([
                    'group #' + (section + 2) + ' (post)',
                    get_mods_in_group(mod_map, mod_list, groups, section + 1, { dep_key: 'wants', show_deps: true }),
                ]);
            }

            print_pretty(...print_groups);

            // Print the sub-groups of the current target group
            print_groups = [];
            const sub_scope = scope * 2;
            const sub_groups = divide_to_full_groups(mod_list.length, sub_scope);
            const sub_safe_section = (section + 1) * 2 - 1;

            if (mod_list.length / 2 < sub_scope) {
                console.warn(
                    `W: The next scope (${sub_scope}) is bigger than half of your mods, which will lead to imprecisions. Use binary_dry with manual toggling.\n`,
                );
            }

            console.info(`Mod groups for sub-target ${sub_safe_section + 1}/${sub_scope}:`);

            // Only take pre-group (left) if we can go left from section
            if (sub_safe_section > 0) {
                print_groups.push([
                    'group #' + sub_safe_section + ' (first half)',
                    get_mods_in_group(mod_map, mod_list, sub_groups, sub_safe_section - 1, { dep_key: 'wants', show_deps: true }),
                ]);
            }

            // Middle section is always safe
            print_groups.push([
                'group #' + (sub_safe_section + 1) + ' (second half)',
                get_mods_in_group(mod_map, mod_list, sub_groups, sub_safe_section, { dep_key: 'wants', show_deps: true }),
            ]);

            // No post group here, since the target group is only split up into 2 parts

            print_pretty(...print_groups);
            // Actually disable the mods
        } else {
            // Disable all mods, so we don't get stragglers
            await disable_all_mods(mod_map);

            const changed_list: Array<string> = [];

            for (const { section, scope, groups } of fractions) {
                console.log(`Enabling fraction ${section + 1}/${scope} .`);
                // print_pretty(["Enabling Mods:", get_mods_in_group(mod_map, mod_list, groups, section)])
                for (const mod_id of get_mods_in_group(mod_map, mod_list, groups, section)) {
                    await enable_mod_deep(mod_id, mod_map, changed_list);
                }

                await enable_base_mods(mod_map);
                await save_map_to_file('./annotated_mods.json', mod_map);
            }
            if (changed_list.length > 0) {
                console.log('Changed ', changed_list.length, ' mods.\n');
            } else {
                console.log('No changes made.');
            }
        }
    } else {
        console.error('Received faulty fraction.');
    }
}