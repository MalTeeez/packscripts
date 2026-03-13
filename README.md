# packscripts

To install dependencies:

```bash
bun install
```

To run:

```bash
bun main
```

Available commands:
```
Usage: bun main <command> [arguments]

Available commands:

  refresh              Update annotated mod list

  list                 List all indexed mods
                       Usage: list [--files] [--enabled] [--wide]

  binary               Perform a deep-disable for a binary section
                       Usage: binary <fraction> [fraction2...]

  binary_dry           List the mods that would be disabled with the target fraction
                       Usage: binary_dry <fraction>

  graph                Build an HTML file that visualizes dependencies

  toggle               Toggle a specific mod by its ID
                       Usage: toggle <mod_id>

  enable_all           Enable all mods

  disable_all          Disable all mods

  enable               Deep-enable specific mod(s) by ID
                       Usage: enable <mod_id> [mod_id2...]

  disable              Deep-disable specific mod(s) by ID
                       Usage: disable <mod_id> [mod_id2...]

  update               Check for mod updates down to a given frequency
                       Usage: update <COMMON|RARE|EOL> [--retry] [--upgrade] [--downgrade]

  undo                 Undo certain previously run commands
                       Usage: undo <UPGRADE>

  version              Interact with remote versions of a mod
                       Usage: version <list|set|restore_all> <mod_id>

  version_list         List remote version of a mod
                       Usage: version list <mod_id> [--all] [--wide] [-c=X]

  version_set          Switch an already indexed mod to a specified version, from its remote release
                       Usage: version set <mod_id> <version> [--dry]

  version_restore_all  Restore all mods, which can be downloaded from a remote asset, to that remote asset if it differs from the currently stored file.
                        Will redownload if the file on disk is missing, renamed or has a different size
                       Usage: version restore_all [--dry]

  debug                Run debug operations
```

## setup
Set your paths in src/utils/consts.ts

For updating mods: 
- Create your .env.json file (based on the .env.json.example) in this directory
- Fill the gh api key field with a github PAT from https://github.com/settings/personal-access-tokens/new (give it "Public" at minimum)

TBD