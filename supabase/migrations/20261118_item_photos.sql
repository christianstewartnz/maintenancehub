-- Before / after photos on maintenance items.
-- Photos live in the private `maintenance-attachments` bucket at
-- `<maintenance_item_id>/<uuid>.<ext>`; maintenance_item_attachments.file_url holds that
-- storage path (not a public URL). Pages show them through short-lived signed URLs.
--  * Admin "before" photos: uploaded from the item page (authenticated user).
--  * Contractor "after" photos: uploaded from the portal via /api/portal/[token]/upload-photo,
--    which checks the token owns the item and writes with the service role.

alter table public.maintenance_item_attachments
  add column if not exists photo_type text
    check (photo_type in ('before', 'after'));

create index if not exists maintenance_item_attachments_item_idx
  on public.maintenance_item_attachments (maintenance_item_id, created_at);

-- The bucket is private; anon used to be able to read (and list) every object in it.
-- Portal pages now get signed URLs from the server, so anon needs no direct access.
drop policy if exists portal_storage_read on storage.objects;

-- Portal items: include photo type / uploader / time so the portal can show before & after.
create or replace function public.get_portal_items(p_token text)
returns json
language plpgsql
security definer
as $function$
DECLARE
  v_contractor_id uuid;
  result json;
BEGIN
  SELECT id INTO v_contractor_id FROM contractors WHERE portal_token = p_token LIMIT 1;
  IF v_contractor_id IS NULL THEN RETURN '[]'::json; END IF;
  SELECT json_agg(row_to_json(t)) INTO result FROM (
    SELECT
      mi.id, mi.item_number, mi.title, mi.description, mi.status,
      mi.created_at, mi.updated_at,
      json_build_object(
        'id', u.id, 'unit_identifier', u.unit_identifier, 'address', u.address,
        'owners', COALESCE((
          SELECT json_agg(json_build_object('name', uo.name, 'email', uo.email, 'phone', uo.phone) ORDER BY uo.created_at)
          FROM unit_owners uo WHERE uo.unit_id = u.id
        ), '[]'::json),
        'project', json_build_object('id', p.id, 'name', p.name, 'development_company', p.development_company)
      ) AS unit,
      CASE WHEN tr.id IS NOT NULL THEN json_build_object('id', tr.id, 'name', tr.name) ELSE NULL END AS trade,
      CASE WHEN wo.id IS NOT NULL THEN json_build_object('id', wo.id, 'work_order_number', wo.work_order_number, 'status', wo.status) ELSE NULL END AS work_order,
      COALESCE((SELECT json_agg(json_build_object('id', cc.id, 'author', cc.author, 'content', cc.content, 'created_at', cc.created_at) ORDER BY cc.created_at) FROM contractor_comments cc WHERE cc.maintenance_item_id = mi.id), '[]'::json) AS comments,
      COALESCE((SELECT json_agg(json_build_object(
          'id', att.id, 'file_url', att.file_url, 'file_name', att.file_name, 'file_type', att.file_type,
          'photo_type', att.photo_type, 'uploaded_by', att.uploaded_by, 'created_at', att.created_at
        ) ORDER BY att.created_at) FROM maintenance_item_attachments att WHERE att.maintenance_item_id = mi.id), '[]'::json) AS attachments
    FROM maintenance_items mi
    JOIN units u ON u.id = mi.unit_id
    JOIN projects p ON p.id = u.project_id
    LEFT JOIN trades tr ON tr.id = mi.trade_id
    LEFT JOIN work_orders wo ON wo.id = mi.work_order_id
    WHERE mi.contractor_id = v_contractor_id AND mi.status <> 'complete'
    ORDER BY p.name, u.unit_identifier, mi.created_at DESC
  ) t;
  RETURN COALESCE(result, '[]'::json);
END;
$function$;
