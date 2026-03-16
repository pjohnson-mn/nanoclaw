---
  name: today
  description: Preps my daily note in my Obsidian vault.
  argument-hint: "Date (optional, defaults to today)"
  ---

# Today Skill
You are helping Phil prep his daily note in his Obsidian vault for work ("dk-vault").  

# Instructions: Creating Note
- use the "_templates/_dailyNoteTemplate.md" in my vault as a template for the daily note.
- IMPORTANT: include all information in the `obsidian-dk-vault.md` context.
- the daily note should be named "YYYY-MM-DD.md" and placed in the "Daily Notes" folder in my vault.
- all other daily notes are named the same way, so if you need to find another daily note, use this format to find it (e.g., "2024-06-25.md").

# Instructions: Note Sections
- again, critical to follow context from `obsidian-dk-vault.md`.
- if an item is related to a project or task from the TaskNotes/ notes, link to that note in the daily note.
- do not create any other sections in the note other than the ones in the template.

## Personal Agenda
- look at previous business day's note and identify any items that are still relevant and should be carried forward to the next day.  These could include:
  - ongoing projects, tasks, or initiatives that are still in progress
  - unresolved issues or blockers that need attention
  - follow-ups from meetings or communications that haven't been addressed yet

## Potentially Urgent Items
- project / work blockers, time-sensitive items, urgent communications received, etc.

## Development Work
- items I need to execute that day (e.g., write an email, prepare for a meeting, etc.)

## Communication
- emails to send / respond to, people I need to talk to to resolve blockers, etc.
- include links to actual emails if available; this usually is true if communication is related to project updates or blockers, you can likely find the email link there.

## Prep for Meetings
- refer to the "Meetings to Ignore" section below to determine which meetings to ignore in the prep for meetings section.
- Items that you think I need to execute to prepare for the next day's meetings (e.g., review notes from previous meetings, prepare slides, etc.)
- meetings that have complex agendas, request AI information or deliverables, include senior executives, or are otherwise high-stakes should be prioritized.
- include links to the meeting notes when mentioning a meeting, if available; if the meeting note isn't created, use the 'new-obsidian-note-for-meetings' agent to create a note for the meeting and link to it here.

## OTHER SECTIONS
- other sections in the template do not need your attention.  Leave them blank or with the default content from the template.

# Template Placeholders
- the daily note template has the following placeholders that should be replaced with the appropriate content:
  - `{{*_business_day}}`: replace with a weekday date in "YYYY-MM-DD" format.  Make this a link to the daily note for that date (e.g., `[[2024-06-25]]`).  "next" or "previous" can be used to specify the date (e.g., "next business day", "previous business day").

# Reminders
- check for other daily notes carefully: look in "Daily Notes" folder in my vault and use the "YYYY-MM-DD.md" format to find them.

# Meetings To Ignore
The following meetings should be ignored when prepping the daily note:
- any meetings that I have not accepted the calendar invite for
- any sprint review meetings
- any CAB meetings
- any site performance team huddles / meetings
- any stand-up meetings
- any Happy Hour meetings