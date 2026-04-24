# packscripts

## for
### usage
First: Track your modpack with Git if you haven't done so yet. Even without packscripts, this will save you pain.

To Start:
Download your preferred binary from github releases & move it into your modpack root directory.

Packscripts (in its current form) is a CLI tool - that means you interact with it through the commandline, be it bash, powershell or whatever. NOT via a GUI (Graphical User Interface) but a CLI (Command Line Interface).
If you haven't worked with the commandline before, this is a good point to start: https://www.phys.uconn.edu/~rozman/Courses/P2200_23F/downloads/introduction_to_cli.pdf

To initialize packscripts for your modpack:
In the working directory of your modpack (where packscripts is now also located), run:
`packscripts init` and answer its questions.
Afterwards, run `packscripts refresh` to initialize your modlist.

### development
To install dependencies:

```bash
bun install
```

To run:

```bash
bun main
```

## commands
Available commands:
```
Usage: packscripts <command> [arguments]

Available commands:

  init                 Initialize packscripts by setting up your mod folder

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

  version list         List remote version of a mod
                       Usage: version list <mod_id> [--all] [--wide] [-c=X]

  version set          Switch an already indexed mod to a specified version, from its remote release
                       Usage: version set <mod_id> <version> [--dry]

  version restore_all  Restore all mods, which can be downloaded from a remote asset, to that remote asset if it differs from the currently stored file.
                        Will redownload if the file on disk is missing, renamed or has a different size
                       Usage: version restore_all [--dry]

  package              Package your modpack into prism zips & provide them with updates via unsup
                       Usage: version <init|build|bundle>

  package init         Setup packaging for a modpack via config settings and a few starter files.
                       Usage: package init [--overwrite]

  package bootstrap    Build the bootstrap for the provided commit sha (assumes HEAD if none is provided) (Will override the old bootstrap manifest).
                       Usage: package bootstrap [<git ref>] [-t tag]

  package build        Build the changes since a specified commit (assumes the latest version if none is provided) and the provided target git ref (or HEAD if none is provided) into a version manifest that will propagate the update. Accepts a version in the form of -t <version>.
                       Usage: package build <base git ref> <target git ref> [-t tag]

  package bundle       Bundle the current pack into a zip.
                       Usage: package bundle

  debug                Run debug operations
```

## updating
- Create your .packscripts.env.json file (based on the .packscripts.env.json.example) in this repository.
- Fill the gh api key field with a github PAT from https://github.com/settings/personal-access-tokens/new (give it "Public" at minimum)

TBD