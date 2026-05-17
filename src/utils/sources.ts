const gh_release_url_pattern =
    /github\.com\/(?:repos\/)?(?<owner>[^\/]+)(?:\/(?<project>[^\/]+)(?:\/(?<primary>releases|pull|actions|tree)(?:\/(?<secondary>tag|download|\d+.*?|runs|[\w-]+?)(?:\/(?<key>[^\/]+)(?:\/(?<asset>[^\/]+)(?:\/(?<fifth>[^\/]+))?)?)?)?)?)?$/m;
// https://regex101.com/?regex=github%5C.com%5C%2F%28%3F%3Arepos%5C%2F%29%3F%28%3F%3Cowner%3E%5B%5E%5C%2F%5D%2B%29%28%3F%3A%5C%2F%28%3F%3Cproject%3E%5B%5E%5C%2F%5D%2B%29%28%3F%3A%5C%2F%28%3F%3Cprimary%3Ereleases%7Cpull%7Cactions%7Ctree%29%28%3F%3A%5C%2F%28%3F%3Csecondary%3Etag%7Cdownload%7C%5Cd%2B.*%3F%7Cruns%7C%5B%5Cw-%5D%2B%3F%29%28%3F%3A%5C%2F%28%3F%3Ckey%3E%5B%5E%5C%2F%5D%2B%29%28%3F%3A%5C%2F%28%3F%3Casset%3E%5B%5E%5C%2F%5D%2B%29%28%3F%3A%5C%2F%28%3F%3Cfifth%3E%5B%5E%5C%2F%5D%2B%29%29%3F%29%3F%29%3F%29%3F%29%3F%29%3F%24&testString=https%3A%2F%2Fgithub.com%2FGTNewHorizons%2FGT5-Unofficial%0Ahttps%3A%2F%2Fgithub.com%2FGTNewHorizons%2FGT5-Unofficial%2Factions%2Fruns%2F25946608912%2Fjob%2F76275891293%3Fpr%3D6655%0Ahttps%3A%2F%2Fgithub.com%2FGTNewHorizons%2FGT5-Unofficial%2Factions%2Fruns%2F25946608912%0Ahttps%3A%2F%2Fgithub.com%2FGTNewHorizons%2FGT5-Unofficial%2Fpull%2F6655%0Ahttps%3A%2F%2Fgithub.com%2FGTNewHorizons%2FGT5-Unofficial%2Freleases%2Ftag%2F5.09.52.512-pre%0Ahttps%3A%2F%2Fgithub.com%2FGTNewHorizons%2FGT5-Unofficial%2Freleases%2Fdownload%2F5.09.52.512-pre%2Fgregtech-5.09.52.512-pre-sources.jar%0Ahttps%3A%2F%2Fgithub.com%2FGTNewHorizons%2FGT5-Unofficial%2Ftree%2Flne-fixes%0Ahttps%3A%2F%2Fapi.github.com%2Frepos%2FGTNewHorizons%2FHodgepodge%2Factions%2Fartifacts%2F6860990429%2Fzip&flags=gm&flavor=javascript&delimiter=%2F
    
export function parse_gh_url(url: string): {
    owner: string, 
    project: string, 
    primary?: "releases" | "actions" | "pull" | "tree", 
    secondary?: "tag" | "download" | "runs" | string,
    key?: string
    asset?: string
    fifth?: string
} | undefined {
    const match = url.match(gh_release_url_pattern)

    if (match == null || match.groups == undefined) {
        return undefined;
    }

    return {
        owner: match.groups["owner"] as string,
        project: match.groups["project"] as string,
        primary: match.groups["primary"] as "releases" | "actions" | "pull" | "tree" | undefined,
        secondary: match.groups["secondary"] as "tag" | "download" | "runs" | string | undefined,
        key: match.groups["key"] as string | undefined,
        asset: match.groups["asset"] as string | undefined,
        fifth: match.groups["fifth"] as string | undefined
    }
}
