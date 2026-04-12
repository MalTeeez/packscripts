import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';
import { CLIColor } from '../utils/utils';

export async function initHandler(): Promise<void> {
    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'MOD_BASE_DIR',
            message: 'Enter the relative path to your mod folder:',
            default: './minecraft/mods',
            validate: (input: string) => {
                if (!input.trim()) return 'Mod folder path cannot be empty.';
                const resolved = path.resolve(input);
                if (!fs.existsSync(resolved)) return `Path does not exist: ${resolved}`;
                if (!fs.statSync(resolved).isDirectory()) return `Path is not a directory: ${resolved}`;
                return true;
            },
        },
        {
            type: 'input',
            name: 'ANNOTATED_FILE',
            message: 'Enter the relative path for the annotated mods JSON file:',
            default: './annotated_mods.json',
        },
    ]);

    const config = {
        MOD_BASE_DIR: answers.MOD_BASE_DIR.replace(/\/$/m, ''),
        ANNOTATED_FILE: answers.ANNOTATED_FILE.replace(/\/$/m, ''),
    };

    // Write config.json
    await Bun.write('./config.json', JSON.stringify(config, null, 2));
    console.log(`${CLIColor.FgGreen4}✔${CLIColor.Reset} config.json written.`);

    // Create empty annotated mods file if it doesn't exist
    const annotatedResolved = path.resolve(config.ANNOTATED_FILE);
    if (!fs.existsSync(annotatedResolved)) {
        const dir = path.dirname(annotatedResolved);
        fs.mkdirSync(dir, { recursive: true });
        await Bun.write(annotatedResolved, JSON.stringify([], null, 2));
        console.log(
            `${CLIColor.FgGreen4}✔${CLIColor.Reset} Created empty annotated mods file at: ${CLIColor.FgCyan1}${annotatedResolved}${CLIColor.Reset}`,
        );
    } else {
        console.log(
            `${CLIColor.FgYellow8}⚠${CLIColor.Reset} Annotated mods file already exists at: ${CLIColor.FgCyan1}${annotatedResolved}${CLIColor.Reset}, skipping.`,
        );
    }

    console.log(`\n${CLIColor.FgGreen3}Initialization complete!${CLIColor.Reset}`);
    console.log(
        `${CLIColor.FgGray19}Run ${CLIColor.BgBlack1}${CLIColor.FgGreen1} packscripts refresh ${CLIColor.Reset}${CLIColor.FgGray19} to build your annotated mods list.${CLIColor.Reset}`,
    );
}
