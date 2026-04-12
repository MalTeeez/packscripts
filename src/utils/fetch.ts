import type { JsonObject } from './utils';

export async function query_gh_project_by_url(
    url: string,
    gh_api_key: string,
    sub_repo_api_path: string,
    ignore_codes: number[] = [],
): Promise<{ headers?: Headers; status: string; body: JsonObject | undefined }> {
    const project = url.match(/(?:github.com\/(.+?\/.+?))(?:\/|$)/m)?.at(1);
    if (project) {
        const url = `/repos/${project}${sub_repo_api_path}`;
        const res: Response | undefined = await gh_request(url, gh_api_key, 'GET');
        if (res == undefined || !res.ok) {
            if (res && !ignore_codes.includes(res.status)) {
                console.warn(`W: Failed to get releases with ${res.status} | ${res.statusText} for ${project} (${url})`);
            }
            return { headers: res.headers, body: undefined, status: String(res.status) };
        } else {
            if (res.headers.get('content-type')?.includes('application/json')) {
                const body = (await res.json()) as JsonObject;
                return { headers: res.headers, body, status: String(res.status) };
            }
        }
    } else {
        console.warn(`W: GitHub URL ${url} is fauly, can't check..`);
    }
    return { headers: undefined, body: undefined, status: '400' };
}

export function download_file(
    source: string,
    source_type: 'GH_RELEASE' | 'CURSEFORGE' | 'MODRINTH' | 'OTHER',
    destination: string,
    file_name: string,
    source_api_key?: string,
): Promise<string> {
    return new Promise(async (resolve, reject) => {
        let res: Response;
        if (source_type !== 'OTHER' && source_api_key) {
            if (source_type === 'GH_RELEASE') {
                res = await gh_request(source, source_api_key, 'GET');
            } else {
                throw Error("Downloads for source type " + source + " not yet implemented.")
            }
        } else  {
            res = await fetch(source, { method: 'GET', redirect: 'follow' });
        }
        let content_length: string | number | null = res.headers.get('Content-Length');
        if (!res.ok || !content_length || (content_length && Number(content_length) < 1) || !res.body) {
            return reject(
                `W: Failed to download file ${file_name} from ${source_type} with ${res.status} | ${res.statusText}. Headers: ${JSON.stringify(res.headers.toJSON())}`,
            );
        }
        content_length = Number(content_length);

        const file = Bun.file(`${destination}/${file_name}`);
        const writer = file.writer({ highWaterMark: 1024 * 1024 });

        let written_bytes = 0;
        for await (const chunk of res.body) {
            // Await is actually needed here, since .write() returns a promise
            written_bytes += await (writer.write(chunk) as unknown as Promise<number>).catch(() => {
                reject(`W: Failed to write chunk of ${destination}/${file_name} to disk`);
                return 0;
            });
        }

        await writer.flush();

        if (written_bytes == content_length) {
            resolve(`Wrote ${written_bytes} bytes to disk for ${file_name}`);
        } else {
            reject(`W: Failed to write filestream to disk. Wrote ${written_bytes} bytes, expected ${content_length}`);
        }
    });
}

export async function gh_request(path: string, api_key: string, method: string = 'GET'): Promise<Response> {
    const url = path.startsWith('http://') || path.startsWith('https://') ? path : `https://api.github.com${path}`;
    const res = await fetch(url, {
        method,
        headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'mod-updater-script',
            Authorization: `Bearer ${api_key}`,
        },
        redirect: 'follow',
    });

    if (res.status == 403) {
        console.log(res);
    }

    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
        const reset = res.headers.get('x-ratelimit-reset');
        const secs = reset ? Math.max(0, parseInt(reset) * 1000 - Date.now()) / 1000 : undefined;
        console.warn(`W: GitHub rate limit exceeded. Resets in ~${secs?.toFixed(0)}s`);
    }

    return res;
}

export function filter_assets(assets: Array<{ browser_download_url: string; name: string, size: any }>, file_pattern?: string): [string | undefined, string | undefined, any | undefined] {
    let filtered_assets: Array<{ browser_download_url: string; name: string, size: any }> = [];

    // Use file_pattern if available
    if (assets.length > 1 && file_pattern != undefined && file_pattern.length > 0) {
        const pattern = new RegExp(file_pattern, 'gm');
        for (const asset of assets) {
            if (asset.name.match(pattern)) {
                filtered_assets.push(asset);
            }
        }
        assets = filtered_assets;
        filtered_assets = [];
    }
    // If no file pattern was set, or we still matched multiple jars, remove common suffixes
    if (assets.length > 1) {
        for (const asset of assets) {
            if (asset.name.endsWith('.jar')) {
                if (
                    !asset.name.endsWith('-sources.jar') &&
                    !asset.name.endsWith('-dev.jar') &&
                    !asset.name.endsWith('-api.jar') &&
                    !asset.name.endsWith('-preshadow.jar') &&
                    !asset.name.endsWith('-prestub.jar') &&
                    !asset.name.endsWith('-javadoc.jar') &&
                    !asset.name.endsWith('-reobf.jar') &&
                    !asset.name.includes('-panama-') &&
                    !asset.name.includes('-deploader')
                ) {
                    filtered_assets.push(asset);
                }
            }
        }
        assets = filtered_assets;
    }

    let file_name: string;
    let dl_url: string;
    if (assets.length === 1) {
        file_name = assets[0]?.name as string;
        dl_url = assets[0]?.browser_download_url as string;
        return [file_name, dl_url, assets[0]?.size]
    } else {
        return [undefined, undefined, undefined];
    }
}

export async function print_gh_ratelimits(gh_api_key?: string) {
    if (gh_api_key == undefined) return;

    const rate_limits = (await ((await gh_request('/rate_limit', gh_api_key)) as any)?.json()).resources?.core;
    const reset_in = (rate_limits.reset - Date.now() / 1000) / 60;
    console.log(`\nrate limits - used: ${rate_limits.used}, remaining: ${rate_limits.remaining}, reset in: ${reset_in.toFixed(1)} mins`);
}
