# obsidian-dk-vault.md

This file provides context on the folder structure, note conventions, and key scripts/templates used in the Obsidian vault "dk-vault", my work vault. It serves as a reference for understanding how the vault is organized and how to create new content that fits within the established system.


# Git Configuration

## Vault Remote

The dk-vault uses an HTTPS remote on a self-hosted Gitea instance:

```
https://g.i.pupaya.net/philj/dk-vault.git
```

## Authentication

Use a Gitea Personal Access Token (PAT) for pushing. The token is stored in the environment variable `GITEA_TOKEN`.

When pushing, use the token in the remote URL:

```bash
git -C /workspace/extra/dk-vault remote set-url origin https://$GITEA_USER:$GITEA_TOKEN@g.i.pupaya.net/philj/dk-vault.git
git -C /workspace/extra/dk-vault push
```

Or as a one-liner for pushing after a commit (URL-encodes the username to handle special characters like `+` and `@`):

```bash
ENCODED_USER=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$GITEA_USER', safe=''))") && git -C /workspace/extra/dk-vault -c "url.https://$ENCODED_USER:$GITEA_TOKEN@g.i.pupaya.net/.insteadOf=https://g.i.pupaya.net/" push
```

## Commit Convention

Follow the vault's existing commit message format:

```
nanoclaw: YYYY-MM-DD HH:mm:ss
```

For meaningful changes, use a more descriptive message:

```
nanoclaw: YYYY-MM-DD HH:mm:ss - <brief description>
```

## Workflow

After modifying any file in the vault:
1. Ask Phil if he wants to commit and push
2. Stage the specific file(s) changed
3. Commit with an appropriate message
4. Push using `GITEA_TOKEN` env variable as shown above
5. Report success or any errors back to Phil

# Vault Structure

| Folder            | Purpose                                            |
| ----------------- | -------------------------------------------------- |
| `IronsInTheFire/` | Active projects (see below)                        |
| `ai-newsletter`   | Newsletter articles organized by topic (individual notes) for my office AI newsletter |
| `meetings/`       | Meeting notes (`YYYY-MM-DD <Title>.md`)            |
| `Daily Notes/`    | Daily journal notes (`YYYY-MM-DD.md`) of what I did that day at work              |
| `@people/`        | Contact/person notes (prefixed `@Name.md`)         |
| `PKB`				| Personal knowledge base; terms, definitions, process explanations go here, heavy use of linking |
| `_templates/`     | Templater templates for all note types             |
| `_scripts/`       | QuickAdd JavaScript user scripts                   |
| `_lookups/`       | Lookup/enum files (e.g., `%noteType.md`)           |
| `learning/`       | Notes from courses, talks, articles                |
| `1-1s/`           | 1-on-1 meeting notes organized by person           |
| `experiments/`    | Exploratory/scratch work                           |


# TaskNotes
As yu'll see, the TaskNotes plugin is used in this vault.  This allows the use of an entire note to represent a task or todo.  These notes always live in the `TaskNotes` folder.

## Subfolders
`TaskNotes/Tasks` -- this is where the tasks go, of any kind, whether a normal task, project entry, etc.
`TaskNotes/Updates` -- these are normal notes that represent updates on a TaskNotes task.  The 'scan-email-for-project-updates' agent will create these notes in addition to the user.
`TaskNotes/views` -- these are Obsidian Bases that provide different views of the TaskNotes in the vault.

## Frontmatter

### TaskNotes/Updates
These notes have the following frontmatter fields and values:
- `type`: "update" -- type of update.
- `email_link`: an http link to an email if that is the source of the update.
- `related_project`: a local wiki link to the TaskNote representing the project this update pertains to.

## TaskNotes/Tasks
Default fields from the plugin:
- title, status, priority, scheduled (when I plan to do the task), dateCreated, dateModified, tags

Aside from the default frontmatter fields from the TaskNotes plugin, I have these custom fields:
- `assignedTo`: people/person running with the task, and is a local wiki link to their name note in my `@people/` folder.
- `stakeholders`: people who we are doing the task for, the sponsors of the project, etc.  These are also local wiki links to their name note in the `@people/` folder. 


# Note Frontmatter Conventions

All notes use YAML frontmatter. Key properties:

- `type`: `meeting` | `learning` | `1-1` | `project` | `project-update` | `daily`
- `createDate`: `YYYY-MM-DD`
- `people`: wikilinks to `@people/` entries

# Key Scripts (`_scripts/`)

- **`createNewProject.js`** — QuickAdd macro: scaffolds a full project folder (main note, _BOARD, .base, subfolders), adds to `_MASTER.md` On Deck column
- **`addProjectUpdate.js`** — QuickAdd macro: prompts for project selection, creates a timestamped update note in the project's `updates/` folder

# Templates (`_templates/`)

| Template | Creates |
|---|---|
| `_meetingNoteTemplate.md` | Meeting note → renames with date, moves to `meetings/` |
| `_dailyNoteTemplate.md` | Daily note with dataview of notes created that day |
| `_kanban-projectTemplate.md` | Project main note |
| `_kanban-subProjectBoardTemplate.md` | Project `_BOARD.md` Kanban board |
| `_projectUpdateTemplate.md` | Project update entry |
| `_1-1_Rudy.md` | 1-on-1 note with Rudy → moves to `1-1s/Rudy/` |
| `_learningTemplate.md` | Learning/course note |

# Plugins in Use

- **Templater** — template engine (uses `<% ... %>` syntax)
- **QuickAdd** — macro runner and capture prompts
- **TaskNotes** -- using a note to represent tasks, this is my primary way of tracking todos and projects
- **Dataview** — SQL-like queries over note metadata
- **Obsidian Kanban** — Kanban boards rendered from specially formatted markdown
- **Obsidian Bases** — database-style views from `.base` files
- **obsidian-git** — git sync/backup
- **MetaEdit / Metadata Menu** — frontmatter property editing
- **Note Toolbar** — toolbar buttons in notes

# Making Changes -- IMPORTANT!
- if you or a subagent modiy anything in the vault folder, ask the user if he wants you to do a git add, commit, and push.  
- if yes, ush the bash shell to add/stage files in git, commit with an appropriate message, then do a push.  Report the status back to the user.

# Creating Meeting Notes Guardrails
- if a meeting has "<>", "1-1", "1-on-1", or similar, it is a 1-1 meeting.   When creating a 1-1 note, use the \_1-1_NAME template, replacing NAME with the name of the person I am meeting with.
- when creating meeting notes -- NOT 1-1 NOTES:
	- insert the calendar invite message body, into the {invite_details} keyword of the note.
	- ensure the text is readable
- in the "people" frontmatter, add links to people in the @people folder
- for people not in that folder, add them to the "Other Attendees" section