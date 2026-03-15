# obsidian-dk-vault.md

This file provides context on the folder structure, note conventions, and key scripts/templates used in the Obsidian vault "dk-vault", my work vault. It serves as a reference for understanding how the vault is organized and how to create new content that fits within the established system.

# Folder location
1. First, determine which machine you are running on by running `hostname` via bash.  
2. Use this table to determine the Obsidian vault location:

| hostname | Vault folder |
|---|---|
| pi-1 | /home/pjohnson/dk-vault/ |
| Yeti | /mnt/c/vaults/dk-vault |


# Git / Backup

The vault is synced via the obsidian-git plugin with auto-commit messages in the format:
```
vault backup: YYYY-MM-DD HH:mm:ss
```
Manual commits should follow the same convention or be more descriptive.

# Vault Structure

| Folder            | Purpose                                            |
| ----------------- | -------------------------------------------------- |
| `IronsInTheFire/` | Active projects (see below)                        |
| `ai-newsletter`   | Newsletter articles organized by topic (individual notes) for my office AI newsletter |
| `meetings/`       | Meeting notes (`YYYY-MM-DD <Title>.md`)            |
| `Daily Notes/`    | Daily journal notes (`YYYY-MM-DD.md`) of what I did that day at work              |
| `@people/`        | Contact/person notes (prefixed `@Name.md`)         |
| `PKB/`            | Personal Knowledge Base — reference notes, how-tos |
| `_templates/`     | Templater templates for all note types             |
| `_scripts/`       | QuickAdd JavaScript user scripts                   |
| `_lookups/`       | Lookup/enum files (e.g., `%noteType.md`)           |
| `learning/`       | Notes from courses, talks, articles                |
| `1-1s/`           | 1-on-1 meeting notes organized by person           |
| `experiments/`    | Exploratory/scratch work                           |


# Project System ("Irons in the Fire")

Projects live under `IronsInTheFire/` with names prefixed by `!` (e.g., `!My Project`). Each project folder contains:

- `!ProjectName.md` — main project note with description, milestones, and embedded Bases views
- `_BOARD.md` — Kanban board (On Deck / In Progress / Complete)
- `ProjectName.base` — Obsidian Bases file with `updates` and `blockers` table views
- `updates/` — timestamped update notes (`YYYY-MM-DD HHMM AM/PM - Title.md`)
- `blockers/` — blocker notes
- `notes/` — miscellaneous project notes

`IronsInTheFire/_MASTER.md` is the top-level Kanban board linking all active projects.

New projects are created via the **"Add an Iron to the Fire"** QuickAdd macro, which runs `_scripts/createNewProject.js`.

# Note Frontmatter Conventions

All notes use YAML frontmatter. Key properties:

- `type`: `meeting` | `learning` | `1-1` | `project` | `project-update` | `daily`
- `createDate`: `YYYY-MM-DD`
- `people`: wikilinks to `@people/` entries
- `related_project`: wikilink to project note

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