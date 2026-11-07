-- PHC BOOKING PAYMENT SAFETY GUARD (NEW MIGRATION)
-- Do not run blindly. First inspect your existing live Supabase table and functions.
-- This migration does NOT delete bookings or expire pending payments.
-- It blocks unsafe status updates that could free a slot linked to a Razorpay order.
-- Run only after approval and after a database backup, in the correct PHC project.
BEGIN;
CREATE OR REPLACE FUNCTION public.phc_protect_paid_or_ordered_booking()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'paid' OR (OLD.status = 'held' AND OLD.razorpay_order_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Protected paid or payment-pending booking cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.razorpay_order_id IS NOT NULL AND NEW.razorpay_order_id IS DISTINCT FROM OLD.razorpay_order_id THEN
    RAISE EXCEPTION 'Razorpay order reference cannot be changed';
  END IF;
  IF OLD.status = 'paid' AND (NEW.status <> 'paid' OR NEW.slot_date IS DISTINCT FROM OLD.slot_date OR NEW.slot_time IS DISTINCT FROM OLD.slot_time) THEN
    RAISE EXCEPTION 'Paid appointment must not be released or moved automatically';
  END IF;
  IF OLD.status = 'held' AND OLD.razorpay_order_id IS NOT NULL AND NEW.status IN ('expired','cancelled') THEN
    RAISE EXCEPTION 'Pending Razorpay order needs payment reconciliation before release';
  END IF;
  IF NEW.status = 'paid' AND (NEW.razorpay_order_id IS NULL OR NEW.razorpay_payment_id IS NULL OR NEW.paid_at IS NULL) THEN
    RAISE EXCEPTION 'Paid booking requires payment references';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS phc_guard_bookings_update ON public.online_bookings;
CREATE TRIGGER phc_guard_bookings_update
BEFORE UPDATE OR DELETE ON public.online_bookings
FOR EACH ROW EXECUTE FUNCTION public.phc_protect_paid_or_ordered_booking();
-- Keep this trigger private; only the server-side database key should operate on bookings.
REVOKE ALL ON FUNCTION public.phc_protect_paid_or_ordered_booking() FROM PUBLIC, anon, authenticated;
COMMIT;
