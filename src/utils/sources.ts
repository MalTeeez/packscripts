const gh_release_url_pattern =
    /github\.com\/(?<owner>[^\/]+?)\/(?<project>[^\/]+?)(?:$|(?:\/releases\/(?:tag|download)\/(?<tag>[^\/?&]+?)(\/(?<asset>[^\/]+?$)?|$))|\/.+)/m;

export function parse_gh_url(url: string): {owner: string, project: string, tag: string | undefined, asset: string | undefined} | undefined {
    const match = url.match(gh_release_url_pattern)

    if (match == null || match.groups == undefined) {
        return undefined;
    }

    return {
        owner: match.groups["owner"] as string,
        project: match.groups["project"] as string,
        tag: match.groups["tag"],
        asset: match.groups["asset"]
    }
}
