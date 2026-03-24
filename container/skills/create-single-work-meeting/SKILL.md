---
name: create-single-work-meeting
description: use this skill to create a single-occurrence meeting in Phil's Work (Outlook) calendar.
allowed-tools: Bash(*), phils-outlook
---

# Quick Start

## Tool Use
- use the 'phils-outlook' MCP tool in 'create-single-event' mode
- dates and times should be Central US.

## Required Information
If you don't know what these are, then you need to ask for them.
- invitees
- start date and time (Central Time)
- end date and time
- meeting subject / title
- meeting body / agenda
- is it an all-day event? (assume no)

## Meeting Agenda
- sections I like to have are: Background, Goals, Agenda

## Meeting Invitees
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
