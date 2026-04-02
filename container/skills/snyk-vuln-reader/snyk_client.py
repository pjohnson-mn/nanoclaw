#!/usr/bin/env python3
"""
Snyk REST API client for reading Code (SAST) vulnerability scan results.

Usage:
    python snyk_client.py list-projects [--type code] [--name-filter <str>]
    python snyk_client.py get-issues --project-id <ID> [--severity critical,high] [--limit 100]
    python snyk_client.py get-issue-detail --issue-id <ID> --project-id <ID>
    python snyk_client.py summary [--severity critical,high,medium]

All commands accept:  --token <TOKEN>  --org-id <ORG_ID>
Falls back to SNYK_TOKEN and SNYK_ORG_ID environment variables.
"""

import argparse
import json
import os
import sys
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, quote

API_BASE = "https://api.snyk.io"
REST_VERSION = "2024-10-15"
DEFAULT_LIMIT = 100
MAX_PAGES = 20


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def _headers(token: str) -> dict:
    return {
        "Authorization": f"token {token}",
        "Content-Type": "application/vnd.api+json",
        "Accept": "application/vnd.api+json",
    }


def _get(url: str, token: str, retries: int = 2) -> dict:
    """Make a GET request with basic retry on 429."""
    req = Request(url, headers=_headers(token), method="GET")
    for attempt in range(retries + 1):
        try:
            with urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode())
        except HTTPError as e:
            if e.code == 429 and attempt < retries:
                retry_after = int(e.headers.get("Retry-After", "5"))
                print(f"Rate limited, waiting {retry_after}s...", file=sys.stderr)
                time.sleep(retry_after)
                continue
            body = e.read().decode() if e.fp else ""
            print(json.dumps({
                "error": True,
                "status": e.code,
                "reason": e.reason,
                "detail": body[:500],
            }))
            sys.exit(1)
        except URLError as e:
            print(json.dumps({
                "error": True,
                "detail": f"Network error: {e.reason}. Check that outbound HTTPS is allowed.",
            }))
            sys.exit(1)


def _paginate(base_url: str, token: str, limit: int = DEFAULT_LIMIT) -> list:
    """Follow 'next' links to collect paginated results up to *limit* items."""
    collected = []
    url = base_url
    pages = 0
    while url and len(collected) < limit and pages < MAX_PAGES:
        data = _get(url, token)
        items = data.get("data", [])
        collected.extend(items)
        next_link = (data.get("links") or {}).get("next")
        if next_link and not next_link.startswith("http"):
            next_link = API_BASE + next_link
        url = next_link
        pages += 1
    return collected[:limit]


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def list_projects(token: str, org_id: str, project_type: str | None, name_filter: str | None):
    """List projects in the organization, optionally filtered."""
    params = {"version": REST_VERSION, "limit": "100"}
    if project_type:
        params["types"] = project_type
    url = f"{API_BASE}/rest/orgs/{quote(org_id)}/projects?{urlencode(params)}"
    projects = _paginate(url, token, limit=500)

    results = []
    for p in projects:
        attrs = p.get("attributes", {})
        name = attrs.get("name", "")
        if name_filter and name_filter.lower() not in name.lower():
            continue
        results.append({
            "id": p.get("id"),
            "name": name,
            "type": attrs.get("type"),
            "origin": attrs.get("origin"),
            "status": attrs.get("status"),
            "created": attrs.get("created"),
        })

    print(json.dumps({"count": len(results), "projects": results}, indent=2))


def get_issues(token: str, org_id: str, project_id: str, severities: list[str] | None, limit: int, issue_type: str | None = None):
    """Fetch code (SAST) issues for a project."""
    params = {
        "version": REST_VERSION,
        "limit": str(min(limit, 100)),
        "scan_item.id": project_id,
        "scan_item.type": "project",
    }
    if issue_type:
        params["type"] = issue_type

    if severities:
        params["effective_severity_level"] = ",".join(severities)

    url = f"{API_BASE}/rest/orgs/{quote(org_id)}/issues?{urlencode(params)}"
    issues = _paginate(url, token, limit=limit)

    results = []
    for issue in issues:
        attrs = issue.get("attributes", {})
        coords = attrs.get("coordinates", [])
        file_paths = []
        for coord in coords:
            reps = coord.get("representations", [])
            for rep in reps:
                ri = rep.get("resourcePath", "")
                if ri:
                    file_paths.append({
                        "path": ri,
                        "start_line": rep.get("region", {}).get("start", {}).get("line"),
                        "end_line": rep.get("region", {}).get("end", {}).get("line"),
                    })

        problems = attrs.get("problems", [])
        cwes = []
        for prob in problems:
            source = prob.get("source", "")
            prob_id = prob.get("id", "")
            if "CWE" in source.upper() or "CWE" in prob_id.upper():
                cwes.append(prob_id)

        results.append({
            "id": issue.get("id"),
            "title": attrs.get("title", ""),
            "severity": attrs.get("effective_severity_level", ""),
            "status": attrs.get("status", ""),
            "type": attrs.get("type", ""),
            "description": (attrs.get("description") or "")[:1000],
            "cwes": cwes,
            "file_locations": file_paths,
            "exploit_maturity": attrs.get("exploit_maturity", ""),
            "created": attrs.get("created_at", ""),
            "problems": [{"id": p.get("id"), "source": p.get("source"), "url": p.get("url", "")} for p in problems],
        })

    print(json.dumps({
        "count": len(results),
        "project_id": project_id,
        "issues": results,
    }, indent=2))


