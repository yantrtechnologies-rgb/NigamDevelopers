import {reply,user} from '../_shared/core.ts';
Deno.serve(async req=>{if(req.method==='OPTIONS')return reply({});try{await user(req);return reply({error:'Online cancellation is not enabled until the venue configures its cancellation and refund policy. Contact the venue.'},409);}catch(e){return reply({error:e.message},401)}});
