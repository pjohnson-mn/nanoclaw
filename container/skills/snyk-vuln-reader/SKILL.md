---
name: snyk-vuln-reader
description: >
  Read and analyze vulnerability scan results from a Snyk instance, focused on Code (SAST) findings.
  Use this skill whenever the user mentions Snyk, vulnerability scans, SAST results, code security issues,
  or wants to review, summarize, or triage security findings from Snyk. Also trigger when the user asks
  about security vulnerabilities in their codebase, wants to check scan results, or mentions
  "snyk issues", "code vulnerabilities", "security scan", or "SAST findings".
---

# Snyk Vulnerability Reader

This skill reads Code (SAST) vulnerability scan results from a Snyk instance via the Snyk REST API and presents detailed findings.

## Authentication

The skill needs a **Snyk API token** and an **organization ID**. It checks for credentials in this order:

1. Environment variables: `SNYK_TOKEN` and `SNYK_ORG_ID`
2. User-provided values passed as arguments to the script

If neither is available, ask the user to provide them. Never log or echo the token in output.

## How to use

The skill provides a Python script at `scripts/snyk_client.py` that wraps the Snyk REST API. All commands output JSON to stdout.

### Available commands

**List projects in the org:**
```bash
python scripts/snyk_client.py list-projects [--type code] [--name-filter <substring>]
```
Returns project IDs, names, and types. Use `--type code` to show only SAST-scanned projects or omit for all results [DEFAULT]. Use `--name-filter` to search by project name.

**Get code (SAST) issues for a specific project:**
```bash
python scripts/snyk_client.py get-issues --project-id <PROJECT_ID> [--severity critical,high] [--limit 100]
```
Returns detailed vulnerability records including severity, CWE, file path, line numbers, description, and remediation guidance.

**Get issue details for a single issue:**
```bash
python scripts/snyk_client.py get-issue-detail --issue-id <ISSUE_ID> --project-id <PROJECT_ID>
```
Returns the full detail for one specific vulnerability.

**Get a summary/overview across all code projects:**
```bash
python scripts/snyk_client.py summary [--severity critical,high,medium]
```
Returns aggregated counts by severity, top CWEs, and most affected projects.

### Overriding credentials via arguments

All commands accept these optional flags:
```
--token <SNYK_API_TOKEN>
--org-id <SNYK_ORG_ID>
```

## Workflow

When a user asks about Snyk vulnerabilities, follow this sequence:

1. **Check credentials** — verify `SNYK_TOKEN` and `SNYK_ORG_ID` are available (env vars or ask the user).
2. **Identify scope** — ask the user if they want results for a specific project or across all code projects. If unsure, start with `summary` to give an overview.
3. **Fetch data** — run the appropriate command from the script.
4. **Present findings** — display the results clearly. For large result sets, focus on critical and high severity first, then offer to show medium/low.

### Presenting vulnerability details

When showing individual vulnerabilities, include:
- **Title** and **severity** (critical / high / medium / low)
- **CWE ID** and category (e.g., CWE-89: SQL Injection)
- **File path and line number(s)** where the issue was found
- **Description** of the vulnerability
- **Remediation advice** if available from Snyk
- **Exploit maturity** if available (mature, proof-of-concept, no known exploit)

### Handling errors

- **401 Unauthorized**: Token is invalid or expired. Ask the user to verify their Snyk API token.
- **404 Not Found**: The org ID or project ID doesn't exist. Ask the user to double-check.
- **429 Rate Limited**: Back off and retry after the delay indicated in the response headers.
- **Network errors**: The environment may not have outbound network access. Let the user know.

## Important notes

- This skill is **read-only** — it never modifies Snyk projects, ignores issues, or changes any settings.
- The Snyk REST API paginates results. The script handles pagination automatically up to the specified limit.
- SAST results are project-scoped in Snyk. A "project" typically maps to a repository or branch.
