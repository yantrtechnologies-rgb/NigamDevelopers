import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {PDFDocument,StandardFonts,rgb} from 'https://esm.sh/pdf-lib@1.17.1';
import QRCode from 'npm:qrcode@1.5.4';
export const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
// These endpoints authenticate every user operation with a Supabase JWT and do
// not use browser cookies. A wildcard origin therefore safely supports the
// temporary HTTP custom domain while GitHub Pages provisions its TLS
// certificate, as well as the final HTTPS domain and local development.
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Content-Type':'application/json'};
export const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
export async function user(req:Request){const token=req.headers.get('Authorization')?.replace(/^Bearer /,'');if(!token)throw Error('Sign in required');const {data,error}=await admin.auth.getUser(token);if(error||!data.user)throw Error('Sign in required');return data.user;}
export async function razor(path:string,body?:unknown){const r=await fetch('https://api.razorpay.com/v1/'+path,{method:body?'POST':'GET',headers:{Authorization:'Basic '+btoa(Deno.env.get('RAZORPAY_KEY_ID')+':'+Deno.env.get('RAZORPAY_KEY_SECRET')),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(data.error?.description||'Payment provider unavailable');return data;}
export async function signature(data:string,sig:string,secret:string){if(!/^[0-9a-f]{64}$/i.test(sig||''))return false;const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);return crypto.subtle.verify('HMAC',key,new Uint8Array(sig.match(/../g)!.map(x=>parseInt(x,16))),new TextEncoder().encode(data));}
function safe(value:unknown){return String(value??'').replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]!));}
function bookingQrPayload(reference:string){return `nigamsturf:booking:${reference}`;}
async function bookingQr(reference:string){
  const dataUrl=await QRCode.toDataURL(bookingQrPayload(reference),{width:420,margin:2,color:{dark:'#173e2b',light:'#ffffff'}});
  const binary=atob(dataUrl.split(',')[1]);return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
function base64(bytes:Uint8Array){let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value);}
async function invoicePdf(booking:any,email:string,payment:string,qrBytes:Uint8Array){
  const pdf=await PDFDocument.create();const page=pdf.addPage([595,842]);const font=await pdf.embedFont(StandardFonts.Helvetica);const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const draw=(text:string,y:number,size=11,isBold=false)=>page.drawText(text,{x:54,y,size,font:isBold?bold:font,color:rgb(.08,.16,.12)});
  const qr=await pdf.embedPng(qrBytes);page.drawImage(qr,{x:385,y:568,width:145,height:145});
  draw("Nigam's Turf",780,22,true);draw('PAYMENT RECEIPT / INVOICE',748,14,true);draw(`Invoice: ${booking.reference}`,710,11,true);draw(`Customer: ${booking.customer_name}`,684);draw(`Email: ${email}`,664);draw(`Mobile: ${booking.mobile}`,644);draw(`Booking date: ${booking.booking_date}`,610);draw(`Start time: ${String(booking.start_time).slice(0,5)} IST`,590);draw(`Duration: ${booking.duration_minutes} minutes`,570);draw(`Payment ID: ${payment}`,536);draw(`Amount paid: INR ${(booking.amount_paise/100).toFixed(2)}`,504,14,true);draw('Payment status: Captured',482);draw('Show the QR code at the turf for booking verification.',448);draw('Thank you for booking Nigam\'s Turf.',420,12,true);
  return base64(await pdf.save());
}
async function sendBookingEmail(order:string,payment:string){
  const apiKey=Deno.env.get('BREVO_API_KEY');const fromEmail=Deno.env.get('BOOKING_FROM_EMAIL');if(!apiKey||!fromEmail)return;
  const {data:booking,error}=await admin.from('bookings').select('*').eq('order_id',order).single();if(error||!booking)throw error||Error('Booking not found');
  const {data:userData,error:userError}=await admin.auth.admin.getUserById(booking.user_id);const customerEmail=userData?.user?.email||userData?.user?.user_metadata?.email_contact;if(userError||!customerEmail)throw userError||Error('Customer email not found');
  const {data:claimed}=await admin.from('email_notifications').update({status:'sending'}).eq('booking_id',booking.id).eq('kind','confirmation').in('status',['pending','failed']).select('id').maybeSingle();if(!claimed)return;
  const email=customerEmail;const amount=(booking.amount_paise/100).toLocaleString('en-IN',{minimumFractionDigits:2});const qrBytes=await bookingQr(booking.reference);
  const html=`<div style="font-family:Arial,sans-serif;color:#173e2b;max-width:620px;margin:auto"><h1>Booking confirmed</h1><p>Hi ${safe(booking.customer_name)},</p><p>Your booking at <strong>Nigam's Turf</strong> is confirmed.</p><table style="border-collapse:collapse;width:100%"><tr><td>Reference</td><td><strong>${safe(booking.reference)}</strong></td></tr><tr><td>Date</td><td>${safe(booking.booking_date)}</td></tr><tr><td>Time</td><td>${safe(String(booking.start_time).slice(0,5))} IST</td></tr><tr><td>Duration</td><td>${booking.duration_minutes} minutes</td></tr><tr><td>Amount paid</td><td>₹${amount}</td></tr></table><p>Your booking QR code and PDF invoice are attached. Show the QR code at the turf for verification.</p></div>`;
  try{const response=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':apiKey,'Content-Type':'application/json'},body:JSON.stringify({sender:{name:"Nigam's Turf",email:fromEmail},to:[{email,name:booking.customer_name}],subject:`Booking confirmed — ${booking.reference}`,htmlContent:html,attachment:[{name:`Nigams-Turf-${booking.reference}.pdf`,content:await invoicePdf(booking,email,payment,qrBytes)},{name:`Nigams-Turf-${booking.reference}-QR.png`,content:base64(qrBytes)}]})});if(!response.ok)throw Error(`Email provider error: ${response.status} ${await response.text()}`);await admin.from('email_notifications').update({status:'sent'}).eq('id',claimed.id);}catch(e){await admin.from('email_notifications').update({status:'failed'}).eq('id',claimed.id);throw e;}
}
export async function confirm(order:string,payment:string){const p=await razor('payments/'+encodeURIComponent(payment));if(p.order_id!==order||p.status!=='captured'||p.currency!=='INR')throw Error('Payment is not captured');const {data,error}=await admin.rpc('confirm_payment',{p_order:order,p_payment:payment,p_amount:p.amount});if(error)throw error;try{await sendBookingEmail(order,payment)}catch(e){console.error('Booking email failed',e)}return data;}
