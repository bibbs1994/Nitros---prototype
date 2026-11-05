import { handleFailure, requestTenantId, requireShop, roleIsAdmin, sendJson, supabaseRequest, validateUuid } from './_lib/support-center.mjs';

export default async function handler(req,res){
  try{
    if(req.method!=='GET')return sendJson(res,405,{error:'Method not allowed',code:'METHOD_NOT_ALLOWED'});
    const tenantId=requestTenantId(req),ctx=await requireShop(req),ticketId=validateUuid(req.query?.ticketId);
    if(ctx.tenantId!==tenantId||!roleIsAdmin(ctx))return sendJson(res,403,{error:'Administrator access is required for this shop.',code:'ADMIN_ACCESS_REQUIRED'});
    const ticketResult=await supabaseRequest(ctx,'/rest/v1/support_tickets',{query:{select:'id,ticket_number,tenant_id,created_by,category,subject,description,status,created_at,updated_at,closed_at',tenant_id:`eq.${tenantId}`,id:`eq.${ticketId}`,limit:'1'}}),ticket=ticketResult.data?.[0];
    if(!ticket)return sendJson(res,404,{error:'Ticket not found.',code:'TICKET_NOT_FOUND'});
    const [messages,attachments,profiles]=await Promise.all([
      supabaseRequest(ctx,'/rest/v1/support_ticket_messages',{query:{select:'id,author_user_id,author_role,body,created_at',tenant_id:`eq.${tenantId}`,ticket_id:`eq.${ticketId}`,order:'created_at.asc',limit:'200'}}),
      supabaseRequest(ctx,'/rest/v1/support_ticket_attachments',{query:{select:'id,original_name,content_type,byte_length,created_at',tenant_id:`eq.${tenantId}`,ticket_id:`eq.${ticketId}`,state:'eq.ready',order:'created_at.asc',limit:'30'}}),
      supabaseRequest(ctx,'/rest/v1/user_profiles',{query:{select:'user_id,display_name',user_id:`eq.${ticket.created_by}`,limit:'1'}})
    ]);
    return sendJson(res,200,{ticket:{...ticket,requesterName:profiles.data?.[0]?.display_name||'Shop member'},messages:messages.data||[],attachments:attachments.data||[]});
  }catch(error){return handleFailure(res,error)}
}
