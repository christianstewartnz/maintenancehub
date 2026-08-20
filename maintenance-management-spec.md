# Maintenance Hub — Technical Specification

## 1. Overview

**Maintenance Hub** is a web-based maintenance management platform for a property developer/manager coordinating maintenance jobs across multiple projects (property developments), each containing dozens of units. The tool is used daily by a single primary user to log maintenance items, assign trades, create and send work orders to contractors, and track job completion.

Key differentiators from generic tools:
- **AI-first automation**: Claude MCP integration for querying and actioning data via natural language; AI-powered parsing of emails/documents to auto-create maintenance items
- **Contractor portal**: Contractors access a live filtered view of their assigned jobs via a unique shareable link (no login required)
- **Work order workflow**: Group maintenance items into formal work orders, auto-generate PDFs, and email them to contractors

---

## 2. Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Database | Supabase (Postgres) | User already has Supabase connected |
| Frontend | Next.js (React) | Server-side rendering, API routes |
| Auth | Supabase Auth | Single admin user for now |
| Email | Resend (via Supabase Edge Functions) | For work order delivery, notifications, reports |
| File Storage | Supabase Storage | Photos/videos attached to maintenance items |
| PDF Generation | @react-pdf/renderer or puppeteer | Work order PDFs |
| Deployment | Vercel | Accessible from any device (phone/laptop) |
| MCP Server | Custom Node.js MCP server | Connects to Supabase, exposes tools for Claude |

---

## 3. Design Direction — Notion-style

The UI should look and feel like Notion: clean, minimal, and content-focused. This is the primary design reference for the entire application.

### 3.1 Layout
- **Persistent left sidebar**: collapsible, contains navigation links (Dashboard, Projects, Maintenance, Contractors, Work Orders, Settings). Each nav item has a simple icon. The sidebar should feel like Notion's — slim, muted background, hover highlights.
- **Main content area**: wide, generous whitespace, no visual clutter. Content sits in a centered container with comfortable margins.
- **Breadcrumb navigation**: at the top of the content area showing the path (e.g., Projects → Richmond Villas → Unit A1).
- **Page headers**: large, clean headings with optional emoji/icon prefix (like Notion page titles). Subtle description text below.

