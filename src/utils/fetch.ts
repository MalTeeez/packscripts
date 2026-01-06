import type { JsonObject } from "./utils";

export async function check_gh_releases(url: string, gh_api_key: string): Promise<{ status: string; body: JsonObject | undefined }> {
    const project = url.match(/(?:github.com\/(.+?\/.+?))(?:\/|$)/m)?.at(1);
    if (project) {
        const res: Response | undefined = await gh_request(`/repos/${project}/releases/latest`, gh_api_key, 'GET');
        if (res == undefined || !res.ok) {
            console.warn(`W: Failed to get releases with ${res.status} | ${res.statusText} for ${project}`);
            return { body: undefined, status: String(res.status) };
        } else {
            if (res.headers.get('content-type')?.includes('application/json')) {
                const body = (await res.json()) as JsonObject;
                return { body, status: String(res.status) };
            }
        }
    } else {
        console.warn(`W: GitHub URL ${url} is fauly, can't check..`);
    }
    return { body: undefined, status: '400' };
}

export function download_file(
    source: string,
    source_type: 'GH_RELEASE' | 'CURSEFORGE' | 'MODRINTH' | 'OTHER',
    destination: string,
    file_name: string,
    source_api_key: string,
): Promise<string> {
    return new Promise(async (resolve, reject) => {
        let res: Response;
        if (source_type === 'GH_RELEASE') {
            res = await gh_request(source, source_api_key, 'GET');
        } else {
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
        console.log(res)
    }

    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
        const reset = res.headers.get('x-ratelimit-reset');
        const secs = reset ? Math.max(0, parseInt(reset) * 1000 - Date.now()) / 1000 : undefined;
        console.warn(`W: GitHub rate limit exceeded. Resets in ~${secs?.toFixed(0)}s`);
    }

    return res;
}

export async function print_gh_ratelimits(gh_api_key: string) {
    const rate_limits = (await ((await gh_request('/rate_limit', gh_api_key)) as any)?.json()).resources?.core;
    const reset_in = (rate_limits.reset - Date.now() / 1000) / 60;
    console.log(`rate limits - used: ${rate_limits.used}, remaining: ${rate_limits.remaining}, reset in: ${reset_in.toFixed(1)} mins`);
}