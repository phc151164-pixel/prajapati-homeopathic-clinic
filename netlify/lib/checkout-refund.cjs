const {supa, razorpay} = require('../functions/_common');

async function refundExpiredCheckout(orderId, paymentId, amount) {
  const query = new URLSearchParams({
    select: 'status,checkout_deadline',
    razorpay_order_id: 'eq.' + orderId,
    amount_paise: 'eq.' + amount
  });
  const [booking] = await supa('online_bookings?' + query);
  if (!booking?.checkout_deadline || !['held', 'expired'].includes(booking.status) ||
      !(Date.parse(booking.checkout_deadline) <= Date.now())) return false;

  const refund = await razorpay('payments/' + encodeURIComponent(paymentId) + '/refund', 'POST',
    {amount, speed: 'normal', notes: {reason: 'Checkout expired'}},
    {'X-Refund-Idempotency': 'phc-checkout-' + paymentId});
  return /^rfnd_[A-Za-z0-9]+$/.test(refund?.id || '') &&
    refund.payment_id === paymentId && refund.amount === amount &&
    ['pending', 'processed'].includes(refund.status);
}
module.exports = {refundExpiredCheckout};
