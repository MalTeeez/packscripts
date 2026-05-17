import { ANNOTATED_FILE } from '../utils/config';
import { assert_gh_key, query_gh_project_by_url } from '../utils/fetch';
import { read_saved_mods, type mod_object } from '../utils/mods';
import { extract_required_prs, parse_gh_url } from '../utils/sources';
import { CLIColor } from '../utils/utils';
import { apply_github_artifact } from './version';

const FAILED_WORKFLOW_CONCLUSIONS: ReadonlyArray<string> = ['failure', 'cancelled', 'timed_out', 'startup_failure', 'action_required'];

interface WorkflowRunSummary {
    html_url: string;
    id: number;
    name: string;
    status?: string | null;
    conclusion?: string | null;
}

export interface Artifact {
    name: string;
    archive_download_url: string;
    size_in_bytes: number;
    digest: string;
    expired: boolean;
}

//#region gh helpers
/**
 * Checks the given workflow runs (those associated with a single commit) for any failed runs.
 * Returns true if execution should abort (i.e. at least one run failed and `allow_failed_workflows` is false).
 * Logs every failed run regardless.
 */
function detect_failed_workflows(workflow_runs: WorkflowRunSummary[], allow_failed_workflows: boolean): boolean {
    const failed = workflow_runs.filter((r) => r.conclusion != null && FAILED_WORKFLOW_CONCLUSIONS.includes(r.conclusion));
    if (failed.length === 0) return false;

    for (const run of failed) {
        console.warn(
            `${CLIColor.FgRed10}FAIL:${CLIColor.Reset} Workflow ${CLIColor.FgRed10}${CLIColor.Bright}${run.name}${CLIColor.Reset} ` +
                `${CLIColor.FgGray}(${CLIColor.FgGray18}#${run.id}${CLIColor.FgGray})${CLIColor.Reset} ` +
                `concluded as ${CLIColor.FgRed10}${CLIColor.Bright}${run.conclusion}${CLIColor.Reset}.`,
        );
    }
    if (allow_failed_workflows) {
        console.warn(
            `${CLIColor.FgYellow1}WARN:${CLIColor.Reset} ${CLIColor.Bright}${failed.length}${CLIColor.Reset} failed workflow run(s) ` +
                `tolerated due to ${CLIColor.Bright}${CLIColor.FgWhite}--allow_failed_workflows${CLIColor.Reset}.`,
        );
        return false;
    }
    console.error(
        `${CLIColor.FgRed10}ERR:${CLIColor.Reset} Aborting because ${CLIColor.Bright}${failed.length}${CLIColor.Reset} workflow run(s) failed. ` +
            `Pass ${CLIColor.Bright}${CLIColor.FgWhite}--allow_failed_workflows${CLIColor.Reset} to override.`,
    );
    return true;
}

