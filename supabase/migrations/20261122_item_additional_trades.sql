-- Additional trades on a maintenance item.
-- e.g. "screws popping in walls": main trade General Building (refix), then an
-- additional Painting trade (plaster/paint). Each additional trade has its own
-- contractor and its own status, and the item shows in that contractor's portal.
-- The item's own trade/contractor/status stay as the main (first) trade.

create table if not exists public.maintenance_item_trades (
  id uuid primary key default gen_random_uuid(),
  maintenance_item_id uuid not null references public.maintenance_items(id) on delete cascade,
  trade_id uuid not null references public.trades(id) on delete cascade,
  contractor_id uuid references public.contractors(id) on delete set null,
  -- Same values as maintenance_items.status
  status text not null default 'logged'
    check (status in ('logged', 'assigned', 'in_progress', 'contractor_complete', 'complete')),
  scheduled_date date,
  completed_at timestamptz,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (maintenance_item_id, trade_id)
);

create index if not exists maintenance_item_trades_item_idx on public.maintenance_item_trades (maintenance_item_id);
create index if not exists maintenance_item_trades_contractor_idx on public.maintenance_item_trades (contractor_id);

alter table public.maintenance_item_trades enable row level security;
drop policy if exists admin_all_maintenance_item_trades on public.maintenance_item_trades;
create policy admin_all_maintenance_item_trades on public.maintenance_item_trades
  for all to authenticated using (true) with check (true);

-- Keep updated_at / completed_at in step with status
create or replace function public.item_trade_before_update()
returns trigger language plpgsql as $function$
begin
  new.updated_at := now();
  if new.status = 'complete' and old.status is distinct from 'complete' then
    new.completed_at := now();
  elsif new.status <> 'complete' then
    new.completed_at := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_item_trades_before_update on public.maintenance_item_trades;
create trigger trg_item_trades_before_update before update on public.maintenance_item_trades
  for each row execute function public.item_trade_before_update();

-- Log additional-trade changes in the item's activity feed
create or replace function public.log_item_trade_change()
returns trigger language plpgsql as $function$
declare
  v_by text := coalesce(nullif(current_setting('app.performed_by', true), ''), 'system');
  v_trade text;
begin
  v_trade := (select name from trades where id = case when tg_op = 'DELETE' then old.trade_id else new.trade_id end);
  if tg_op = 'INSERT' then
    insert into activity_log (maintenance_item_id, action, details, performed_by)
    values (new.maintenance_item_id, 'trade_added', jsonb_build_object('trade', v_trade,
      'contractor', (select company_name from contractors where id = new.contractor_id)), v_by);
  elsif tg_op = 'DELETE' then
    insert into activity_log (maintenance_item_id, action, details, performed_by)
    select old.maintenance_item_id, 'trade_removed', jsonb_build_object('trade', v_trade), v_by
    where exists (select 1 from maintenance_items where id = old.maintenance_item_id);
  else
    if old.status is distinct from new.status then
      insert into activity_log (maintenance_item_id, action, details, performed_by)
      values (new.maintenance_item_id, 'trade_status_changed',
              jsonb_build_object('trade', v_trade, 'from', old.status, 'to', new.status), v_by);
    end if;
    if old.contractor_id is distinct from new.contractor_id and new.contractor_id is not null then
      insert into activity_log (maintenance_item_id, action, details, performed_by)
      values (new.maintenance_item_id, 'trade_contractor_assigned',
              jsonb_build_object('trade', v_trade, 'contractor', (select company_name from contractors where id = new.contractor_id)), v_by);
    end if;
  end if;
  return null;
end;
$function$;

drop trigger if exists trg_item_trades_log on public.maintenance_item_trades;
create trigger trg_item_trades_log after insert or update or delete on public.maintenance_item_trades
  for each row execute function public.log_item_trade_change();

-- Is this contractor on this item (main contractor or an additional trade)?
create or replace function public.contractor_on_item(p_item_id uuid, p_contractor_id uuid)
returns boolean language sql stable security definer set search_path = public as $function$
  select exists (select 1 from maintenance_items where id = p_item_id and contractor_id = p_contractor_id)
      or exists (select 1 from maintenance_item_trades where maintenance_item_id = p_item_id and contractor_id = p_contractor_id);
$function$;

-- Contractor portal: one row per job the contractor has to do. For an
-- additional trade the row's status/trade/scheduled_date are that trade's,
-- and item_trade_id is set so status updates go to the right place.
-- waiting_on lists earlier trades on the same item that aren't finished yet.
create or replace function public.get_portal_items(p_token text)
 returns json
 language plpgsql
 security definer
as $function$
declare
  v_contractor_id uuid;
  result json;
