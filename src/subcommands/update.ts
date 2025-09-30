import { read_saved_mods, type mod_object } from '../utils/mods';
import type { JsonObject } from '../utils/utils';
import { GITHUB_API_KEY } from '../../.env.json'


export async function check_all_mods_for_updates(mod_map?: Map<string, mod_object>) {
    mod_map = mod_map == undefined ? await read_saved_mods('./annotated_mods.json') : mod_map;
    const fetch_map: Map<string, { mod_obj: mod_object; res: Promise<string | undefined> }> = new Map();

    for (const [mod_id, mod_obj] of mod_map.entries()) {
        if (mod_obj.source) {
            fetch_map.set(mod_id, { mod_obj, res: check_url_for_updates(mod_obj.source) });
        }
    }

    for (const [mod_id, { mod_obj, res }] of fetch_map.entries()) {
        const newest_version = await res;
        if (newest_version) {
            if (newest_version != mod_obj.version) {
                console.log(`\t${mod_id}:\t\t${mod_obj.version}\t->\t${newest_version}`);
            }
        }
    }
    const rate_limits = (await gh_request('/rate_limit') as any)?.resources?.core;
    const reset_in = (rate_limits.reset - Date.now() / 1000) / 60;
    console.log(`rate limits - used: ${rate_limits.used}, remaining: ${rate_limits.remaining}, reset in: ${reset_in.toFixed(1)} mins`);
}

async function check_url_for_updates(url: string) {
    if (url.startsWith('https://github.com/')) {
        const res = await check_gh_releases(url);
        if (res) {
            return res.tag_name as string;
        }
    }
    return undefined;
}

async function check_gh_releases(url: string): Promise<JsonObject | undefined> {
    const project = url.match(/(?:github.com\/(.+?\/.+?))(?:\/|$)/m)?.at(1);
    if (project) {
        const res: JsonObject | undefined = await gh_request(`/repos/${project}/releases/latest`, "GET");
        if (res == undefined) {
            console.warn(`W: Failed get releases for ${project}`);
        } else {
            return res;
        }
    } else {
        console.warn(`W: GitHub URL ${url} is fauly, can't check..`);
    }
}

async function gh_request(path: string, method: string = "GET"): Promise<JsonObject | undefined> {
    const resp = await fetch(`https://api.github.com${path}`, { method,
        headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'mod-updater-script',
            Authorization: `Bearer ${GITHUB_API_KEY}`
        },
    });

    if (resp.status === 403 && resp.headers.get('x-ratelimit-remaining') === '0') {
        const reset = resp.headers.get('x-ratelimit-reset');
        const secs = reset ? Math.max(0, parseInt(reset) * 1000 - Date.now()) / 1000 : undefined;
        console.warn(`W: GitHub rate limit exceeded. Resets in ~${secs?.toFixed(0)}s`);
    }

    if (!resp.ok) {
        console.log(`W: Req failed with ${resp.status} | ${resp.statusText} for ${path}`);
    }

    if (resp.headers.get('content-type')?.includes('application/json')) return await resp.json() as JsonObject;
    return undefined;
}
