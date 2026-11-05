-- Support Center schema. Apply only after 202611020001_tenant_foundation.sql,
-- and only to the isolated staging Supabase project before production review.
create sequence if not exists public.support_ticket_number_seq;

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  client_submission_id uuid not null,
  ticket_number text not null unique,
  category text not null check (length(btrim(category)) between 1 and 80),
  subject text not null check (length(btrim(subject)) between 1 and 180),
  description text not null check (length(btrim(description)) between 1 and 10000),
  status text not null default 'Open' check (status in ('Open','In Progress','Closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (tenant_id,id),
  unique (tenant_id,created_by,client_submission_id)
);
create index support_tickets_shop_queue on public.support_tickets(tenant_id,status,created_at desc);
create index support_tickets_customer_history on public.support_tickets(tenant_id,created_by,created_at desc);

create table public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  ticket_id uuid not null,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  author_role text not null check (author_role in ('customer','admin')),
  body text not null check (length(btrim(body)) between 1 and 10000),
  created_at timestamptz not null default now(),
  foreign key (tenant_id,ticket_id) references public.support_tickets(tenant_id,id) on delete restrict
);
create index support_ticket_messages_history on public.support_ticket_messages(tenant_id,ticket_id,created_at);

create table public.support_ticket_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  ticket_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in ('submitted','status_changed','response_added','attachment_added')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object'),
  created_at timestamptz not null default now(),
  foreign key (tenant_id,ticket_id) references public.support_tickets(tenant_id,id) on delete restrict
);
create index support_ticket_events_history on public.support_ticket_events(tenant_id,ticket_id,created_at);

create table public.support_ticket_reads (
  tenant_id uuid not null,
  ticket_id uuid not null,
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  acknowledged_at timestamptz not null default now(),
  primary key (tenant_id,ticket_id,admin_user_id),
  foreign key (tenant_id,ticket_id) references public.support_tickets(tenant_id,id) on delete restrict
);

create table public.support_ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  ticket_id uuid not null,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  storage_path text not null unique,
  original_name text not null check (length(original_name) between 1 and 180),
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp')),
  byte_length integer not null check (byte_length between 1 and 2097152),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  state text not null default 'pending' check (state in ('pending','ready')),
  created_at timestamptz not null default now(),
  foreign key (tenant_id,ticket_id) references public.support_tickets(tenant_id,id) on delete restrict
);
create index support_ticket_attachments_by_ticket on public.support_ticket_attachments(tenant_id,ticket_id,state);

create table public.support_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  endpoint text not null,
  endpoint_sha256 text not null check (endpoint_sha256 ~ '^[a-f0-9]{64}$'),
  p256dh text not null,
  auth_key text not null,
  user_agent text not null default '' check (length(user_agent)<=300),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (tenant_id,user_id,endpoint_sha256)
);
create index support_push_subscriptions_active on public.support_push_subscriptions(tenant_id,user_id) where revoked_at is null;

create table public.support_push_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  ticket_id uuid not null,
  recipient_user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','delivered','failed','cancelled')),
  attempts integer not null default 0 check (attempts>=0),
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  last_error_class text check (last_error_class is null or length(last_error_class)<=80),
  foreign key (tenant_id,ticket_id) references public.support_tickets(tenant_id,id) on delete restrict,
  unique (tenant_id,ticket_id,recipient_user_id)
);
create index support_push_outbox_due on public.support_push_outbox(next_attempt_at,created_at) where status='pending';

