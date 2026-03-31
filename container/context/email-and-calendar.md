# About
This context is about the email and calendar services Phil uses regularly.

# My Email Addresses
Use the Email Account Tools section for a list of my email addresses and their domain.

# Email Account Tools
| Name | Platform | Use | The Name I Go By in This Account | Email Address | 
|---|---|---|---|---|
| ruzan-gmail | Gmail | Zen priest communication | Ruzan | ruzanj.mn@gmail.com | Emails and interactions in my capacity as a Zen priest |
| phil-gmail | Gmail | Personal email | Phil | philj.mn@gmail.com | Personal account used the most |
| phil-work | Outlook | Work email for DigiKey job | Phil | phil.johnson@digikey.com | used for work-related communication | 

# Account Usage
IMPORTANT: keep emails within the same account.  For example, when replying to an email in my work account (Outlook), use that account for the reply.  Do not cross accounts.  When working in the Ruzan account, in my capacity as a zen priest, again do not use other accounts to reply.

# Calendars
| Name | Platform | Use | Shared? |
| phil-work | Outlook | Work meetings, appointments | No | Heavily used for work activities
| family-calendar | Gmail | family events, appointments | Yes | under ruzan-gmail account, this is where we put events so the family knows what is happening; shared calendar in Gmail |


# Available MCP Tools

## Gmail
| Account | MCP Server | Tools |
|---------|-----------|-------|
| ruzan-gmail | `gmail-ruzan` | `mcp__gmail-ruzan__send_email`, `mcp__gmail-ruzan__draft_email`, `mcp__gmail-ruzan__read_email`, `mcp__gmail-ruzan__search_emails`, `mcp__gmail-ruzan__list_email_labels`, `mcp__gmail-ruzan__list_filters` |
| phil-gmail | not yet configured | — |

## Google Calendar
| Account | MCP Server | Tools |
|---------|-----------|-------|
| ruzan-gmail | `gcal-ruzan` | `mcp__gcal-ruzan__list-calendars`, `mcp__gcal-ruzan__list-events`, `mcp__gcal-ruzan__search-events`, `mcp__gcal-ruzan__get-event`, `mcp__gcal-ruzan__create-event`, `mcp__gcal-ruzan__update-event`, `mcp__gcal-ruzan__delete-event`, `mcp__gcal-ruzan__get-freebusy`, `mcp__gcal-ruzan__respond-to-event`, `mcp__gcal-ruzan__get-current-time` |

When using calendar tools, pass `account: ["ruzan"]` to target the ruzan account specifically.

# Notes
- phil-work resources are only available through the phils-outlook MCP server
- ruzan-gmail MCP is authenticated and available in all agent sessions
