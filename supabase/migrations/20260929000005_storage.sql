-- Private bucket for barcode images. Objects live at '<household_id>/<uuid>.png'
-- and are only reachable by members of that household, via signed URLs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('card-images', 'card-images', false, 5242880,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- First path segment as a uuid, or null if it isn't one (never raises).
create function public.storage_household_id(object_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case
    when split_part(object_name, '/', 1)
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(object_name, '/', 1)::uuid
  end;
$$;
revoke execute on function public.storage_household_id(text) from public, anon;
grant execute on function public.storage_household_id(text) to authenticated;

create policy card_images_select on storage.objects
  for select to authenticated
  using (bucket_id = 'card-images'
         and public.is_household_member(public.storage_household_id(name)));
create policy card_images_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'card-images'
              and public.is_household_member(public.storage_household_id(name)));
create policy card_images_update on storage.objects
  for update to authenticated
  using (bucket_id = 'card-images'
         and public.is_household_member(public.storage_household_id(name)))
  with check (bucket_id = 'card-images'
              and public.is_household_member(public.storage_household_id(name)));
create policy card_images_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'card-images'
         and public.is_household_member(public.storage_household_id(name)));