export async function get_dl_url_from_github_url(
    source_url: string,
    build_job?: string,
    artifact_name?: string,
    commit_lookback: number = 10,
    allow_failed_workflows: boolean = false,
): Promise<Artifact | undefined> {
    const url_match = parse_gh_url(source_url);

    if (url_match) {
        let { owner, project, primary, secondary, key, asset, fifth } = url_match;
        console.info(
            `${CLIColor.FgGray}-${CLIColor.Reset} Resolving source url ${CLIColor.FgGray}(${CLIColor.FgGray18}${source_url}${CLIColor.FgGray})${CLIColor.Reset} ` +
                `for project ${CLIColor.BgBlue0}${CLIColor.FgWhite1}${CLIColor.Bright} ${owner}/${project} ${CLIColor.Reset}${CLIColor.FgGray}...${CLIColor.Reset}`,
        );

        // This is something that might have workflow runs
        let other_workflows: { name: string | undefined; id: string }[] = [];
        if ((primary === 'tree' || primary === 'pull') && secondary != undefined) {
            let parsed = undefined;
            if (primary === 'pull') {
                console.info(
                    `${CLIColor.FgGray}-${CLIColor.Reset} Walking commits of PR ${CLIColor.BgTeal3}${CLIColor.FgWhite1}${CLIColor.Bright} #${secondary} ${CLIColor.Reset} ` +
                        `to find a workflow run${CLIColor.FgGray}...${CLIColor.Reset}`,
                );
                // For a PR, walk backwards through commits (newest first) until we find one with workflow runs
                const { status: pr_status, body: pr_body } = await query_gh_project_by_url(source_url, `/pulls/${secondary}`);
                const head_sha = pr_status === '200' && pr_body != null ? ((pr_body as any).head?.sha as string | undefined) : undefined;

                // Build commit list: start with HEAD, then append remaining PR commits oldest -> newest reversed
                const commit_shas: string[] = [];
                if (head_sha != undefined) commit_shas.push(head_sha);

                const { status: commits_status, body: commits_body } = await query_gh_project_by_url(source_url, `/pulls/${secondary}/commits?per_page=100`);
                if (commits_status === '200' && commits_body != null && Array.isArray(commits_body)) {
                    // GitHub returns commits oldest-first; reverse so we walk newest-first, skipping head_sha already added
                    for (const commit of (commits_body as any[]).reverse()) {
                        const sha = commit.sha as string;
                        if (sha !== head_sha) commit_shas.push(sha);
                    }
                }
                console.info(
                    `${CLIColor.FgGray}-${CLIColor.Reset} Checking ${CLIColor.Bright}${commit_shas.length}${CLIColor.Reset} commits ` +
                        `${CLIColor.FgGray}(head: ${CLIColor.FgGray18}${head_sha?.slice(0, 7) ?? '?'}${CLIColor.FgGray})${CLIColor.Reset} for workflow runs.`,
                );

                for (const sha of commit_shas) {
                    const { status, body } = await query_gh_project_by_url(source_url, `/actions/runs?head_sha=${sha}`);
                    if (status === '200' && body != null && Array.isArray((body as any).workflow_runs) && (body as any).workflow_runs.length > 0) {
                        const workflow_runs = (body as any).workflow_runs as Array<WorkflowRunSummary>;
                        console.info(
                            `${CLIColor.FgGray}-${CLIColor.Reset} Found ${CLIColor.Bright}${workflow_runs.length}${CLIColor.Reset} workflow run(s) ` +
                                `for commit ${CLIColor.FgGray}(${CLIColor.FgGray18}${sha.slice(0, 7)}${CLIColor.FgGray})${CLIColor.Reset}, ` +
                                `using ${CLIColor.BgBlue0}${CLIColor.FgWhite1}${CLIColor.Bright} ${workflow_runs[0]!.name} ${CLIColor.Reset}.`,
                        );

                        if (detect_failed_workflows(workflow_runs, allow_failed_workflows)) {
                            return undefined;
                        }

                        if (workflow_runs.length > 1) {
                            other_workflows = workflow_runs.slice(1).map((run) => {
                                return { name: run.name, id: String(run.id) };
                            });
                        }

                        parsed = parse_gh_url((body as any).workflow_runs[0].html_url);
                        break;
                    }
                }
            } else {
                console.info(
                    `${CLIColor.FgGray}-${CLIColor.Reset} Walking last ${CLIColor.Bright}${commit_lookback}${CLIColor.Reset} commits of branch ` +
                        `${CLIColor.BgTeal3}${CLIColor.FgWhite1}${CLIColor.Bright} ${secondary} ${CLIColor.Reset} to find a workflow run${CLIColor.FgGray}...${CLIColor.Reset}`,
                );
                // For a branch, fetch the last x (commit_lookback) commits (newest-first) and walk until we find runs
                const { status: commits_status, body: commits_body } = await query_gh_project_by_url(
                    source_url,
                    `/commits?sha=${encodeURIComponent(secondary)}&per_page=${commit_lookback}`,
                );
                if (commits_status === '200' && commits_body != null && Array.isArray(commits_body)) {
                    for (const commit of commits_body as any[]) {
                        const sha = commit.sha as string;
                        const { status, body } = await query_gh_project_by_url(source_url, `/actions/runs?head_sha=${sha}`);
                        if (status === '200' && body != null && Array.isArray((body as any).workflow_runs) && (body as any).workflow_runs.length > 0) {
                            const workflow_runs = (body as any).workflow_runs as Array<WorkflowRunSummary>;
                            console.info(
                                `${CLIColor.FgGray}-${CLIColor.Reset} Found ${CLIColor.Bright}${workflow_runs.length}${CLIColor.Reset} workflow run(s) ` +
                                    `for commit ${CLIColor.FgGray}(${CLIColor.FgGray18}${sha.slice(0, 7)}${CLIColor.FgGray})${CLIColor.Reset}, ` +
                                    `using ${CLIColor.BgBlue0}${CLIColor.FgWhite1}${CLIColor.Bright} ${workflow_runs[0]!.name} ${CLIColor.Reset}.`,
                            );

                            if (detect_failed_workflows(workflow_runs, allow_failed_workflows)) {
                                return undefined;
                            }

                            if (workflow_runs.length > 1) {
                                other_workflows = workflow_runs.slice(1).map((run) => {
                                    return { name: run.name, id: String(run.id) };
                                });
                            }

                            parsed = parse_gh_url(workflow_runs[0]!.html_url);
                            break;
                        }
                    }
                }
            }
            if (parsed != undefined) {
                primary = parsed.primary;
                secondary = parsed.secondary;
                key = parsed.key;
                asset = parsed.asset;
                fifth = parsed.fifth;
            } else {
                console.warn(
                    `${CLIColor.FgYellow1}WARN:${CLIColor.Reset} No workflow runs found while walking ` +
                        `${primary === 'pull' ? 'PR' : 'branch'} ${CLIColor.Bright}${secondary}${CLIColor.Reset}.`,
                );
            }
        }

        // This is a workflow run
        if (primary === 'actions' && secondary === 'runs' && key != undefined) {
            console.info(
                `${CLIColor.FgGray}-${CLIColor.Reset} Resolved to workflow run ${CLIColor.BgBlue0}${CLIColor.FgWhite1}${CLIColor.Bright} ${key} ${CLIColor.Reset}` +
                    (other_workflows.length > 0
                        ? ` ${CLIColor.FgGray}(+${CLIColor.FgGray18}${other_workflows.length}${CLIColor.FgGray} other workflow(s) for the same commit)${CLIColor.Reset}`
                        : '') +
                    '.',
            );
            // We have a link to a workflow run
            let workflow_run_name = undefined;
            if (build_job != undefined) {
                const { status, body } = await query_gh_project_by_url(source_url, `/actions/runs/${key}`);
                if (status === '200' && body != null && body['name'] != undefined) {
                    workflow_run_name = body['name'] as string | undefined;
                }
                console.info(
                    `${CLIColor.FgGray}-${CLIColor.Reset} Filtering by build job ${CLIColor.BgTeal3}${CLIColor.FgWhite1}${CLIColor.Bright} ${build_job} ${CLIColor.Reset} ` +
                        `${CLIColor.FgGray}(primary run: ${CLIColor.FgGray18}${workflow_run_name ?? '?'}${CLIColor.FgGray})${CLIColor.Reset}.`,
                );
            }

            let collected_artifacts: Artifact[] = [];
            const workflows = [{ name: workflow_run_name, id: key }, ...other_workflows];
            console.info(
                `${CLIColor.FgGray}-${CLIColor.Reset} Collecting artifacts across ${CLIColor.Bright}${workflows.length}${CLIColor.Reset} workflow run(s)${CLIColor.FgGray}...${CLIColor.Reset}`,
            );

            for (const workflow_run of workflows) {
                // Get artifacts of workflow by id and store all download urls
                const { status, body } = await query_gh_project_by_url(source_url, `/actions/runs/${workflow_run.id}/artifacts`);
                if (status === '200' && body != null && Array.isArray((body as any).artifacts)) {
                    const artifacts = (body as any).artifacts as Array<Artifact>;
                    const stripped_artifacts = artifacts
                        .filter((artifact) => !artifact.expired)
                        .map((artifact) => {
                            return {
                                name: artifact.name,
                                archive_download_url: artifact.archive_download_url,
                                size_in_bytes: artifact.size_in_bytes,
                                digest: artifact.digest.slice(7),
                                expired: artifact.expired,
                            };
                        });

                    const expired_count = artifacts.length - stripped_artifacts.length;
                    console.info(
                        `${CLIColor.FgGray}  -${CLIColor.Reset} Workflow ${CLIColor.FgGray}(${CLIColor.FgGray18}${workflow_run.name ?? workflow_run.id}${CLIColor.FgGray})${CLIColor.Reset}: ` +
                            `${CLIColor.Bright}${stripped_artifacts.length}${CLIColor.Reset} usable artifact(s)` +
                            (expired_count > 0 ? ` ${CLIColor.FgGray}(${CLIColor.FgOrange5}${expired_count} expired${CLIColor.FgGray})${CLIColor.Reset}` : '') +
                            '.',
                    );

                    if (build_job != undefined && workflow_run.name != undefined && workflow_run.name.toLowerCase() === build_job.toLowerCase()) {
                        // If this is the job we are filtering for, just use it and nothing else
                        console.info(
                            `${CLIColor.FgGray}-${CLIColor.Reset} Workflow ${CLIColor.BgBlue0}${CLIColor.FgWhite1}${CLIColor.Bright} ${workflow_run.name} ${CLIColor.Reset} ` +
                                `matches build job filter, using exclusively.`,
                        );
                        collected_artifacts = [];
                        collected_artifacts.push(...stripped_artifacts);
                        break;
                    } else {
                        collected_artifacts.push(...stripped_artifacts);
                    }
                }
            }

            if (collected_artifacts.length < 1) {
                console.warn(`${CLIColor.FgYellow1}WARN:${CLIColor.Reset} Found no artifacts across ${CLIColor.Bright}${workflows.length}${CLIColor.Reset} workflows.`);
                return undefined;
            }
            // Try with a filter if we have one
            if (artifact_name != undefined) {
                console.info(
                    `${CLIColor.FgGray}-${CLIColor.Reset} Filtering ${CLIColor.Bright}${collected_artifacts.length}${CLIColor.Reset} artifact(s) ` +
                        `by name ${CLIColor.BgTeal3}${CLIColor.FgWhite1}${CLIColor.Bright} ${artifact_name} ${CLIColor.Reset}.`,
                );
                const artifact = collected_artifacts.find((entry) => entry.name.toLowerCase().includes(artifact_name.toLowerCase()));

                if (artifact == undefined) {
                    console.warn(
                        `${CLIColor.FgYellow1}WARN:${CLIColor.Reset} Failed to find artifact for filter ` +
                            `${CLIColor.FgGray}'${CLIColor.FgGray18}${artifact_name}${CLIColor.FgGray}'${CLIColor.Reset} ` +
                            `across ${CLIColor.Bright}${collected_artifacts.length}${CLIColor.Reset} artifacts.`,
                    );
                }
                return artifact;
            }

            if (collected_artifacts.length > 1) {
                console.warn(
                    `${CLIColor.FgYellow1}WARN:${CLIColor.Reset} Found more than one artifact ` +
                        `${CLIColor.FgGray}(${CLIColor.FgGray18}${collected_artifacts.length}${CLIColor.FgGray})${CLIColor.Reset}, ` +
                        `using first ${CLIColor.FgGray}('${CLIColor.FgGray18}${collected_artifacts[0]?.name}${CLIColor.FgGray}')${CLIColor.Reset}. ` +
                        `You can filter artifacts by providing ${CLIColor.Bright}${CLIColor.FgWhite}--artifact_name${CLIColor.Reset}.`,
                );
            }

            return collected_artifacts[0];
        } else {
            console.warn(
                `${CLIColor.FgYellow1}WARN:${CLIColor.Reset} Failed to trace a workflow from url ` +
                    `${CLIColor.FgGray}(${CLIColor.FgGray18}${source_url}${CLIColor.FgGray})${CLIColor.Reset}.`,
            );
        }
    } else {
        console.warn(
            `${CLIColor.FgYellow1}WARN:${CLIColor.Reset} Failed to parse source url ` +
                `${CLIColor.FgGray}(${CLIColor.FgGray18}${source_url}${CLIColor.FgGray})${CLIColor.Reset} as a GitHub url.`,
        );
    }
    return undefined;
}

