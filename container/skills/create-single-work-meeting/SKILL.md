---
name: create-new-work-meeting-invite
description: use this skill to create a new single-occurrence meeting in Phil's Work (Outlook) calendar and invite people.
allowed-tools: Bash(*), phils-outlook
---

# Quick Start

## Tool Use
- use the 'phils-outlook' MCP tool in 'create-single-event' mode
- dates and times should be Central US.

# Required Information
If you don't know what these are, then you need to ask for them.
- invitees
- start date and time (Central Time)
- end date and time
- meeting subject / title
- meeting body / agenda
- is it an all-day event? (assume no)

# Meeting Agenda
- sections I like to have are: Background, Goals, Agenda

# Meeting Invitees
- invitees are passed in a specific format to the MCP (array of objects)
- example:
[
    {
      "emailAddress": {
        "address": "alice@contoso.com",
        "name": "Alice Smith"
      },
      "type": "required"
    },
    {
      "emailAddress": {
        "address": "bob@contoso.com",
        "name": "Bob Jones"
      },
      "type": "optional"
    }
]

# Sending Invites
- the invite body / meeting description needs to be formatted as HTML
  - the tone should be professional and concise, unless instructed otherwise; if you aren't sure of the tone, ask the user, do not guess.
- where possible, I like three sections on an invite:
  - Background - general context of the meeting, high level description of why, or how we got to this point
  - Goals - what should we get out of the meetings, e.g. outcomes, deliverables, concrete steps
  - Agenda - meeting flow
- invitees must be recognized by Outlook before the meeting will go out, so if anyone has a non-Digikey email address in the list it might fail
