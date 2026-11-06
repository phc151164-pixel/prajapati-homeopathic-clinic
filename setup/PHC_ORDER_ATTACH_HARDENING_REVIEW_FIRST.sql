-- PHC: SAFER RAZORPAY ORDER ATTACHMENT (PROPOSED MIGRATION)
-- NOT APPLIED TO YOUR SUPABASE DATABASE. REVIEW AND BACK UP BEFORE USE.
-- Does not delete, cancel, expire, or modify existing bookings when run.
-- Replaces the SQL function definition only.
-- IMPORTANT: This does not solve all abandoned payment holds. Never reopen an
-- order-linked slot without verifying that it cannot still receive payment.
BEGIN;
CREATE OR REPLACE FUNCTION public.phc_attach_order(p_id uuid, p_order text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF p_id IS NULL OR p_order IS NULL OR p_order !~ '^order_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'Invalid order attachment';
  END IF;

  -- First attachment is permitted only while the temporary hold is active.
  -- Repeating the SAME attachment is safe even if the original hold timer
  -- has elapsed; replacing an order reference is never permitted.
  UPDATE public.online_bookings
     SET razorpay_order_id = p_order
   WHERE id = p_id
     AND status = 'held'
     AND (
       (razorpay_order_id IS NULL AND held_until > now())
       OR razorpay_order_id = p_order
     );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking hold expired, missing, or linked to another order';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.phc_attach_order(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phc_attach_order(uuid,text) TO service_role;
COMMIT;
