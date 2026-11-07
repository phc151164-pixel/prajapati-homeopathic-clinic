-- Read-only acceptance audit; run only in the intended project.
SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename IN('online_bookings','phc_closures','phc_admin_accounts','phc_clinic_settings','phc_patients','phc_visits','phc_audit_log');
SELECT p.oid::regprocedure::text signature,
 has_function_privilege('anon',p.oid,'EXECUTE') public_can_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') signed_in_can_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') server_can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'phc_%' ORDER BY 1;
SELECT t,has_table_privilege('anon','public.'||t,'SELECT') public_has_access,has_table_privilege('authenticated','public.'||t,'SELECT') signed_in_has_access FROM unnest(ARRAY['online_bookings','phc_closures','phc_admin_accounts','phc_clinic_settings','phc_patients','phc_visits','phc_audit_log'])t;
SELECT count(*) active_admins FROM public.phc_admin_accounts WHERE active;
SELECT version,updated_at FROM public.phc_clinic_settings;
-- No names, phone numbers, note text or credentials are returned.
