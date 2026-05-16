const gh_release_url_pattern =
    /github\.com\/(?<owner>[^\/]+)(?:\/(?<project>[^\/]+)(?:\/(?<primary>releases|pull|actions|tree)(?:\/(?<secondary>tag|download|\d+.*?|runs|[\w-]+?)(?:\/(?<key>[^\/]+)(?:\/(?<asset>[^\/]+)(?:\/(?<fifth>[^\/]+))?)?)?)?)?)?$/m;

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
