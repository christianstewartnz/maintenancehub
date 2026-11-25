@AGENTS.md

# Maintenance Hub Data Access

When answering questions about maintenance data — projects, units, maintenance items, contractors, or work orders — always use the maintenance-hub MCP tools. Never use raw SQL or the Supabase MCP when the maintenance-hub MCP tools are available.

You can refer to projects, contractors, and items by plain name (partial matches work). You do not need UUIDs.

## Logging items from emails (daily check, dropped email folders)

A maintenance item's title and description are shown to contractors (portal and Notify emails). Keep them to the job only: what is wrong, where, and what needs doing, in 1–2 short sentences — e.g. "Divider on the stairwell has multiple stripped screws - replace the screws so the divider can be removed and refitted."

Never put owner/tenant names, phone numbers, email addresses, "Logged from…" lines, email subjects or dates, follow-up history, or the owner's backstory in the title or description. Put those in `create_maintenance_item`'s `source_note` (or `apply_email_update`), which saves them to the item's internal Email updates.
