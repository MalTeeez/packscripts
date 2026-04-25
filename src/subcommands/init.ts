import inquirer from 'inquirer';
import fs, { existsSync } from 'fs';
import path from 'path';
import { CLIColor } from '../utils/utils';
import { CONFIG_FILE } from '../utils/config';

export async function initHandler(): Promise<void> {
    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'RELATIVE_INSTANCE_DIRECTORY',
            message:
                'Path to your instance root, relative to where you are running packscripts from (should contain .git/ and mmc-pack.json):',
            default: './',
            validate: (input: string) => {
                if (!input.trim()) return 'Instance directory cannot be empty.';
                const resolved = path.resolve(input);
                if (!fs.existsSync(resolved)) return `Path does not exist: ${resolved}`;
                if (!fs.statSync(resolved).isDirectory()) return `Path is not a directory: ${resolved}`;
                return true;
            },
        },
        {
            type: 'input',
            name: 'MOD_BASE_DIR',
            message: 'Path to your mods folder, relative to RELATIVE_INSTANCE_DIRECTORY:',
            default: './minecraft/mods',
            validate: (input: string) => {
                if (!input.trim()) return 'Mod folder path cannot be empty.';
                return true;
            },
        },
        {
            type: 'input',
            name: 'ANNOTATED_FILE',
            message: 'Path to where extra information on mods should be stored (in a JSON file), relative to RELATIVE_INSTANCE_DIRECTORY:',
            default: './annotated_mods.json',
            validate: (input: string) => {
                if (!input.trim()) return 'Path to mod annotation JSON cannot be empty.';
                return true;
            },
        },
    ]);

    const config = {
        RELATIVE_INSTANCE_DIRECTORY: answers.RELATIVE_INSTANCE_DIRECTORY.replace(/\/?$/m, '') + '/',
        MOD_BASE_DIR: answers.MOD_BASE_DIR.replace(/\/$/m, ''),
        ANNOTATED_FILE: answers.ANNOTATED_FILE.replace(/\/$/m, ''),
    };

    // Check if future workdir exists, and if yes switch to it so we can use the relative paths that were just provided
    if (existsSync(config.RELATIVE_INSTANCE_DIRECTORY)) {
        process.chdir(config.RELATIVE_INSTANCE_DIRECTORY);
    } else {
        throw Error(`Working directory ${config.RELATIVE_INSTANCE_DIRECTORY} does not exist.`);
    }

    await Bun.write(CONFIG_FILE, JSON.stringify(config, null, 4));
    console.log(`${CLIColor.FgGreen4}✔${CLIColor.Reset} Config written to ${CONFIG_FILE}.`);

    // Create empty annotated mods file if it doesn't exist
    if (!fs.existsSync(config.ANNOTATED_FILE)) {
        await Bun.write(config.ANNOTATED_FILE, JSON.stringify([], null, 2));
        console.log(
            `${CLIColor.FgGreen4}✔${CLIColor.Reset} Created empty annotated mods file at: ${CLIColor.FgCyan1}${config.ANNOTATED_FILE}${CLIColor.Reset}`,
        );
    } else {
        console.log(
            `${CLIColor.FgYellow8}⚠${CLIColor.Reset} Annotated mods file already exists at: ${CLIColor.FgCyan1}${config.ANNOTATED_FILE}${CLIColor.Reset}, not initializing.`,
        );
    }

    console.log(`\n${CLIColor.FgGreen3}Initialization complete!${CLIColor.Reset}`);
    console.log(
        `${CLIColor.FgGray19}Run ${CLIColor.BgBlack1}${CLIColor.FgGreen1} packscripts refresh ${CLIColor.Reset}${CLIColor.FgGray19} to build your annotated mods list.${CLIColor.Reset}`,
    );
}
