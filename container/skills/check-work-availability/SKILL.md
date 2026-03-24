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
- "I need X minutes of time with [person] tomorrow..."

## Tool

**MCP Name:** phils-outlook
**Tool:** check-availability

## Parameters

| Parameter    | Type       | Required | Description                                                                 |
|------------- |----------- |--------- |-----------------------------------------------------------------------------|
| `emails`     | `string[]` | Yes      | List of email addresses to check. Maximum 20 per call.  Do not inclued Phil (phil.johnson@digikey.com) unless specifically asked.                      |
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

An array of calendar blocks with `status`, `start`, and `end`. With sufficient read access (e.g. within the same org), event titles may also be included. Use these when you need exact times rather than decoding the view string.

**Important:** Response times are always returned in UTC with fractional-second precision (e.g. `"2026-03-24T18:00:00.0000000"`), regardless of what time zone you sent in the request. Convert to the user's local time zone before presenting results.

Schedule items can **overlap** — for example, a tentative block from 2:00–3:00 and a busy block from 2:30–2:55. Present the highest-priority status for any overlapping window: busy > OOF > tentative > working elsewhere > free.

### `workingHours`

Each schedule entry also includes a `workingHours` object with the person's configured work days, start/end times, and time zone:

```json
"workingHours": {
  "daysOfWeek": ["monday", "tuesday", "wednesday", "thursday", "friday"],
  "startTime": "08:00:00.0000000",
  "endTime": "17:00:00.0000000",
  "timeZone": {
    "name": "Central Standard Time"
  }
}
```

Use this to contextualize availability — if the user asks "when is Alice free?" and all her slots outside working hours are technically open, only suggest times within her working hours unless the user explicitly asks otherwise.

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
          "status": "tentative",
          "start": {
            "dateTime": "2026-03-26T19:00:00.0000000",
            "timeZone": "UTC"
          },
          "end": {
            "dateTime": "2026-03-26T20:00:00.0000000",
            "timeZone": "UTC"
          }
        },
        {
          "status": "busy",
          "start": {
            "dateTime": "2026-03-26T19:30:00.0000000",
            "timeZone": "UTC"
          },
          "end": {
            "dateTime": "2026-03-26T20:00:00.0000000",
            "timeZone": "UTC"
          }
        }
      ],
      "workingHours": {
        "daysOfWeek": ["monday", "tuesday", "wednesday", "thursday", "friday"],
        "startTime": "08:00:00.0000000",
        "endTime": "17:00:00.0000000",
        "timeZone": {
          "name": "Central Standard Time"
        }
      }
    }
  ]
}
```

### How to interpret

Response times are in UTC. Alice's working hours time zone is Central (UTC-5 or UTC-6 depending on DST). Convert before presenting.

The view string `"0000220000"` is 10 slots × 30 min = 5 hours (12:00–17:00 CT):

- Slots 0–3 (12:00–2:00 PM CT): free
- Slots 4–5 (2:00–3:00 PM CT): occupied (tentative with an overlapping busy block)
- Slots 6–9 (3:00–5:00 PM CT): free

**Respond to the user in plain language:**
"Alice has a tentative meeting from 2:00–3:00 PM (with a hard conflict at 2:30–3:00). She's free 12:00–2:00 PM and 3:00–5:00 PM."

## Gotchas

- **Response times are always UTC.** You send the request in whatever time zone you want, but the response `scheduleItems` always come back in UTC. Convert to the user's local time zone (use the `workingHours.timeZone.name` field as a hint) before presenting.
- **Schedule items can overlap.** Two events can cover the same time window with different statuses. When summarizing, use the highest-priority status: busy > OOF > tentative > working elsewhere > free.
- **Max 20 emails per call.** If the user provides more, split into batches.
- **Cross-tenant lookups usually fail.** If an email is outside the org and returns an error, tell the user that external availability isn't accessible.
- **Errors come per-schedule, not per-request.** An invalid or inaccessible email won't fail the whole call — that person's entry will contain an `error` object instead of availability data. Always check each entry.
- **Default interval is 30 minutes.** Only change it if the user asks for finer or coarser granularity.
- **Time zone matters.** If the user doesn't specify, ask. Don't assume UTC — the slots will map to the wrong clock times.
- **All-day availability checks** should span the user's working hours, not midnight to midnight, unless explicitly asked.