create or replace function public.support_is_member(p_tenant_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog
as $$ select exists(select 1 from public.tenant_memberships m join public.tenants t on t.id=m.tenant_id
  where m.tenant_id=p_tenant_id and m.user_id=auth.uid() and m.status='active' and t.status='active'); $$;
create or replace function public.support_is_admin(p_tenant_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog
as $$ select public.has_tenant_permission(p_tenant_id,'membership.manage'); $$;
create or replace function public.support_can_access_ticket(p_tenant_id uuid,p_ticket_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog
as $$ select exists(select 1 from public.support_tickets t where t.tenant_id=p_tenant_id and t.id=p_ticket_id
  and (t.created_by=auth.uid() or public.support_is_admin(t.tenant_id))); $$;
revoke all on function public.support_is_member(uuid),public.support_is_admin(uuid),public.support_can_access_ticket(uuid,uuid) from public,anon;
grant execute on function public.support_is_member(uuid),public.support_is_admin(uuid),public.support_can_access_ticket(uuid,uuid) to authenticated;

create or replace function public.support_ticket_before_write()
returns trigger language plpgsql set search_path=pg_catalog
as $$ begin
  new.updated_at:=now();
  if tg_op='INSERT' then
    new.ticket_number:='NT-'||to_char(now(),'YYMMDD')||'-'||lpad(nextval('public.support_ticket_number_seq')::text,5,'0');
  end if;
  if new.status='Closed' then new.closed_at:=coalesce(new.closed_at,now()); else new.closed_at:=null; end if;
  return new;
end; $$;
create trigger support_ticket_before_write_trigger before insert or update on public.support_tickets
for each row execute function public.support_ticket_before_write();

create or replace function public.support_ticket_after_write()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $$ declare v_actor uuid:=auth.uid(); v_role text;
begin
  if tg_op='INSERT' then
    insert into public.support_ticket_events(tenant_id,ticket_id,actor_user_id,event_type)
      values(new.tenant_id,new.id,new.created_by,'submitted');
    insert into public.support_push_outbox(tenant_id,ticket_id,recipient_user_id)
      select new.tenant_id,new.id,m.user_id from public.tenant_memberships m
      where m.tenant_id=new.tenant_id and m.role='owner' and m.status='active'
      on conflict(tenant_id,ticket_id,recipient_user_id) do nothing;
    return new;
  end if;
  if old.status is distinct from new.status then
    insert into public.support_ticket_events(tenant_id,ticket_id,actor_user_id,event_type,details)
      values(new.tenant_id,new.id,v_actor,'status_changed',jsonb_build_object('from',old.status,'to',new.status));
  end if;
  return new;
end; $$;
create trigger support_ticket_after_write_trigger after insert or update on public.support_tickets
for each row execute function public.support_ticket_after_write();

create or replace function public.support_message_before_write()
returns trigger language plpgsql set search_path=pg_catalog
as $$ begin
  if new.author_user_id is distinct from auth.uid() then raise exception 'Invalid message author' using errcode='42501'; end if;
  new.author_role:=case when public.support_is_admin(new.tenant_id) then 'admin' else 'customer' end;
  return new;
end; $$;
create trigger support_message_before_write_trigger before insert on public.support_ticket_messages
for each row execute function public.support_message_before_write();
create or replace function public.support_message_after_write()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $$ begin
  insert into public.support_ticket_events(tenant_id,ticket_id,actor_user_id,event_type)
    values(new.tenant_id,new.ticket_id,new.author_user_id,'response_added'); return new;
end; $$;
create trigger support_message_after_write_trigger after insert on public.support_ticket_messages
for each row execute function public.support_message_after_write();
create or replace function public.support_attachment_after_write()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $$ begin
  if new.state='ready' and (tg_op='INSERT' or old.state is distinct from new.state) then
    insert into public.support_ticket_events(tenant_id,ticket_id,actor_user_id,event_type,details)
      values(new.tenant_id,new.ticket_id,new.uploaded_by,'attachment_added',jsonb_build_object('attachment_id',new.id));
  end if;
  return new;
end; $$;
create trigger support_attachment_after_write_trigger after insert or update on public.support_ticket_attachments
for each row execute function public.support_attachment_after_write();

create or replace function public.create_support_ticket(
  p_tenant_id uuid,p_client_submission_id uuid,p_category text,p_subject text,p_description text
) returns setof public.support_tickets language plpgsql security definer set search_path=pg_catalog
as $$ declare v_ticket public.support_tickets%rowtype;
begin
  if auth.uid() is null or not public.support_is_member(p_tenant_id) then raise exception 'Membership required' using errcode='42501'; end if;
  if p_category is null or length(btrim(p_category)) not between 1 and 80 or
     p_subject is null or length(btrim(p_subject)) not between 1 and 180 or
     p_description is null or length(btrim(p_description)) not between 1 and 10000 then
    raise exception 'Ticket fields are invalid' using errcode='22023'; end if;
  insert into public.support_tickets(tenant_id,created_by,client_submission_id,ticket_number,category,subject,description)
    values(p_tenant_id,auth.uid(),p_client_submission_id,'pending',btrim(p_category),btrim(p_subject),btrim(p_description))
    on conflict(tenant_id,created_by,client_submission_id) do nothing returning * into v_ticket;
  if v_ticket.id is null then
    select * into v_ticket from public.support_tickets where tenant_id=p_tenant_id and created_by=auth.uid() and client_submission_id=p_client_submission_id;
  end if;
  return next v_ticket;
end; $$;

create or replace function public.admin_update_support_ticket(
  p_tenant_id uuid,p_ticket_id uuid,p_status text,p_reply text default null
) returns public.support_tickets language plpgsql security definer set search_path=pg_catalog
as $$ declare v_ticket public.support_tickets%rowtype;
begin
  if auth.uid() is null or not public.support_is_admin(p_tenant_id) then raise exception 'Administrator permission required' using errcode='42501'; end if;
  if p_status not in ('Open','In Progress','Closed') then raise exception 'Invalid status' using errcode='22023'; end if;
  select * into v_ticket from public.support_tickets where tenant_id=p_tenant_id and id=p_ticket_id for update;
  if v_ticket.id is null then raise exception 'Ticket not found' using errcode='P0002'; end if;
  update public.support_tickets set status=p_status where id=p_ticket_id and tenant_id=p_tenant_id returning * into v_ticket;
  if nullif(btrim(p_reply),'') is not null then
    if length(p_reply)>10000 then raise exception 'Reply is too long' using errcode='22023'; end if;
    insert into public.support_ticket_messages(tenant_id,ticket_id,author_user_id,author_role,body)
      values(p_tenant_id,p_ticket_id,auth.uid(),'admin',btrim(p_reply));
  end if;
  return v_ticket;
end; $$;
create or replace function public.finalize_support_attachment(p_tenant_id uuid,p_attachment_id uuid,p_sha256 text)
returns public.support_ticket_attachments language plpgsql security definer set search_path=pg_catalog
as $$ declare v_attachment public.support_ticket_attachments%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into v_attachment from public.support_ticket_attachments where tenant_id=p_tenant_id and id=p_attachment_id for update;
  if v_attachment.id is null or not public.support_can_access_ticket(v_attachment.tenant_id,v_attachment.ticket_id)
     or (v_attachment.uploaded_by<>auth.uid() and not public.support_is_admin(v_attachment.tenant_id)) then
    raise exception 'Attachment access denied' using errcode='42501'; end if;
  if v_attachment.state<>'pending' or v_attachment.sha256<>p_sha256 or not exists(
    select 1 from storage.objects o where o.bucket_id='nitros-support-attachments' and o.name=v_attachment.storage_path
  ) then raise exception 'Attachment upload is not verified' using errcode='22023'; end if;
  update public.support_ticket_attachments set state='ready' where id=p_attachment_id and tenant_id=p_tenant_id returning * into v_attachment;
  return v_attachment;
end; $$;
create or replace function public.support_admin_unread_count(p_tenant_id uuid)
returns bigint language plpgsql stable security definer set search_path=pg_catalog
as $$ declare v_count bigint;
begin
  if auth.uid() is null or not public.support_is_admin(p_tenant_id) then raise exception 'Administrator permission required' using errcode='42501'; end if;
  select count(*) into v_count from public.support_tickets t where t.tenant_id=p_tenant_id
    and not exists(select 1 from public.support_ticket_reads r where r.tenant_id=t.tenant_id and r.ticket_id=t.id and r.admin_user_id=auth.uid());
  return v_count;
end; $$;

revoke all on function public.create_support_ticket(uuid,uuid,text,text,text),
  public.admin_update_support_ticket(uuid,uuid,text,text),
  public.finalize_support_attachment(uuid,uuid,text),
  public.support_admin_unread_count(uuid) from public,anon;
grant execute on function public.create_support_ticket(uuid,uuid,text,text,text),
  public.admin_update_support_ticket(uuid,uuid,text,text),
  public.finalize_support_attachment(uuid,uuid,text),
  public.support_admin_unread_count(uuid) to authenticated;

alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;
alter table public.support_ticket_events enable row level security;
alter table public.support_ticket_reads enable row level security;
alter table public.support_ticket_attachments enable row level security;
alter table public.support_push_subscriptions enable row level security;
alter table public.support_push_outbox enable row level security;
revoke all on public.support_tickets,public.support_ticket_messages,public.support_ticket_events,
  public.support_ticket_reads,public.support_ticket_attachments,public.support_push_subscriptions,
  public.support_push_outbox from public,anon,authenticated;
grant select on public.support_tickets,public.support_ticket_messages,public.support_ticket_events,
  public.support_ticket_reads,public.support_ticket_attachments,public.support_push_subscriptions to authenticated;
grant select,insert on public.support_ticket_messages to authenticated;
grant insert,update on public.support_ticket_reads,public.support_push_subscriptions to authenticated;
grant insert,delete on public.support_ticket_attachments to authenticated;

create policy support_ticket_read_own_or_admin on public.support_tickets for select to authenticated
  using(created_by=auth.uid() or public.support_is_admin(tenant_id));
create policy support_ticket_insert_member on public.support_tickets for insert to authenticated
  with check(created_by=auth.uid() and public.support_is_member(tenant_id));
create policy support_ticket_update_admin on public.support_tickets for update to authenticated
  using(public.support_is_admin(tenant_id)) with check(public.support_is_admin(tenant_id));
create policy support_message_read_ticket on public.support_ticket_messages for select to authenticated
  using(public.support_can_access_ticket(tenant_id,ticket_id));
create policy support_message_insert_ticket on public.support_ticket_messages for insert to authenticated
  with check(author_user_id=auth.uid() and public.support_can_access_ticket(tenant_id,ticket_id));
create policy support_event_read_admin on public.support_ticket_events for select to authenticated
  using(public.support_is_admin(tenant_id));
create policy support_read_read_admin on public.support_ticket_reads for select to authenticated
  using(admin_user_id=auth.uid() and public.support_is_admin(tenant_id));
create policy support_read_write_admin on public.support_ticket_reads for insert to authenticated
  with check(admin_user_id=auth.uid() and public.support_is_admin(tenant_id));
create policy support_read_update_admin on public.support_ticket_reads for update to authenticated
  using(admin_user_id=auth.uid() and public.support_is_admin(tenant_id))
  with check(admin_user_id=auth.uid() and public.support_is_admin(tenant_id));
create policy support_attachment_read_ticket on public.support_ticket_attachments for select to authenticated
  using(state='ready' and public.support_can_access_ticket(tenant_id,ticket_id));
create policy support_attachment_insert_ticket on public.support_ticket_attachments for insert to authenticated
  with check(uploaded_by=auth.uid() and state='pending' and public.support_can_access_ticket(tenant_id,ticket_id));
create policy support_attachment_update_ticket on public.support_ticket_attachments for update to authenticated
  using(uploaded_by=auth.uid() or public.support_is_admin(tenant_id))
  with check(uploaded_by=auth.uid() or public.support_is_admin(tenant_id));
create policy support_attachment_delete_ticket on public.support_ticket_attachments for delete to authenticated
  using(uploaded_by=auth.uid() or public.support_is_admin(tenant_id));
create policy support_push_subscription_read_self on public.support_push_subscriptions for select to authenticated
  using(user_id=auth.uid() and public.support_is_member(tenant_id));
create policy support_push_subscription_insert_self on public.support_push_subscriptions for insert to authenticated
  with check(user_id=auth.uid() and public.support_is_member(tenant_id));
create policy support_push_subscription_update_self on public.support_push_subscriptions for update to authenticated
  using(user_id=auth.uid() and public.support_is_member(tenant_id)) with check(user_id=auth.uid() and public.support_is_member(tenant_id));

-- Admins may see the display name of a user only when that user has submitted a
-- ticket inside their tenant; profiles remain invisible across unrelated shops.
create policy profile_support_ticket_admin_read on public.user_profiles for select to authenticated
  using(exists(select 1 from public.support_tickets t where t.created_by=user_profiles.user_id
    and public.support_is_admin(t.tenant_id)));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('nitros-support-attachments','nitros-support-attachments',false,2097152,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy support_attachment_object_insert on storage.objects for insert to authenticated
  with check(bucket_id='nitros-support-attachments' and exists(
    select 1 from public.support_ticket_attachments a where a.storage_path=name and a.state='pending'
      and public.support_can_access_ticket(a.tenant_id,a.ticket_id)));
create policy support_attachment_object_read on storage.objects for select to authenticated
  using(bucket_id='nitros-support-attachments' and exists(
    select 1 from public.support_ticket_attachments a where a.storage_path=name and a.state='ready'
      and public.support_can_access_ticket(a.tenant_id,a.ticket_id)));
create policy support_attachment_object_delete on storage.objects for delete to authenticated
  using(bucket_id='nitros-support-attachments' and exists(
    select 1 from public.support_ticket_attachments a where a.storage_path=name
      and (a.uploaded_by=auth.uid() or public.support_is_admin(a.tenant_id))));
