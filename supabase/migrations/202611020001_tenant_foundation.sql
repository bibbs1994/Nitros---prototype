-- Staging-only foundation. Apply only to a separate empty Supabase project.
-- Existing browser records are intentionally not imported or modified.
create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check(length(btrim(display_name)) between 1 and 160),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  tenant_type text not null check (tenant_type in ('individual','repair_shop')),
  display_name text not null check (length(btrim(display_name)) between 1 and 180),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'active' check (status in ('active','suspended','closed')),
  created_at timestamptz not null default now(), unique(id)
);
create unique index one_individual_tenant_per_owner on public.tenants(owner_user_id) where tenant_type='individual';

create table public.tenant_memberships (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  role text not null check (role in ('owner','technician','service_advisor')),
  status text not null default 'active' check (status in ('invited','active','suspended','revoked')),
  created_at timestamptz not null default now(), revoked_at timestamptz,
  unique(tenant_id,user_id), unique(tenant_id,id)
);
create index tenant_membership_by_user on public.tenant_memberships(user_id,status,tenant_id);

create table public.tenant_permissions (
  tenant_id uuid not null, membership_id uuid not null, permission_code text not null check(permission_code in
    ('records.read','records.write','records.delete','membership.read','membership.manage','backup.read','backup.manage','billing.read','audit.read')),
  granted_by uuid not null references auth.users(id) on delete restrict, created_at timestamptz not null default now(),
  primary key(tenant_id,membership_id,permission_code),
  foreign key(tenant_id,membership_id) references public.tenant_memberships(tenant_id,id) on delete cascade
);
create table public.tenant_invitations (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete restrict,
  email_normalized text not null check(email_normalized=lower(btrim(email_normalized))),
  role text not null check(role in ('technician','service_advisor')), token_sha256 text not null unique check(token_sha256 ~ '^[a-f0-9]{64}$'),
  permission_codes text[] not null default '{}', expires_at timestamptz not null,
  status text not null default 'pending' check(status in ('pending','accepted','revoked','expired')),
  invited_by uuid not null references auth.users(id) on delete restrict, accepted_by uuid references auth.users(id),
  created_at timestamptz not null default now(), accepted_at timestamptz, revoked_at timestamptz
);
create unique index pending_invite_per_email on public.tenant_invitations(tenant_id,email_normalized) where status='pending';
create table public.technician_pin_credentials (
  tenant_id uuid not null, membership_id uuid not null,
  argon2id_phc text not null check(argon2id_phc like '$argon2id$%'),
  failed_attempts integer not null default 0 check(failed_attempts>=0), locked_until timestamptz,
  updated_at timestamptz not null default now(), revoked_at timestamptz,
  primary key(tenant_id,membership_id),
  foreign key(tenant_id,membership_id) references public.tenant_memberships(tenant_id,id) on delete cascade
);

create table public.tenant_devices (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, membership_id uuid not null,
  public_key_sha256 text not null check(public_key_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'active' check(status in ('active','revoked')),
  created_at timestamptz not null default now(), revoked_at timestamptz,
  unique(tenant_id,id), foreign key(tenant_id,membership_id) references public.tenant_memberships(tenant_id,id) on delete restrict
);
create table public.offline_authorizations (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, membership_id uuid not null, device_id uuid not null,
  issued_at timestamptz not null, expires_at timestamptz not null, revoked_at timestamptz,
  check(expires_at>issued_at and expires_at<=issued_at+interval '24 hours'), unique(tenant_id,id),
  foreign key(tenant_id,membership_id) references public.tenant_memberships(tenant_id,id) on delete restrict,
  foreign key(tenant_id,device_id) references public.tenant_devices(tenant_id,id) on delete restrict
);
create table public.tenant_entitlements (
  tenant_id uuid primary key references public.tenants(id) on delete restrict,
  status text not null default 'not_configured' check(status in ('not_configured','active','grace','suspended','cancelled')),
  plan_code text, billing_customer_ref text unique, billing_subscription_ref text unique, updated_at timestamptz not null default now()
);
create table public.tenant_audit_events (
  id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null, event_type text not null,
  created_at timestamptz not null default now(), metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object')
);
create table public.tenant_drive_bindings (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete restrict,
  drive_permission_id text not null, connected_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(), revoked_at timestamptz, unique(tenant_id,drive_permission_id)
);
create unique index one_active_drive_per_tenant on public.tenant_drive_bindings(tenant_id) where revoked_at is null;
create unique index one_tenant_per_active_drive on public.tenant_drive_bindings(drive_permission_id) where revoked_at is null;
create table public.tenant_backup_manifests (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, backup_id text not null,
  drive_permission_id text not null, drive_file_id text not null, format_version integer not null check(format_version>0),
  ciphertext_sha256 text not null check(ciphertext_sha256 ~ '^[a-f0-9]{64}$'), byte_length bigint not null check(byte_length>=0),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), verified_at timestamptz,
  unique(tenant_id,backup_id), unique(tenant_id,drive_file_id),
  foreign key(tenant_id,drive_permission_id) references public.tenant_drive_bindings(tenant_id,drive_permission_id) on delete restrict
);