begin
  select id into v_contractor_id from contractors where portal_token = p_token limit 1;
  if v_contractor_id is null then return '[]'::json; end if;
  select json_agg(row_to_json(t)) into result from (
    with jobs as (
      select mi.id as item_id, null::uuid as item_trade_id, mi.status, mi.trade_id, mi.scheduled_date, -1 as sort_order
      from maintenance_items mi
      where mi.contractor_id = v_contractor_id and mi.status <> 'complete' and mi.archived_at is null
      union all
      select mit.maintenance_item_id, mit.id, mit.status, mit.trade_id, mit.scheduled_date, mit.sort_order
      from maintenance_item_trades mit
      join maintenance_items mi on mi.id = mit.maintenance_item_id
      where mit.contractor_id = v_contractor_id and mit.status <> 'complete'
        and mi.status <> 'complete' and mi.archived_at is null
    )
    select
      mi.id, j.item_trade_id, mi.item_number, mi.title, mi.description, j.status, j.scheduled_date,
      mi.created_at, mi.updated_at, mi.contractor_notified_at,
      json_build_object(
        'id', u.id, 'unit_identifier', u.unit_identifier, 'address', u.address,
        'owners', coalesce((
          select json_agg(json_build_object('name', uo.name, 'email', uo.email, 'phone', uo.phone) order by uo.created_at)
          from unit_owners uo where uo.unit_id = u.id
        ), '[]'::json),
        'project', json_build_object('id', p.id, 'name', p.name, 'development_company', p.development_company)
      ) as unit,
      case when tr.id is not null then json_build_object('id', tr.id, 'name', tr.name) else null end as trade,
      -- All trades on the item, in order, so every contractor sees the full job
      (
        select json_agg(x order by x.ord) from (
          select -1 as ord, mtr.name as trade, mc.company_name as contractor, mi.status as status
          from trades mtr left join contractors mc on mc.id = mi.contractor_id
          where mtr.id = mi.trade_id
          union all
          select a.sort_order, atr.name, ac.company_name, a.status
          from maintenance_item_trades a
          join trades atr on atr.id = a.trade_id
          left join contractors ac on ac.id = a.contractor_id
          where a.maintenance_item_id = mi.id
        ) x
      ) as all_trades,
      case when j.item_trade_id is not null then (
        select json_agg(x.name order by x.ord) from (
          select -1 as ord, mtr.name from trades mtr
          where mtr.id = mi.trade_id and mi.status not in ('contractor_complete', 'complete')
          union all
          select a.sort_order, atr.name from maintenance_item_trades a join trades atr on atr.id = a.trade_id
          where a.maintenance_item_id = mi.id and a.sort_order < j.sort_order
            and a.status not in ('contractor_complete', 'complete')
        ) x
      ) end as waiting_on,
      case when wo.id is not null then json_build_object('id', wo.id, 'work_order_number', wo.work_order_number, 'status', wo.status) else null end as work_order,
      coalesce((select json_agg(json_build_object('id', cc.id, 'author', cc.author, 'content', cc.content, 'created_at', cc.created_at) order by cc.created_at) from contractor_comments cc where cc.maintenance_item_id = mi.id), '[]'::json) as comments,
      coalesce((select json_agg(json_build_object(
          'id', att.id, 'file_url', att.file_url, 'file_name', att.file_name, 'file_type', att.file_type,
          'photo_type', att.photo_type, 'uploaded_by', att.uploaded_by, 'created_at', att.created_at
        ) order by att.created_at) from maintenance_item_attachments att where att.maintenance_item_id = mi.id), '[]'::json) as attachments
    from jobs j
    join maintenance_items mi on mi.id = j.item_id
    join units u on u.id = mi.unit_id
    join projects p on p.id = u.project_id
    left join trades tr on tr.id = j.trade_id
    left join work_orders wo on wo.id = mi.work_order_id
    order by p.name, u.unit_identifier, mi.created_at desc
  ) t;
  return coalesce(result, '[]'::json);
end;
$function$;

-- Portal status updates: main contractor updates the item; an additional-trade
-- contractor updates their trade row (p_item_trade_id).
drop function if exists public.portal_update_status(text, uuid, text);
create or replace function public.portal_update_status(p_token text, p_item_id uuid, p_status text, p_item_trade_id uuid default null)
 returns json
 language plpgsql
 security definer
as $function$
declare
  v_contractor_id uuid;
begin
  select id into v_contractor_id from contractors where portal_token = p_token limit 1;
  if v_contractor_id is null then return json_build_object('error', 'Invalid token'); end if;
  if p_status not in ('in_progress', 'contractor_complete') then return json_build_object('error', 'Invalid status'); end if;

  if p_item_trade_id is not null then
    update maintenance_item_trades set status = p_status
    where id = p_item_trade_id and maintenance_item_id = p_item_id and contractor_id = v_contractor_id;
  else
    update maintenance_items set status = p_status
    where id = p_item_id and contractor_id = v_contractor_id;
  end if;

  return json_build_object('success', true);
end;
$function$;

-- Portal comments: any contractor on the item may comment
create or replace function public.portal_add_comment(p_token text, p_item_id uuid, p_author text, p_content text)
 returns json
 language plpgsql
 security definer
as $function$
declare
  v_contractor_id uuid;
  v_comment json;
begin
  select id into v_contractor_id from contractors where portal_token = p_token limit 1;
  if v_contractor_id is null then return json_build_object('error', 'Invalid token'); end if;
  if not contractor_on_item(p_item_id, v_contractor_id) then
    return json_build_object('error', 'Unauthorized');
  end if;
  insert into contractor_comments (maintenance_item_id, author, content)
  values (p_item_id, p_author, p_content)
  returning row_to_json(contractor_comments.*) into v_comment;
  return v_comment;
end;
$function$;