//#region apply gh pr
export async function apply_github_pr(
    source_url: string | undefined,
    options: {
        dry: boolean;
        build_job?: string;
        artifact_name?: string;
        limit_to_original_owner?: boolean;
        other_allowed_owners?: string[];
        allow_failed_workflows?: boolean;
    },
    traced_prs?: string[],
    mod_map?: Map<string, mod_object>,
) {
    if (source_url == undefined) {
        console.error(`${CLIColor.FgRed10}ERR:${CLIColor.Reset} Missing source url.`);
        throw Error();
    }
    assert_gh_key();
    mod_map = mod_map ?? (await read_saved_mods(ANNOTATED_FILE));

    if (traced_prs == undefined) {
        traced_prs = [];
    }

    const url_match = parse_gh_url(source_url);
    if (url_match) {
        let { owner, project, primary, secondary, key, asset, fifth } = url_match;

        if (primary === 'pull' && secondary != undefined) {
            // Add to prs we visited if new, skip otherwise
            const pr_id = `${owner}/${project}/pull/${secondary}`;
            if (traced_prs.includes(pr_id)) {
                console.info(
                    `${CLIColor.FgGray}-${CLIColor.Reset} Found ref to PR we already visited ` +
                        `${CLIColor.BgTeal3}${CLIColor.FgWhite1}${CLIColor.Bright} ${pr_id} ${CLIColor.Reset}, skipping.`,
                );
                return;
            } else {
                traced_prs.push(pr_id);
            }

            // Get description of pr and check for mentions of required PRs (also acts as a general guard for broken prs)
            const { status, body } = await query_gh_project_by_url(source_url, `/pulls/${secondary}`);
            if (status === '200' && body != null && typeof body['body'] === 'string') {
                const required_prs = extract_required_prs(body['body']);
                for (const required_pr_match of required_prs) {
                    for (const required_pr of required_pr_match.pr_urls) {
                        const url_match = parse_gh_url(required_pr);
                        if (url_match) {
                            // We already enforce a PR
                            let { owner: ref_owner, project: ref_project, primary: ref_primary, secondary: ref_secondary } = url_match;
                            if (
                                options.limit_to_original_owner && // Are we told to limit the repo inclusion owners
                                (ref_owner !== owner || // Does the owner of the repo in the link not match the original owner
                                    (options.other_allowed_owners != undefined && // Or is this pr links owner in the allowlist
                                        options.other_allowed_owners.find((allowed_owner) => allowed_owner.toLowerCase() === ref_owner) != undefined))
                            ) {
                                console.info(
                                    `${CLIColor.FgGray}-${CLIColor.Reset} Found required PR in ` +
                                        `${CLIColor.BgTeal3}${CLIColor.FgWhite1}${CLIColor.Bright} ${pr_id} ${CLIColor.Reset}, ` +
                                        `but it ${CLIColor.FgGray}(${CLIColor.FgGray18}${ref_owner}/${ref_project}/pull/${ref_secondary}${CLIColor.FgGray})${CLIColor.Reset} ` +
                                        `leads to another owner ${CLIColor.FgGray}(${CLIColor.FgGray18}${ref_owner}${CLIColor.FgGray})${CLIColor.Reset}, ` +
                                        `which is not in the allowlist, skipping.`,
                                );
                                continue;
                            }

                            console.info(
                                `${CLIColor.FgGray}-${CLIColor.Reset} Found required PR in ` +
                                    `${CLIColor.BgTeal3}${CLIColor.FgWhite1}${CLIColor.Bright} ${pr_id} ${CLIColor.Reset}, following${CLIColor.FgGray}...${CLIColor.Reset}`,
                            );
                            await apply_github_pr(required_pr, options, traced_prs, mod_map);
                        }
                    }
                }

                // We are finished resolving required PRs, no we need to apply ourselves
                const artifact = await get_dl_url_from_github_url(source_url, options.build_job, options.artifact_name, 10, options.allow_failed_workflows ?? false);

                if (artifact == undefined) {
                    console.error(
                        `${CLIColor.FgRed10}ERR:${CLIColor.Reset} Failed to find a download url from source url ${CLIColor.FgGray}'${CLIColor.FgGray18}${source_url}${CLIColor.FgGray}'${CLIColor.Reset}.`,
                    );
                    throw Error();
                } else {
                    console.info(
                        `Using artifact ${CLIColor.BgBlue0}${CLIColor.FgWhite1}${CLIColor.Bright} ${artifact.name} ${CLIColor.Reset} ` +
                            `${CLIColor.FgGray}(${CLIColor.FgGray18}${(artifact.size_in_bytes / 1024).toFixed(0)} ${CLIColor.FgGray14}KB${CLIColor.FgGray}, ` +
                            `${CLIColor.FgGray18}${artifact.digest.slice(0, 12)}…${CLIColor.FgGray})${CLIColor.Reset}`,
                    );
                }
                console.info(
                    `${CLIColor.FgGray}-${CLIColor.Reset} Applying PR ${CLIColor.BgBlue0}${CLIColor.FgWhite1}${CLIColor.Bright} ${pr_id} ${CLIColor.Reset}${CLIColor.FgGray}...${CLIColor.Reset}`,
                );
                await apply_github_artifact(artifact, options, mod_map);
            }
        } else {
            console.error(
                `${CLIColor.FgRed10}ERR:${CLIColor.Reset} Provided link ${CLIColor.FgGray}(${CLIColor.FgGray18}${source_url}${CLIColor.FgGray})${CLIColor.Reset} ` +
                    `does not appear to be a pull request link.`,
            );
            throw Error();
        }
    } else {
        console.warn(
            `${CLIColor.FgYellow1}WARN:${CLIColor.Reset} Failed to parse source url ` +
                `${CLIColor.FgGray}(${CLIColor.FgGray18}${source_url}${CLIColor.FgGray})${CLIColor.Reset} as a GitHub url.`,
        );
    }
}
