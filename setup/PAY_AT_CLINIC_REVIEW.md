# Pay at Clinic: doctor approval

This change is staged for review. Do not merge into production until the additive migration and complete workflow pass in PHC Safety Test.

Apply `supabase/migrations/20261107211757_pay_at_clinic_doctor_approval.sql` only after a fresh private application backup. It requires Dashboard V2. It creates private request/receipt tables, a nullable visit reference, protected RPCs and capacity guards. It does not rewrite existing records or turn on any payment method. Existing `payAtClinic:false` stays false.

A patient request snapshots the fee and duration but does not reserve a slot. The authenticated doctor verifies identity, optionally selects an existing permanent Patient ID, and approves. Approval rechecks the schedule and competing online/clinic bookings under the existing date lock. Cash stays due until the doctor explicitly confirms physical receipt of the exact saved fee. One immutable receipt is issued per request; retries return the original receipt. Cash never confirms a Razorpay order.

The doctor may decline pending requests or cancel confirmed appointments that have no cash receipt. Paid clinic cancellation, refunds and rescheduling are deliberately unavailable pending a separate reviewed workflow. Online paid and ordered holds keep their protections. Public responses expose no patient lists, notes or contact details. All new tables have RLS; anon/authenticated have no access or RPC execution.

## Test preview

1. Keep `PHC_LIVE_PAYMENTS_ENABLED=false` and preview pointed at PHC Safety Test.
2. Verify both clinic options remain OFF until the doctor chooses Payment settings → Pay at Clinic → ON.
3. Submit a synthetic clinic request. Confirm public acknowledgement says not reserved. It must appear in Pay at Clinic requests.
4. Verify identity and approve. Confirm calendar/availability block this slot, online reservation fails, cash remains due and the patient visit is linked.
5. Record received cash. Confirm immutable receipt appears in the request and patient history. A repeated confirmation returns the same receipt.
6. Try changing saved amount, moving/deleting paid records, closing an occupied slot and cancelling a cash-paid appointment: all must fail.
7. Submit and approve another request, then cancel it while unpaid. Confirm slot reopens and cancellation history remains.
8. Verify successful/failed Razorpay TEST payments and pending reconciliation still work. Do not activate real payments.
9. Turn Pay at Clinic OFF when testing ends. Existing confirmed appointments stay reserved.

Automated tests cover migration preservation, access, idempotency, approval/receipt gates, cross-method conflicts, immutable receipts, fee snapshots, cancellations and authenticated action routing. Concurrent multi-session stress and real browser preview checks remain separate deployment validation steps.