-- JSON payload preserves legacy fields; binary media must use a separately reviewed tenant-scoped object adapter.
create table public.customers (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete restrict,
  payload jsonb not null check(jsonb_typeof(payload)='object'), created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), unique(tenant_id,id)
);
create table public.vehicles (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid,
  payload jsonb not null check(jsonb_typeof(payload)='object'), created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), unique(tenant_id,id),
  foreign key(tenant_id,customer_id) references public.customers(tenant_id,id) on delete restrict
);
create table public.repair_orders (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid, vehicle_id uuid,
  status text not null, payload jsonb not null check(jsonb_typeof(payload)='object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(tenant_id,id),
  foreign key(tenant_id,customer_id) references public.customers(tenant_id,id) on delete restrict,
  foreign key(tenant_id,vehicle_id) references public.vehicles(tenant_id,id) on delete restrict
);
create table public.repair_order_artifacts (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, repair_order_id uuid not null,
  artifact_type text not null check(artifact_type in ('inspection','estimate','authorization','note','timer','gps','photo','signature','completion')),
  payload jsonb not null default '{}'::jsonb check(jsonb_typeof(payload)='object'), created_at timestamptz not null default now(),
  unique(tenant_id,id), foreign key(tenant_id,repair_order_id) references public.repair_orders(tenant_id,id) on delete restrict
);
create table public.tenant_media (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, repair_order_id uuid not null, artifact_id uuid,
  object_path text not null unique, media_type text not null, byte_length bigint not null check(byte_length>=0),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'), created_at timestamptz not null default now(), unique(tenant_id,id),
  foreign key(tenant_id,repair_order_id) references public.repair_orders(tenant_id,id) on delete restrict,
  foreign key(tenant_id,artifact_id) references public.repair_order_artifacts(tenant_id,id) on delete restrict
);

create or replace function public.has_tenant_permission(p_tenant_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path=pg_catalog
as $$ select exists(select 1 from public.tenant_memberships m join public.tenants t on t.id=m.tenant_id
  where m.tenant_id=p_tenant_id and m.user_id=auth.uid() and m.status='active' and t.status='active'
  and (m.role='owner' or exists(select 1 from public.tenant_permissions p where p.tenant_id=m.tenant_id
    and p.membership_id=m.id and p.permission_code=p_permission))); $$;
revoke all on function public.has_tenant_permission(uuid,text) from public,anon;
grant execute on function public.has_tenant_permission(uuid,text) to authenticated;

-- Account creation issues an immutable UUID server-side; only verified users may create accounts.
create or replace function public.create_tenant(p_type text,p_name text)
returns uuid language plpgsql security definer set search_path=pg_catalog
as $$ declare v_user uuid:=auth.uid(); v_verified timestamptz; v_id uuid;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select email_confirmed_at into v_verified from auth.users where id=v_user;
  if v_verified is null then raise exception 'Verified email required' using errcode='42501'; end if;
  if p_type not in ('individual','repair_shop') or p_name is null or length(btrim(p_name)) not between 1 and 180 then
    raise exception 'Valid account type and display name required' using errcode='22023'; end if;
  insert into public.user_profiles(user_id,display_name) values(v_user,btrim(p_name))
    on conflict(user_id) do update set display_name=excluded.display_name,updated_at=now();
  insert into public.tenants(tenant_type,display_name,owner_user_id) values(p_type,btrim(p_name),v_user) returning id into v_id;
  insert into public.tenant_memberships(tenant_id,user_id,role,status) values(v_id,v_user,'owner','active');
  insert into public.tenant_entitlements(tenant_id) values(v_id);
  insert into public.tenant_audit_events(tenant_id,actor_user_id,event_type) values(v_id,v_user,'tenant.created');
  return v_id;
end; $$;
revoke all on function public.create_tenant(text,text) from public,anon;
grant execute on function public.create_tenant(text,text) to authenticated;

create or replace function public.revoke_tenant_membership(p_tenant_id uuid,p_user_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog
as $$ declare v_member public.tenant_memberships%rowtype;
begin
  if auth.uid() is null or not public.has_tenant_permission(p_tenant_id,'membership.manage') then
    raise exception 'Owner permission required' using errcode='42501';
  end if;
  select * into v_member from public.tenant_memberships where tenant_id=p_tenant_id and user_id=p_user_id for update;
  if not found then return false; end if;
  if v_member.role='owner' then raise exception 'Owner transfer requires separate approval' using errcode='42501'; end if;
  update public.tenant_memberships set status='revoked',revoked_at=now() where tenant_id=p_tenant_id and id=v_member.id;
  update public.technician_pin_credentials set revoked_at=now(),failed_attempts=0,locked_until=null
    where tenant_id=p_tenant_id and membership_id=v_member.id;
  update public.tenant_devices set status='revoked',revoked_at=now() where tenant_id=p_tenant_id and membership_id=v_member.id;
  update public.offline_authorizations set revoked_at=now() where tenant_id=p_tenant_id and membership_id=v_member.id and revoked_at is null;
  insert into public.tenant_audit_events(tenant_id,actor_user_id,event_type,metadata)
    values(p_tenant_id,auth.uid(),'membership.revoked',jsonb_build_object('subject_user_id',p_user_id));
  return true;
end; $$;
revoke all on function public.revoke_tenant_membership(uuid,uuid) from public,anon;
grant execute on function public.revoke_tenant_membership(uuid,uuid) to authenticated;

-- RLS on only the tables created by this migration; no other public tables touched.
alter table public.user_profiles enable row level security;
alter table public.tenants enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.tenant_permissions enable row level security;
alter table public.tenant_invitations enable row level security;
alter table public.technician_pin_credentials enable row level security;
alter table public.tenant_devices enable row level security;
alter table public.offline_authorizations enable row level security;
alter table public.tenant_entitlements enable row level security;
alter table public.tenant_audit_events enable row level security;
alter table public.tenant_drive_bindings enable row level security;
alter table public.tenant_backup_manifests enable row level security;
alter table public.customers enable row level security;
alter table public.vehicles enable row level security;
alter table public.repair_orders enable row level security;
alter table public.repair_order_artifacts enable row level security;
alter table public.tenant_media enable row level security;
revoke all on public.user_profiles,public.tenants,public.tenant_memberships,public.tenant_permissions,
  public.tenant_invitations,public.technician_pin_credentials,public.tenant_devices,public.offline_authorizations,
  public.tenant_entitlements,public.tenant_audit_events,public.tenant_drive_bindings,public.tenant_backup_manifests,
  public.customers,public.vehicles,public.repair_orders,public.repair_order_artifacts,public.tenant_media
  from public,anon,authenticated;
grant select,update on public.user_profiles to authenticated;
grant select on public.tenants,public.tenant_memberships,public.tenant_permissions,public.tenant_entitlements,
  public.tenant_audit_events,public.tenant_devices,public.offline_authorizations,
  public.tenant_drive_bindings,public.tenant_backup_manifests to authenticated;
grant select,insert,update,delete on public.customers,public.vehicles,public.repair_orders,
  public.repair_order_artifacts,public.tenant_media to authenticated;

create policy profile_select_self on public.user_profiles for select to authenticated using(user_id=auth.uid());
create policy profile_update_self on public.user_profiles for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy tenant_select_member on public.tenants for select to authenticated using(public.has_tenant_permission(id,'records.read'));
create policy membership_select_self_or_manager on public.tenant_memberships for select to authenticated
  using(user_id=auth.uid() or public.has_tenant_permission(tenant_id,'membership.read'));
create policy permission_select_scoped on public.tenant_permissions for select to authenticated
  using(exists(select 1 from public.tenant_memberships m where m.tenant_id=tenant_permissions.tenant_id and m.id=tenant_permissions.membership_id
    and (m.user_id=auth.uid() or public.has_tenant_permission(m.tenant_id,'membership.read'))));
create policy entitlement_select_owner on public.tenant_entitlements for select to authenticated using(public.has_tenant_permission(tenant_id,'billing.read'));
create policy audit_select_authorized on public.tenant_audit_events for select to authenticated using(tenant_id is not null and public.has_tenant_permission(tenant_id,'audit.read'));
create policy device_select_self on public.tenant_devices for select to authenticated
  using(exists(select 1 from public.tenant_memberships m where m.tenant_id=tenant_devices.tenant_id and m.id=tenant_devices.membership_id and m.user_id=auth.uid() and m.status='active'));
create policy offline_authorization_select_self on public.offline_authorizations for select to authenticated
  using(exists(select 1 from public.tenant_memberships m where m.tenant_id=offline_authorizations.tenant_id and m.id=offline_authorizations.membership_id and m.user_id=auth.uid() and m.status='active'));
create policy drive_binding_select_owner on public.tenant_drive_bindings for select to authenticated using(public.has_tenant_permission(tenant_id,'backup.read'));
create policy backup_manifest_select_owner on public.tenant_backup_manifests for select to authenticated using(public.has_tenant_permission(tenant_id,'backup.read'));

create policy customers_read on public.customers for select to authenticated using(public.has_tenant_permission(tenant_id,'records.read'));
create policy customers_insert on public.customers for insert to authenticated with check(public.has_tenant_permission(tenant_id,'records.write'));
create policy customers_update on public.customers for update to authenticated using(public.has_tenant_permission(tenant_id,'records.read')) with check(public.has_tenant_permission(tenant_id,'records.write'));
create policy customers_delete on public.customers for delete to authenticated using(public.has_tenant_permission(tenant_id,'records.delete'));
create policy vehicles_read on public.vehicles for select to authenticated using(public.has_tenant_permission(tenant_id,'records.read'));
create policy vehicles_insert on public.vehicles for insert to authenticated with check(public.has_tenant_permission(tenant_id,'records.write'));
create policy vehicles_update on public.vehicles for update to authenticated using(public.has_tenant_permission(tenant_id,'records.read')) with check(public.has_tenant_permission(tenant_id,'records.write'));
create policy vehicles_delete on public.vehicles for delete to authenticated using(public.has_tenant_permission(tenant_id,'records.delete'));
create policy repair_orders_read on public.repair_orders for select to authenticated using(public.has_tenant_permission(tenant_id,'records.read'));
create policy repair_orders_insert on public.repair_orders for insert to authenticated with check(public.has_tenant_permission(tenant_id,'records.write'));
create policy repair_orders_update on public.repair_orders for update to authenticated using(public.has_tenant_permission(tenant_id,'records.read')) with check(public.has_tenant_permission(tenant_id,'records.write'));
create policy repair_orders_delete on public.repair_orders for delete to authenticated using(public.has_tenant_permission(tenant_id,'records.delete'));
create policy artifacts_read on public.repair_order_artifacts for select to authenticated using(public.has_tenant_permission(tenant_id,'records.read'));
create policy artifacts_insert on public.repair_order_artifacts for insert to authenticated with check(public.has_tenant_permission(tenant_id,'records.write'));
create policy artifacts_update on public.repair_order_artifacts for update to authenticated using(public.has_tenant_permission(tenant_id,'records.read')) with check(public.has_tenant_permission(tenant_id,'records.write'));
create policy artifacts_delete on public.repair_order_artifacts for delete to authenticated using(public.has_tenant_permission(tenant_id,'records.delete'));
create policy media_read on public.tenant_media for select to authenticated using(public.has_tenant_permission(tenant_id,'records.read'));
create policy media_insert on public.tenant_media for insert to authenticated with check(public.has_tenant_permission(tenant_id,'records.write'));
create policy media_update on public.tenant_media for update to authenticated using(public.has_tenant_permission(tenant_id,'records.read')) with check(public.has_tenant_permission(tenant_id,'records.write'));
create policy media_delete on public.tenant_media for delete to authenticated using(public.has_tenant_permission(tenant_id,'records.delete'));

-- No direct client policies/grants for memberships, permissions, invitations, PIN hashes,
-- device registration/lease writes, entitlements, audit writes, Drive bindings, or manifests.
