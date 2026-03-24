---
name: check-work-availability
description: Check ep to 20 people's availability at the office on Outlook
allowed-tools: phils-outlook
---

# Get Availability Skill

## When to Use

Use this skill when the user asks about someone's calendar availability, free/busy status, or wants to know when one or more people are free for a meeting. Trigger phrases include:

- "When is [person] free?"
- "Check availability for..."
- "Find a time that works for..."
- "Is [person] available on...?"
- "What does [person]'s schedule look like on...?"

## Tool

**MCP Name:** phils-outlook
**Tool:** check-availability

## Parameters

| Parameter    | Type       | Required | Description                                                                 |
|------------- |----------- |--------- |-----------------------------------------------------------------------------|
| `emails`     | `string[]` | Yes      | List of email addresses to check. Maximum 20 per call.                      |
| `startTime`  | `object`   | Yes      | Start of the window to check. Must include `dateTime` and `timeZone`.       |
| `endTime`    | `object`   | Yes      | End of the window to check. Must include `dateTime` and `timeZone`.         |
| `interval`   | `integer`  | No       | Slot duration in minutes. Min 5, max 1440. Defaults to 30.                  |

### Time object format

Both `startTime` and `endTime` must be objects with two fields — never pass a bare ISO string:

```json
{
  "dateTime": "2026-03-25T09:00:00",
  "timeZone": "Central Standard Time"
}
```

Use the Windows time zone name (e.g. `"Central Standard Time"`, `"Eastern Standard Time"`, `"UTC"`), not IANA (not `"America/Chicago"`).

## Reading the Response

Each email in the request returns a schedule entry with two key fields:

### `availabilityView`

A string where each character is one time slot (length = window duration ÷ interval). Characters mean:

| Code | Status            |
|------|-------------------|
| `0`  | Free              |
| `1`  | Tentative         |
| `2`  | Busy              |
| `3`  | Out of office     |
| `4`  | Working elsewhere |

To map positions to times: slot `N` starts at `startTime + (N × interval)` minutes.

### `scheduleItems`

An array of busy blocks with `start`, `end`, and `status`. These do **not** include event titles or details (privacy). Use these when you need exact times rather than decoding the view string.

## Example

### User says

> "Is alice@contoso.com free tomorrow afternoon?"

### Tool call

```json
{
  "emails": ["alice@contoso.com"],
  "startTime": {
    "dateTime": "2026-03-26T12:00:00",
    "timeZone": "Central Standard Time"
  },
  "endTime": {
    "dateTime": "2026-03-26T17:00:00",
    "timeZone": "Central Standard Time"
  },
  "interval": 30
}
```

### Tool response (abbreviated)

```json
{
  "value": [
    {
      "scheduleId": "alice@contoso.com",
      "availabilityView": "0000220000",
      "scheduleItems": [
        {
          "status": "busy",
          "start": { "dateTime": "2026-03-26T14:00:00", "timeZone": "Central Standard Time" },
          "end": { "dateTime": "2026-03-26T15:00:00", "timeZone": "Central Standard Time" }
        }
      ]
    }
  ]
}
```

### How to interpret

The view string `"0000220000"` is 10 slots × 30 min = 5 hours (12:00–17:00):

- Slots 0–3 (12:00–14:00): free
- Slots 4–5 (14:00–15:00): busy
- Slots 6–9 (15:00–17:00): free

**Respond to the user in plain language:**
"Alice is busy from 2:00–3:00 PM, but free from 12:00–2:00 PM and 3:00–5:00 PM."

## Gotchas

- **Max 20 emails per call.** If the user provides more, split into batches.
- **Cross-tenant lookups usually fail.** If an email is outside the org and returns an error, tell the user that external availability isn't accessible.
- **Errors come per-schedule, not per-request.** An invalid or inaccessible email won't fail the whole call — that person's entry will contain an `error` object instead of availability data. Always check each entry.
- **Default interval is 30 minutes.** Only change it if the user asks for finer or coarser granularity.
- **Time zone matters.** If the user doesn't specify, ask. Don't assume UTC — the slots will map to the wrong clock times.
- **All-day availability checks** should span the user's working hours, not midnight to midnight, unless explicitly asked.
