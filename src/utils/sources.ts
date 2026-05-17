const GH_RELEASE_URL_PATTERN =
    /github\.com\/(?:repos\/)?(?<owner>[^\/]+)(?:\/(?<project>[^\/]+)(?:\/(?<primary>releases|pull|actions|tree)(?:\/(?<secondary>tag|download|\d+.*?|runs|[\w-]+?)(?:\/(?<key>[^\/]+)(?:\/(?<asset>[^\/]+)(?:\/(?<fifth>[^\/]+))?)?)?)?)?)?$/m;
// https://regex101.com/?regex=github%5C.com%5C%2F%28%3F%3Arepos%5C%2F%29%3F%28%3F%3Cowner%3E%5B%5E%5C%2F%5D%2B%29%28%3F%3A%5C%2F%28%3F%3Cproject%3E%5B%5E%5C%2F%5D%2B%29%28%3F%3A%5C%2F%28%3F%3Cprimary%3Ereleases%7Cpull%7Cactions%7Ctree%29%28%3F%3A%5C%2F%28%3F%3Csecondary%3Etag%7Cdownload%7C%5Cd%2B.*%3F%7Cruns%7C%5B%5Cw-%5D%2B%3F%29%28%3F%3A%5C%2F%28%3F%3Ckey%3E%5B%5E%5C%2F%5D%2B%29%28%3F%3A%5C%2F%28%3F%3Casset%3E%5B%5E%5C%2F%5D%2B%29%28%3F%3A%5C%2F%28%3F%3Cfifth%3E%5B%5E%5C%2F%5D%2B%29%29%3F%29%3F%29%3F%29%3F%29%3F%29%3F%24&testString=https%3A%2F%2Fgithub.com%2FGTNewHorizons%2FGT5-Unofficial%0Ahttps%3A%2F%2Fgithub.com%2FGTNewHorizons%2FGT5-Unofficial%2Factions%2Fruns%2F25946608912%2Fjob%2F76275891293%3Fpr%3D6655%0Ahttps%3A%2F%2Fgithub.com%2FGTNewHorizons%2FGT5-Unofficial%2Factions%2Fruns%2F25946608912%0Ahttps%3A%2F%2Fgithub.com%2FGTNewHorizons%2FGT5-Unofficial%2Fpull%2F6655%0Ahttps%3A%2F%2Fgithub.com%2FGTNewHorizons%2FGT5-Unofficial%2Freleases%2Ftag%2F5.09.52.512-pre%0Ahttps%3A%2F%2Fgithub.com%2FGTNewHorizons%2FGT5-Unofficial%2Freleases%2Fdownload%2F5.09.52.512-pre%2Fgregtech-5.09.52.512-pre-sources.jar%0Ahttps%3A%2F%2Fgithub.com%2FGTNewHorizons%2FGT5-Unofficial%2Ftree%2Flne-fixes%0Ahttps%3A%2F%2Fapi.github.com%2Frepos%2FGTNewHorizons%2FHodgepodge%2Factions%2Fartifacts%2F6860990429%2Fzip&flags=gm&flavor=javascript&delimiter=%2F

export function parse_gh_url(url: string):
    | {
          owner: string;
          project: string;
          primary?: 'releases' | 'actions' | 'pull' | 'tree';
          secondary?: 'tag' | 'download' | 'runs' | string;
          key?: string;
          asset?: string;
          fifth?: string;
      }
    | undefined {
    const match = url.match(GH_RELEASE_URL_PATTERN);

    if (match == null || match.groups == undefined) {
        return undefined;
    }

    return {
        owner: match.groups['owner'] as string,
        project: match.groups['project'] as string,
        primary: match.groups['primary'] as 'releases' | 'actions' | 'pull' | 'tree' | undefined,
        secondary: match.groups['secondary'] as 'tag' | 'download' | 'runs' | string | undefined,
        key: match.groups['key'] as string | undefined,
        asset: match.groups['asset'] as string | undefined,
        fifth: match.groups['fifth'] as string | undefined,
    };
}

// GitHub PR URL base pattern - matches the URL up to and including the PR number
const GH_URL = String.raw`https:\/\/github\.com\/(?:repos\/)?[^\/]+\/[^\/]+\/pull\/\d+`;

// Each alternation handles a specific delimiter pair, consuming everything up to the closing delimiter.
// The undelimited case comes last so delimited cases take priority.
const DELIMITED = [
    String.raw`\(${GH_URL}[^\s,)]*\)`, // (url)  - parentheses
    String.raw`\[${GH_URL}[^\s,\]]*\]`, // [url]  - square brackets
    String.raw`<${GH_URL}[^\s,>]*>`, // <url>  - angle brackets
    String.raw`\`${GH_URL}[^\s,\`]*\``, // `url`  - backticks
    String.raw`"${GH_URL}[^\s,"]*"`, // "url"  - double quotes
    String.raw`'${GH_URL}[^\s,']*'`, // 'url'  - single quotes
    String.raw`${GH_URL}[^\s,)}\]>\`"']*`, // url    - undelimited, stops before any closing delimiter
    //          so we don't accidentally consume a trailing one
].join('|');

const REQUIRED_PR_PATTERN = new RegExp(
    // Prefix alternatives:
    // 1. "depends/relies on (pr)"
    // 2. "requires/required (qualifier) (pr)" - pr optional
    // 3. "(qualifier) (pr) requires/required" - reversed word order e.g. "this pr requires"
    String.raw`(?:` +
        String.raw`(?:depends|relies)[ \t]*on[ \t]*(?:pr)?` +
        String.raw`|require(?:s|d)[ \t]*(?:(?:this|other|parent|sister|a|the)[ \t]*)?(?:\bpr\b)?` +
        String.raw`|(?:(?:this|other|parent|sister|a|the)[ \t]*)?\bpr\b[ \t]*require(?:s|d)` +
        String.raw`)` +
        // Optional colon separator with surrounding horizontal whitespace
        String.raw`[ \t]*:?[ \t]*` +
        // Assert that a GitHub PR URL follows before consuming anything into pr_list
        // Accounts for optional opening delimiter before the URL
        String.raw`(?=[({\[<\`"']?https:\/\/github\.com\/)` +
        // Capture the full list of URLs into pr_list.
        // Each URL can be delimited or bare, optionally followed by a comma separator.
        // The outer + allows multiple comma-separated URLs.
        String.raw`(?<pr_list>(?:(?:${DELIMITED})(?:[ \t]*,[ \t]*)?)+)`,

    'gi',
);

function strip_url_delimiters(url: string): string {
    return url.trim().replace(/^[({\[<`"']|[)}\]>`"']$/g, '');
}

function extract_urls_from_pr_list(pr_list: string): string[] {
    return pr_list
        .split(/[ \t]*,[ \t]*/)
        .map(strip_url_delimiters)
        .filter((url) => url.startsWith('https://'));
}

export function extract_required_prs(input: string): {
    raw_match: string;
    pr_urls: string[];
}[] {
    const results: {
        raw_match: string;
        pr_urls: string[];
    }[] = [];

    for (const match of input.matchAll(REQUIRED_PR_PATTERN)) {
        const pr_list = match.groups?.pr_list;
        if (!pr_list) continue;

        results.push({
            raw_match: match[0],
            pr_urls: extract_urls_from_pr_list(pr_list),
        });
    }

    return results;
}