def get_issue_detail(token: str, org_id: str, issue_id: str, project_id: str):
    """Fetch full detail for a single issue."""
    params = {
        "version": REST_VERSION,
        "scan_item.id": project_id,
        "scan_item.type": "project",
    }
    url = f"{API_BASE}/rest/orgs/{quote(org_id)}/issues/detail/{quote(issue_id)}?{urlencode(params)}"
    data = _get(url, token)
    print(json.dumps(data, indent=2))


def summary(token: str, org_id: str, severities: list[str] | None, issue_type: str | None = None):
    """Aggregate SAST issue counts across all code projects."""
    # First, list code projects
    params = {"version": REST_VERSION, "limit": "100"}
    if issue_type:
        params["types"] = issue_type
    url = f"{API_BASE}/rest/orgs/{quote(org_id)}/projects?{urlencode(params)}"
    projects = _paginate(url, token, limit=500)

    if not projects:
        # Try without type filter and look for code-related projects
        params.pop("types", None)
        url = f"{API_BASE}/rest/orgs/{quote(org_id)}/projects?{urlencode(params)}"
        projects = _paginate(url, token, limit=500)

    severity_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    cwe_counts: dict[str, int] = {}
    project_issue_counts: list[dict] = []
    total_issues = 0

    for proj in projects:
        proj_id = proj.get("id")
        proj_name = proj.get("attributes", {}).get("name", "unknown")

        issue_params = {
            "version": REST_VERSION,
            "limit": "100",
            "scan_item.id": proj_id,
            "scan_item.type": "project",
        }
        if issue_type:
            issue_params["type"] = issue_type
        if severities:
            issue_params["effective_severity_level"] = ",".join(severities)

        issue_url = f"{API_BASE}/rest/orgs/{quote(org_id)}/issues?{urlencode(issue_params)}"
        issues = _paginate(issue_url, token, limit=500)

        proj_count = len(issues)
        if proj_count == 0:
            continue

        total_issues += proj_count
        project_issue_counts.append({"project": proj_name, "id": proj_id, "issue_count": proj_count})

        for issue in issues:
            attrs = issue.get("attributes", {})
            sev = attrs.get("effective_severity_level", "").lower()
            if sev in severity_counts:
                severity_counts[sev] += 1

            for prob in attrs.get("problems", []):
                pid = prob.get("id", "")
                if pid.startswith("CWE"):
                    cwe_counts[pid] = cwe_counts.get(pid, 0) + 1

    # Sort projects by issue count descending
    project_issue_counts.sort(key=lambda x: x["issue_count"], reverse=True)
    # Top CWEs
    top_cwes = sorted(cwe_counts.items(), key=lambda x: x[1], reverse=True)[:10]

    print(json.dumps({
        "total_issues": total_issues,
        "severity_breakdown": severity_counts,
        "top_cwes": [{"cwe": c, "count": n} for c, n in top_cwes],
        "most_affected_projects": project_issue_counts[:10],
        "total_code_projects_scanned": len(project_issue_counts),
    }, indent=2))


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Snyk SAST vulnerability reader")
    parser.add_argument("--token", default=os.environ.get("SNYK_TOKEN"), help="Snyk API token")
    parser.add_argument("--org-id", default=os.environ.get("SNYK_ORG_ID"), help="Snyk organization ID")

    sub = parser.add_subparsers(dest="command", required=True)

    # list-projects
    lp = sub.add_parser("list-projects", help="List projects in the org")
    lp.add_argument("--type", dest="project_type", default=None, help="Filter by project type (e.g. 'sast', 'code')")
    lp.add_argument("--name-filter", default=None, help="Substring filter on project name")

    # get-issues
    gi = sub.add_parser("get-issues", help="Get SAST issues for a project")
    gi.add_argument("--project-id", required=True, help="Snyk project ID")
    gi.add_argument("--severity", default=None, help="Comma-separated severity filter (e.g. critical,high)")
    gi.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="Max issues to return")

    # get-issue-detail
    gd = sub.add_parser("get-issue-detail", help="Get full detail for one issue")
    gd.add_argument("--issue-id", required=True)
    gd.add_argument("--project-id", required=True)

    # summary
    sm = sub.add_parser("summary", help="Aggregate overview across code projects")
    sm.add_argument("--severity", default=None, help="Comma-separated severity filter")

    # issue type
    gi.add_argument("--issue-type", default=None, help="Filter by issue type (e.g. 'code', 'vuln')")
    sm.add_argument("--issue-type", default=None, help="Filter by issue type (e.g. 'code', 'vuln')")

    args = parser.parse_args()

    if not args.token:
        print(json.dumps({"error": True, "detail": "No Snyk API token. Set SNYK_TOKEN env var or pass --token."}))
        sys.exit(1)
    if not args.org_id:
        print(json.dumps({"error": True, "detail": "No Snyk org ID. Set SNYK_ORG_ID env var or pass --org-id."}))
        sys.exit(1)

    sevs = [s.strip() for s in args.severity.split(",")] if getattr(args, "severity", None) else None

    if args.command == "list-projects":
        list_projects(args.token, args.org_id, args.project_type, args.name_filter)
    elif args.command == "get-issues":
        get_issues(args.token, args.org_id, args.project_id, sevs, args.limit, getattr(args, "issue_type", None))
    elif args.command == "get-issue-detail":
        get_issue_detail(args.token, args.org_id, args.issue_id, args.project_id)
    elif args.command == "summary":
        summary(args.token, args.org_id, sevs, getattr(args, "issue_type", None))


if __name__ == "__main__":
    main()
