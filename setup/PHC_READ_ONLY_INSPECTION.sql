-- Metadata only; no patient rows, secrets, changes or migration execution.
BEGIN TRANSACTION READ ONLY;
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('online_bookings','phc_closures');
SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check
FROM pg_policies WHERE schemaname='public' AND tablename IN ('online_bookings','phc_closures');
SELECT grantee,table_name,privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name IN ('online_bookings','phc_closures');
SELECT p.oid::regprocedure AS function_signature,p.prosecdef,p.proconfig,p.proacl,pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname LIKE 'phc\_%' ESCAPE '\';
SELECT tablename,indexname,indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename IN ('online_bookings','phc_closures');
SELECT c.relname,pg_get_constraintdef(k.oid) FROM pg_constraint k
JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('online_bookings','phc_closures');
SELECT c.relname,pg_get_triggerdef(t.oid) FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('online_bookings','phc_closures') AND NOT t.tgisinternal;
ROLLBACK;
