do $$
begin
  if (select count(*) from public.profiles where id = '00000000-0000-4000-8000-0000000000a1' and full_name = 'Legacy User') <> 1 then
    raise exception 'Existing profile data was lost or changed by the migrations';
  end if;
  if (select count(*) from public.change_requests where id = '00000000-0000-4000-8000-0000000000b1' and title = 'Legacy request') <> 1 then
    raise exception 'Existing change request data was lost or changed by the migrations';
  end if;
end $$;
