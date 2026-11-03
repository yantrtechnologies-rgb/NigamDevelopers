import {admin,reply,user,razor} from '../_shared/core.ts';

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return reply({});
  try{
    if(req.method!=='POST')return reply({error:'Method not allowed'},405);
    const u=await user(req);const {order_id}=await req.json();
    if(!order_id)throw Error('Order ID required');
    const order=await razor('orders/'+encodeURIComponent(order_id));
    if(order.status==='paid'||Number(order.amount_paid)>0)return reply({released:false,payment_detected:true});
    const {data,error}=await admin.from('bookings').update({status:'expired',expires_at:new Date().toISOString()}).eq('order_id',order_id).eq('user_id',u.id).eq('status','held').select('id').maybeSingle();
    if(error)throw error;
    if(data)await admin.from('audit_logs').insert({booking_id:data.id,action:'checkout_cancelled_hold_released'});
    return reply({released:!!data});
  }catch(e){return reply({error:e.message},400)}
});
