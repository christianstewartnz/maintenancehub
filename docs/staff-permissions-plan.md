# Staff roles & project assignment — build spec

Branch: `feature/staff-permissions`. Live site deploys from `main`; **dev and live share one Supabase DB** (`xsstslamntiudfsmqhdl`), so every DB change must be safe for the code already on `main`.

## Decisions (from Christian)

1. `christian.stewart@stratum-mgt.co.nz` is the only admin. Everyone else is `staff`.
2. Staff see **nothing** of projects they aren't assigned to.
3. An item with no Responsible person falls to the project's **main contact**.
4. Staff can manage contractors and trades, for projects they're on. Archiving a contractor / changing their portal link is admin-only.
5. The contractor portal shows the item's **Responsible person** as the contact.
6. Contractors are global: one portal link each, shared by all staff.
7. Notify emails only include the **sender's own** items. The portal only shows items once they've been notified ("released"), so another person's unsent items never show early.

## Already built (foundation commit)

**DB (applied):** `supabase/migrations/20261204_staff_roles_permissions.sql`, `20261205_alerts_all_projects_pref.sql`

- `profiles.role` (`admin`|`staff`), `profiles.is_active`, `profiles.phone`. All 3 existing users are `admin` for now (so live is unchanged); they'll be switched at go-live.
- `project_staff(project_id, user_id, is_primary)` — at most one `is_primary` per project. Christian is main contact on every project.
- RLS: staff only read/write rows for their projects (projects, units, unit_owners, trades, project_trade_assignments, work_orders, project_documents, maintenance_items, activity_log, contractor_comments, maintenance_item_attachments, item_updates). Contractors/contractor_contacts readable+editable by any active user, delete admin-only. Projects insert/delete admin-only. project_staff read for your projects, write admin-only. Admins see everything.
- Guards: only admins can change `profiles.role/is_active` or `contractors.is_active/portal_token` (DB triggers raise).
- SQL helpers: `mh_is_admin()`, `mh_can_access_project(id)`, `mh_can_access_unit(id)`, `mh_can_access_item(id)`, `mh_project_contact(project_id)`, `mh_item_responsible(item_id)` (Responsible → parent job's → project main contact).
- `notification_preferences.alerts_all_projects` (admins: receive contractor alerts for every project).

**Code:**
- `lib/auth.ts` — `getSession()` (user + StaffProfile, per-request cached), `isAdmin()`, `requireUser()`, `requireAdmin()` (API guards returning a Response), `canAccessProject()`, `canAccessItem()` (RLS-checked; use before any service-role query).
- `lib/staff.ts` — `effectiveResponsible()`, `primaryContactId()`, `fetchProjectStaff()`, `primaryContactByProject()`, `projectStaffProfiles()`.
- `lib/types.ts` — `UserRole`, `StaffProfile`, `ProjectStaff`, `STAFF_PROFILE_SELECT`, `NotificationPreferences.alerts_all_projects`.
- `lib/notify-recipients.ts` — `getItemAlertRecipients(service, toggle, itemId)`.
- `app/(admin)/layout.tsx` signs out deactivated users and passes `isAdmin` to `<Sidebar isAdmin>`.

**Key rule:** the user's normal Supabase client is already scoped by RLS — most screens need no filtering. Anything using the **service-role client** (`createServiceClient`, cron routes) bypasses RLS and must check access explicitly.

## Workstreams

### A — Team & admin, settings, scheduled emails
Owns: `app/(admin)/settings/**`, `app/api/admin/**` (new), `app/auth/**`, `app/(admin)/projects/[id]/page.tsx` + a new `ProjectStaffCard.tsx` there, `app/api/maintenance-due/**`, `app/api/reports/**`, `app/api/email/**`, `proxy.ts`.

- Settings → profile card gets **phone** (used as portal contact).
- Settings → **Team** card (admin only): list users (name, email, phone, role, active, projects + which they're main contact for); invite a user (email, name, role, projects); edit name/phone/role; deactivate/reactivate; assign/unassign projects and set main contact.
- API (service client, `requireAdmin()`): invite (`auth.admin`), update role/active (deactivate also bans in auth so sessions can't refresh; reactivate unbans), name/phone. Refuse demoting or deactivating yourself / the last active admin.
- Invite acceptance: a page where the invited user sets their password. Make sure `proxy.ts` doesn't bounce them (it redirects signed-in users away from `/auth/*`). Read the Supabase invite/PKCE flow for `@supabase/ssr` and the Next 16 docs in `node_modules/next/dist/docs/`. Add **change password** in Settings if not present.
- Login page: show a clear message for `?deactivated=1`.
- Project detail: **Staff** card — admin can add/remove staff and set main contact; staff see it read-only (names, phone, email). Setting a new main contact must clear the old one first (unique index).
- Notification settings: `alerts_all_projects` toggle, admin only. Report project choices are already RLS-scoped.
- `reports/send` and `maintenance-due/send` (cron, service client): each recipient only gets projects/units they can access (admin = all; staff = their `project_staff` projects). `maintenance-due/draft/[unitId]`: check access. `api/email/*`: admin only.

### B — Notify, contractor portal, contractors pages
Owns: `app/api/contractors/**`, `components/ui/NotifyContractorModal.tsx`, `lib/contractor-notify.ts`, `lib/email-templates.ts`, `app/(admin)/contractors/**`, `components/layout/Sidebar.tsx`, `app/portal/**`, `app/api/portal/**`, new migration `supabase/migrations/20261206_portal_release.sql`.

- **Notify scoped to sender:** the pending list, email body and "mark as told" only include items whose effective responsible (`mh_item_responsible`) is the current user. Admins may opt to include others' items ("send on behalf"). The dialog shows a short line for others' pending items for that contractor that are *not* included (admin: names + counts; staff: just a count, they can't see those items). Keep `NotifyContractorModal`'s existing props working (ItemDetailClient uses it).
- Notify email: show the sender's name/phone/email as the contact.
- Sidebar "to notify" badge and contractors list pending counts: only my items. Hide admin-only nav/actions for staff where relevant.
- Contractors pages: hide Archive and portal-link regenerate for staff (DB also blocks them).
- **Portal release gate** — migration (write the file, do NOT apply; Claude reviews and applies):
  - `maintenance_items.portal_released_at timestamptz`.
  - New BEFORE INSERT/UPDATE trigger, named so it runs **after** the existing `trg_maintenance_items_reset_notified` and `trg_maintenance_items_sync_assigned` (Postgres fires same-timing triggers alphabetically, e.g. `trg_maintenance_items_zz_portal_release`): contractor changed → `portal_released_at := null`; `contractor_notified_at` set (and released null) → `portal_released_at := now()`. Do not modify existing functions/triggers. Sent-back items stay released.
  - Backfill `portal_released_at = contractor_notified_at` where notified.
  - New `get_portal_items_v2(p_token)` — same as `get_portal_items` (latest definition in `20261201_portal_access_contact.sql`) plus `and mi.portal_released_at is not null`, plus a `responsible` object `{name, email, phone}` from `mh_item_responsible`. **Leave `get_portal_items` untouched** (live uses it).
  - `portal_item_visible(p_token, p_item_id) returns boolean` (security definer) for the portal API routes.
  - Separate **cutover** file `supabase/cutover/portal_release_backfill.sql` (not a migration; run at go-live): release every item currently visible on the old portal (`contractor_id not null, archived_at null, status <> 'complete', not portal_hidden`).
- Portal page uses v2; PortalClient shows the contact per item (and per project group if they're all the same person) — "Your contact: name · phone · email", clickable tel/mailto.
- Portal API routes (`update-status`, `add-comment`, `set-scheduled-date`, `upload-photo`): refuse items not visible (`portal_item_visible`). `update-status`/`add-comment` alerts use `getItemAlertRecipients(service, toggle, itemId)`.

### C — Internal screens & defaults
Owns: `app/(admin)/maintenance/**`, `app/(admin)/sign-off/**`, `app/(admin)/dashboard/**`, `app/(admin)/projects/ProjectsClient.tsx`, `app/(admin)/projects/page.tsx`, `app/(admin)/projects/[id]/ProjectDetailClient.tsx`, `app/(admin)/projects/[id]/ProjectDocuments.tsx`, `app/(admin)/work-orders/**`, `app/api/maintenance/**`, `app/api/projects/**`, `app/api/work-orders/**`, `app/api/ai/**`, `lib/assignees.ts`, `lib/export-maintenance.ts`.

- **Responsible** dropdowns (list, bulk, detail, create modal, steps): options are the active staff on that item's project. When `assigned_to` is null show the fallback, e.g. "Christian (main contact)".
- Create item: preselect the project's main contact.
- "Mine" filter = items whose effective responsible is me (replaces "mine + unassigned"); keep an "All" option. Update `lib/assignees.ts` and the export route consistently. Saved filter values in localStorage must not break.
- Projects list: "New project" admin only; when an admin creates a project, add them as its main contact. Archive/delete admin only. Show main contact.
- Dashboard etc. must look sensible for a staff user with 0 or 1 projects ("You haven't been assigned to any projects yet").
- Service-role API routes in your area (`api/projects/*/documents`, `api/work-orders/*`, `api/maintenance/export`, `api/ai/*`): `requireUser()` + `canAccessProject/Item` before touching data.

## Rules for every workstream

- Edit only files you own. Need a change elsewhere? Say so in your report.
- No DB writes (read-only SQL for inspection is fine). Migrations are written as files; Claude reviews and applies them.
- Don't commit, don't run the dev server (Claude tests in the browser). Do run `npx tsc --noEmit` and `npx eslint <your files>`.
- Match the existing code style (inline styles, existing `btn`/`card`/`modal` classes, comments that explain why).
- Contractor-related testing uses **Test Contractor** only.

## Go-live checklist (later, after review)

1. Merge to `main`, deploy.
2. Run `supabase/cutover/portal_release_backfill.sql`.
3. Set Aidan and the gmail account to `staff`; assign Aidan's projects; set notification `alerts_all_projects=false` for non-admins.
4. Invite new staff.
