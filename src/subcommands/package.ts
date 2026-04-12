import inquirer from 'inquirer';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { MOD_BASE_DIR, PACKAGING, setConfigKeys } from '../utils/config';
import { mkdir } from 'node:fs/promises';
import { download_file } from '../utils/fetch';

async function initialize_packaging(overwrite: boolean) {
    if (PACKAGING != undefined && !overwrite) {
        console.info('Found an already existing packaging setup, refusing to do create a new one. Overwrite with --overwrite.');
        return;
    }

    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'PACKAGE_DIRECTORY',
            message: 'Enter a relative path to your unsup target directory (that is within the git project) (/unsup will be appended):',
            default: 'packaging',
            validate: (input: string) => {
                if (!input.trim()) return 'ERR: Package folder path cannot be empty.';
                const resolved = resolve(input);
                if (!existsSync(resolved)) return `ERR: Path does not exist: ${resolved}`;
                if (!statSync(resolved).isDirectory()) return `ERR: Path is not a directory: ${resolved}`;
                return true;
            },
        },
        {
            type: 'input',
            name: 'REMOTE_MANIFEST_PROJECT',
            message:
                'Enter a url to a remote place where the unsup directory is provided. For github that would be "https://raw.githubusercontent.com/[USER]/[REPOSITORY]/[BRANCH]". This will be used to notify users of updates:',
            default: 'https://raw.githubusercontent.com/',
        },
        {
            type: 'input',
            name: 'PACK_NAME',
            message: 'Enter the full name of your pack (without versions):',
        }
    ]);

    const mc_dir = MOD_BASE_DIR.replace(/(?:\/)mods$/m, '').replace(/^\.?\//m, '');
    const pack_dir = answers.PACKAGE_DIRECTORY.replace(/\/$/m, '') + "/unsup";
    const packaging_config: {
        PACK_NAME: string
        PACKAGE_DIRECTORY: string;
        REMOTE_MANIFEST_PROJECT: string;
        TRACK_INCLUDE_PATHS: Array<{
            relative_path: string;
            include_as: string;
        }>;
        FORCE_INCLUDE_PATHS: Array<{
            relative_path: string;
            include_as: string;
        }>;
        EXCLUDE_FROM_INCLUDE_PATHS: Array<string>;
    } = {
        PACK_NAME: answers.PACK_NAME,
        PACKAGE_DIRECTORY: pack_dir,
        REMOTE_MANIFEST_PROJECT: answers.REMOTE_MANIFEST_PROJECT.replace(/\/$/m, ''),
        TRACK_INCLUDE_PATHS: [
            { relative_path: mc_dir + 'mods', include_as: 'minecraft/mods/' },
            { relative_path: mc_dir + 'config', include_as: 'minecraft/config/' },
            // { relative_path: mc_dir + 'scripts', include_as: 'minecraft/scripts/' },
        ],
        FORCE_INCLUDE_PATHS: [
            { relative_path: pack_dir + "/unsup.jar", include_as: "minecraft/unsup.jar" },
            { relative_path: pack_dir + "/unsup.ini", include_as: "minecraft/unsup.ini" },
            { relative_path: "libraries", include_as: "libraries/" },
            { relative_path: "patches", include_as: "patches/" },
            { relative_path: "mmc-pack.json", include_as: "mmc-pack.json" },
            { relative_path: "packaging/instance.cfg", include_as: "instance.cfg" }
            //{ relative_path: "icon.png", include_as: "icon.png" },
        ],
        EXCLUDE_FROM_INCLUDE_PATHS: [],
    };

    if (await Bun.file(pack_dir).exists()) {
        console.log("Deleting old packaging directory...")
        await Bun.file(pack_dir).delete()
    }

    await mkdir(pack_dir, { recursive: true })
    
    // fill unsup dir with initial files that will probably be constant
    await download_file("https://github.com/MalTeeez/unsup-fork/releases/download/v1.2.2/unsup-1.2-custom+d8a847e485.20260411.jar", "OTHER", "packaging/unsup", "unsup.jar")
    await Bun.file(pack_dir + "/unsup.ini").write(
`version=1
source_format=unsup
source=${packaging_config.REMOTE_MANIFEST_PROJECT}/${pack_dir}/manifest.json
use_parent_directory=true`)
    // Yes, I know this is an object but it really isn't worth to stringify here
    await Bun.file(pack_dir + "/manifest.json").write(
`{
  "unsup_manifest": "root-1",
  "name": "${packaging_config.PACK_NAME}",
  "versions": {
    "current": {
      "name": "1.0.0",
      "code": 1
    },
    "history": []
  }
}`
    )
    
    // Write config back to file
    await setConfigKeys({ PACKAGING: packaging_config })

    console.log(`Wrote initial setup to ${pack_dir}. Before continuing, check config.json for paths that should be included / excluded. Afterwards, create your first version with "packscripts package build --bootstrap".`)

}

async function build_bootstrap_for_current() {

}