### 3.2 Colour & Typography
- **Palette**: predominantly white/light gray backgrounds. Text in dark gray (#37352F or similar Notion tone), not pure black. Subtle border lines (#E9E9E7). Accent colour used sparingly for interactive elements and status badges.
- **Typography**: Inter or similar clean sans-serif. Large page titles (24–30px), comfortable body text (14–15px), small labels/metadata in muted gray.
- **Status badges**: soft coloured pills — use muted/pastel tones (not harsh primary colours). E.g., logged = light gray, assigned = light blue, in progress = light amber, contractor complete = light orange, confirmed = light green, complete = green.
- **Priority indicators**: subtle left-border colour or small dot — urgent = red, high = orange, medium = yellow, low = gray.
- **SLA/age highlighting**: items approaching SLA threshold get a subtle amber background tint; overdue items get a subtle red tint. Not aggressive — more like Notion's highlight colours.

### 3.3 Components & Interactions
- **Database-style views**: the maintenance items page should support toggling between a **table view** (default — like a Notion database table with sortable columns and filters) and a **board/kanban view** (cards grouped by status columns, draggable). The toggle sits in the page header like Notion's view switcher.
- **Inline editing**: where practical, fields should be editable inline (click a status badge to change it, click a contractor cell to reassign). Avoid navigating away for simple changes.
- **Modals for creation/detail**: creating items, work orders, and viewing item details should open in a clean modal/slide-over panel (like Notion's page peek), not a full new page. The modal should feel spacious, not cramped.
- **Filters bar**: a horizontal filter bar above tables/lists (like Notion's filter/sort controls). Dropdown selectors for project, status, trade, contractor, date range. Active filters shown as removable chips.
- **Empty states**: friendly, minimal empty states with a clear CTA when a section has no data yet (e.g., "No maintenance items yet — create your first one").
- **Hover & transitions**: subtle hover highlights on rows/cards, smooth transitions on modals and sidebar collapse. Nothing flashy — Notion-level restraint.

### 3.4 Contractor Portal Design
The portal should feel like a simplified, read-only version of the main app — same typography, same colour palette, same card/list styling, but stripped back to just what the contractor needs. No sidebar; use a simple top header with the contractor's company name and filter controls. The portal should feel professional enough that contractors take it seriously.

### 3.5 Responsive/Mobile
The app must be usable on mobile (phone browser) as the admin will use it on-site. Sidebar collapses to a hamburger menu, tables switch to card-based layouts on narrow screens, modals go full-screen on mobile.

---

## 4. Data Model

### 4.1 Projects
A project represents a property development (e.g., "Richmond Villas", "172 Thorndon Quay").

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| name | text | e.g., "Richmond Villas" |
| address | text | General project address |
| description | text | Optional notes |
| status | enum | active, archived |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### 4.2 Units
A unit sits within a project. Each unit has three identifiers because different parties reference them differently.

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| project_id | uuid | FK → projects |
| unit_identifier | text | e.g., "A1" — the internal/building identifier |
| lot_number | text | e.g., "Lot 1" — legal/title reference |
| address | text | e.g., "12 Main Street, Te Aro, Wellington" |
| owner_name | text | |
| owner_email | text | |
| owner_phone | text | |
| access_contact_name | text | Property manager, tenant, or other contact for site access |
| access_contact_email | text | |
| access_contact_phone | text | |
| notes | text | Any unit-specific notes |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### 4.3 Contractors
Contractors are **universal** — created once with their contact details and reusable across all projects. They are then assigned to specific trades on a per-project basis.

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| company_name | text | |
| contact_name | text | Primary contact person |
| email | text | |
| phone | text | |
| portal_token | text | Unique unguessable token for contractor portal URL |
| notes | text | Reliability notes, rates, etc. |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### 4.4 Trades
Trade categories available within a project. Each project starts with a base set and can be customised.

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| project_id | uuid | FK → projects |
| name | text | e.g., "Plumbing", "Electrical" |
| created_at | timestamptz | |

**Default base trades** (auto-created when a new project is created):
Plumbing, Electrical, Painting, Carpentry/Joinery, Locksmith, Glazing, Roofing, General Building, Cleaning, Landscaping/Grounds, Appliance Repair, HVAC, Fire Safety

### 4.5 Project Trade Assignments
Links a contractor to a specific trade within a specific project.

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| project_id | uuid | FK → projects |
| trade_id | uuid | FK → trades |
| contractor_id | uuid | FK → contractors |
| created_at | timestamptz | |

UNIQUE constraint on (project_id, trade_id, contractor_id).

### 4.6 Maintenance Items
The core entity — a single maintenance job logged against a specific unit.

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| item_number | serial/text | Human-readable reference, e.g., "MI-0042" |
| unit_id | uuid | FK → units |
| trade_id | uuid | FK → trades (the trade category this item falls under) |
| title | text | Short description, e.g., "Leaking kitchen tap" |
| description | text | Detailed description |
| status | enum | logged, assigned, in_progress, contractor_complete, confirmed, complete |
| priority | enum | low, medium, high, urgent |
| contractor_id | uuid | FK → contractors (nullable — set when assigned) |
| work_order_id | uuid | FK → work_orders (nullable — not all items go on a work order) |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| completed_at | timestamptz | When status moved to complete |

**Status lifecycle:**
```
logged → assigned → in_progress → contractor_complete → confirmed → complete
```

- **logged**: Item created, trade category set, no contractor yet
- **assigned**: Contractor assigned to the item (via trade assignment or manual)
- **in_progress**: Work has started (contractor or admin sets this)
- **contractor_complete**: Contractor marks as done via portal — triggers notification to admin
- **confirmed**: Admin reviews and confirms the work is satisfactory
- **complete**: Final closed state

### 4.7 Maintenance Item Attachments
Photos and videos attached to maintenance items.

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| maintenance_item_id | uuid | FK → maintenance_items |
| file_url | text | Supabase Storage URL |
| file_type | text | image/jpeg, video/mp4, etc. |
| file_name | text | Original filename |
| uploaded_by | text | "admin" or system reference |
| created_at | timestamptz | |

### 4.8 Work Orders
Groups multiple maintenance items for a single contractor within a single project.

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| work_order_number | serial/text | e.g., "WO-0015" |
| project_id | uuid | FK → projects |
| contractor_id | uuid | FK → contractors |
| status | enum | draft, sent, in_progress, complete |
| sent_at | timestamptz | When emailed to contractor |
| notes | text | Any instructions for the contractor |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Constraint**: All maintenance items on a work order must belong to units within the same project. A work order is scoped to one project and one contractor.

### 4.9 Activity Log
Timestamped audit trail on every maintenance item.

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| maintenance_item_id | uuid | FK → maintenance_items |
| action | text | e.g., "status_changed", "contractor_assigned", "comment_added", "work_order_added" |
| details | jsonb | e.g., { "from": "logged", "to": "assigned", "contractor": "ABC Plumbing" } |
| performed_by | text | "admin", contractor name, or "system" |
| created_at | timestamptz | |

### 4.10 Contractor Comments
Comments added by contractors via the portal, or by admin.

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| maintenance_item_id | uuid | FK → maintenance_items |
| author | text | Contractor name or "admin" |
| content | text | |
| created_at | timestamptz | |

### 4.11 Notification Preferences (Settings)

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| user_id | uuid | FK → auth user |
| contractor_complete_email | boolean | Notify when a contractor marks complete |
| contractor_comment_email | boolean | Notify when a contractor adds a comment |
| report_frequency | enum | daily, weekly, none |
| report_scope | enum | all_projects, per_project |
| report_projects | uuid[] | If per_project, which projects |
| created_at | timestamptz | |
| updated_at | timestamptz | |

---

## 5. Pages & UI

### 5.1 Dashboard (`/`)
The daily landing page — a high-level overview of open maintenance across all projects.

**Layout:**
- Projects listed as cards or collapsible sections
- Each project shows a count of open maintenance items, grouped or filterable by status
- Clicking a project expands to show units with open items
- Each unit row shows the unit identifier + count of open items
- Clicking a unit shows the list of maintenance items with status badges, priority colour, and age indicator
- **Age/SLA colour coding**: items turn amber after 7 days without status change, red after 14 days (configurable in settings)
- Quick-action buttons on each item (assign, change status, view details)

### 5.2 Projects Page (`/projects`)
List of all projects with ability to create and manage.

**Project list view:**
- Card or table of all projects with unit count, open item count
- Create Project button

**Single project view (`/projects/[id]`):**
Three tabs:

**Tab 1 — Units:**
- Table of all units in the project (unit identifier, lot number, address, owner name, open items count)
- Create Unit button → modal with all unit fields
- Bulk Import button → CSV upload (template downloadable)
- Click a unit → view/edit unit details including owner and access contact info

**Tab 2 — Trades:**
- List of trade categories for this project (starts with base list)
- Add/remove trade categories
- Each trade shows the assigned contractor(s)
- Assign Contractor button per trade → search/select from universal contractor list

**Tab 3 — Work Orders:**
- List of work orders for this project
- Create Work Order button (see §4.5)

### 5.3 Maintenance Items Page (`/maintenance`)
Full list of all maintenance items across all projects.

**Features:**
- Table/list view with columns: item number, title, project, unit, trade, contractor, status, priority, age, work order
- **Filters**: project, unit, status, trade, contractor, work order, date range, priority
- **Sort**: by date created, priority, age, status
- **Search**: free text search across title and description
- **Create Maintenance button** → opens creation modal (see §4.4)
- Click any item → detail view with full description, attachments, activity log, comments

### 5.4 Create Maintenance Modal
Two modes:

**Manual mode:**
- Select project (dropdown)
- Select unit (dropdown, filtered by selected project)
- Select trade category (dropdown, filtered by project's trades)
- Title (text)
- Description (text area)
- Priority (low/medium/high/urgent)
- Attach photos/videos (file upload to Supabase Storage)
- **"Add another item" button** — allows adding multiple items in one session without closing the modal. Each line item has its own unit, trade, title, description, priority, and attachments. On save, all items are created as separate maintenance items.

**AI-assisted mode:**
- Drag-and-drop zone for email files (.eml, .msg) or Word documents (.docx), or a text area for pasting raw text (e.g., an email body)
- On submission, AI (Claude API call) parses the content and extracts individual maintenance items, suggesting: title, description, which unit (matched against project units by address/unit ID/lot number), trade category, and priority
- User reviews the parsed results in a preview table, can edit/correct before confirming
- Confirm button creates all items

### 5.5 Create Work Order Flow
Triggered from Projects → Work Orders tab, or from a dedicated Work Orders section.

1. Select project (dropdown)
2. Select contractor (dropdown — filtered to contractors assigned to trades on this project)
3. System shows all open maintenance items assigned to that contractor within that project
4. User selects which items to include on this work order
5. Add notes/instructions (optional text area)
6. Preview the work order (shows unit addresses, owner contact details, item descriptions)
7. **Save as draft** or **Send**
8. Send = emails the contractor with:
   - Email body: summary of units and addresses, owner/access contact details, link to their contractor portal
   - PDF attachment: formal work order document with full item list, descriptions, and any attached photos

### 5.6 Contractors Page (`/contractors`)
Universal contractor management.

- Table of all contractors (company name, contact name, email, phone, assigned projects/trades)
- Create Contractor button → modal with contact fields
- Click contractor → detail view with: contact info, list of all project/trade assignments, all maintenance items assigned to them across all projects, portal link (with copy button)

### 5.7 Contractor Portal (`/portal/[token]`)
Public page accessible via unique token URL — no login required.

**Features:**
- Contractor sees their company name at the top
- List of all active maintenance items assigned to them
- **Filters**: project, unit, work order, status
- Each item shows: project name, unit identifier, unit address, title, description, priority, status, attached photos/videos (view only), comments thread
- **Actions per item:**
  - Add a comment (text)
  - Mark as "In Progress" (changes status from assigned → in_progress)
  - Mark as "Complete" (changes status to contractor_complete → triggers notification to admin)
- Contractor **cannot** upload photos or files
- Contractor **cannot** see cost/financial information (future-proofing for when cost tracking is added)

### 5.8 Settings Page (`/settings`)

- **Notification preferences**: toggle email notifications for contractor completions and comments
- **Report settings**: frequency (daily/weekly/none), scope (all projects or select specific projects), delivery email
- **SLA thresholds**: configure the number of days before items turn amber/red on dashboard
- **Default trade list**: edit the base trade categories that auto-populate on new projects
- **Account/profile**: name, email

---

## 6. Automation & AI Features

### 6.1 Claude MCP Server
A custom MCP server that connects to the Supabase database and exposes tools for use within Claude chat.

**Read tools (queries):**
- `get_dashboard_summary` — open items by project, overdue count, items awaiting confirmation
- `get_maintenance_items` — filtered by project, unit, status, contractor, trade, date range
- `get_project_details` — project info, unit list, trade assignments
- `get_contractor_items` — all items assigned to a specific contractor
- `get_work_order_details` — items on a specific work order
- `get_overdue_items` — items exceeding SLA thresholds
- `search_items` — free text search across maintenance items

**Write tools (actions):**
- `create_maintenance_item` — log a new item against a unit
- `assign_contractor` — assign a contractor to a maintenance item
- `update_item_status` — change status (with audit log entry)
- `create_work_order` — create and optionally send a work order
- `create_unit` — add a unit to a project (supports bulk from parsed spreadsheet data)
- `create_project` — create a new project with default trades
- `add_comment` — add a comment to a maintenance item
- `confirm_completion` — confirm a contractor-completed item

This allows workflows like:
- *"What's overdue at Thorndon Quay?"* → calls get_overdue_items with project filter
- *"Assign all plumbing items at Richmond Villas to ABC Plumbing"* → calls assign_contractor
- *"Create a work order for the painter at Avalon Studios and send it"* → calls create_work_order
- *"Mark item MI-0042 as confirmed"* → calls update_item_status

### 6.2 AI Maintenance Parsing
When the user drops an email or document into the AI-assisted creation modal:

1. File/text is sent to Claude API with a system prompt instructing it to extract maintenance items
2. Claude returns structured JSON: an array of items with title, description, suggested unit (matched against the project's unit list), suggested trade, and priority
3. Results are displayed in an editable preview table
4. User confirms, edits, or removes items before saving

The matching logic should attempt to identify units by any of the three identifiers (unit ID, lot number, address) from the text.

### 6.3 Bulk Unit CSV Import
Downloadable CSV template with columns:
```
unit_identifier, lot_number, address, owner_name, owner_email, owner_phone, access_contact_name, access_contact_email, access_contact_phone, notes
```

Upload parses and creates all units in one batch. Validation: required fields (unit_identifier, lot_number, address), duplicate checking against existing units in the project.

---

## 7. Email System

### 7.1 Work Order Emails
Triggered when a work order is sent.

**To**: Contractor email
**Subject**: `Work Order [WO-XXXX] — [Project Name]`
**Body**:
- Summary of items (count, units involved)
- For each unit: unit identifier, address, owner/access contact name and phone
- Link to contractor portal
- Any notes/instructions from the admin

**Attachment**: PDF of the full work order (see §6.4)

### 7.2 Notification Emails
Triggered by events, subject to the user's notification preferences.

- **Contractor marked complete**: "[Contractor] marked [item title] as complete at [unit] — review and confirm"
- **Contractor added comment**: "[Contractor] commented on [item title] at [unit]"

Each email includes a direct link to the item in the admin app.

### 7.3 Report Emails
Scheduled based on settings (daily or weekly).

**Content**:
- Summary of open items by project (counts by status)
- Overdue/SLA-breaching items highlighted
- Items completed since last report
- New items logged since last report

If scoped to specific projects, only those projects are included.

### 7.4 Work Order PDF
Professional, clean PDF containing:

- Work order number, date, project name
- Contractor company and contact details
- Table of items: unit identifier, address, owner contact, item title, description, priority
- Any admin notes/instructions
- Embedded photos (thumbnails) if attached to items

---

## 8. Contractor Portal — Technical Details

- **URL structure**: `https://[domain]/portal/[unique-token]`
- **Token**: 32+ character random string generated when a contractor is created, stored in contractors.portal_token
- **No authentication**: the token IS the access — treat it like a shared secret link
- **Security considerations**: tokens are unguessable (crypto-random), HTTPS only, rate limiting on portal routes, no sensitive financial data exposed
- **Regenerate token**: admin can regenerate a contractor's portal token if compromised (invalidates old link)

---

## 9. Supabase Schema Notes

- Enable Row Level Security (RLS) on all tables
- Admin user (authenticated via Supabase Auth) has full access
- Portal routes use the contractor's portal_token to query — RLS policies should allow read access to maintenance_items, units, projects, and work_orders where the contractor_id matches the token's contractor, and write access limited to status updates (in_progress, contractor_complete) and comment creation
- Use Supabase Storage buckets for maintenance item attachments
- Use Supabase Edge Functions or a cron service for scheduled report emails
- Use database triggers or Supabase Realtime for live updates on the contractor portal

---

## 10. Future Considerations (Not in V1 but design for extensibility)

- **Cost tracking**: quotes, invoices, and actual costs per maintenance item and work order, rolling up to project-level spend reports
- **Owner communication**: automated emails to owners confirming work completion, requesting approval
- **Multi-user access**: additional admin users with role-based permissions
- **Tenant/owner portal**: similar to contractor portal but for owners to submit maintenance requests and track progress
- **Recurring/scheduled maintenance**: auto-generate maintenance items on a cadence (e.g., annual fire safety, quarterly gutter clean)
- **Integration with accounting**: export costs to Xero or similar

---

## 11. Implementation Priority

**Phase 1 — Core data & UI:**
1. Supabase schema setup (all tables, RLS policies, storage bucket)
2. Auth (single admin user)
3. Projects page (create project, manage units with CSV bulk import, manage trades, assign contractors)
4. Contractors page (CRUD)
5. Maintenance items page (manual creation with multi-line, filters, detail view)
6. Dashboard (open items by project, age/SLA colour coding)

**Phase 2 — Work orders & contractor portal:**
7. Work order creation flow (select items, preview, save as draft)
8. Work order PDF generation
9. Contractor portal (token-based, read + status update + comments)
10. Work order email sending (body + PDF attachment)
11. Activity/audit log on all maintenance items

**Phase 3 — AI & automation:**
12. AI maintenance parsing (email/document upload → extracted items)
13. Claude MCP server (read + write tools)
14. Notification emails (contractor complete, contractor comment)
15. Scheduled report emails (daily/weekly)
16. Settings page (notification prefs, SLA thresholds, default trades)

**Phase 4 — Polish:**
17. Mobile-responsive refinement (daily use from phone)
18. Performance optimisation for larger datasets
19. Portal UX refinement based on contractor feedback
