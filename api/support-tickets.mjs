import { handleFailure, jsonBody, requestTenantId, requireShop, sendJson, supabaseRequest, text, validateUuid } from './_lib/support-center.mjs';
import { dispatchSupportPush } from './support-push-dispatch.mjs';

export default async function handler(req,res){
  try{
    const tenantId=requestTenantId(req),ctx=await requireShop(req);
    if(ctx.tenantId!==tenantId)return sendJson(res,403,{error:'Your account is not authorized for the selected shop.',code:'SUPPORT_ACCESS_DENIED'});
    if(req.method==='GET'){
      const ticketId=req.query?.ticketId;
      if(ticketId){
        validateUuid(ticketId);
        const ticketResult=await supabaseRequest(ctx,'/rest/v1/support_tickets',{query:{select:'id,ticket_number,tenant_id,created_by,category,subject,description,status,created_at,updated_at,closed_at',tenant_id:`eq.${tenantId}`,created_by:`eq.${ctx.userId}`,id:`eq.${ticketId}`,limit:'1'}});
        const ticket=ticketResult.data?.[0];if(!ticket)return sendJson(res,404,{error:'Ticket not found.',code:'TICKET_NOT_FOUND'});
        const [messages,attachments]=await Promise.all([
          supabaseRequest(ctx,'/rest/v1/support_ticket_messages',{query:{select:'id,author_user_id,author_role,body,created_at',tenant_id:`eq.${tenantId}`,ticket_id:`eq.${ticketId}`,order:'created_at.asc',limit:'200'}}),
          supabaseRequest(ctx,'/rest/v1/support_ticket_attachments',{query:{select:'id,original_name,content_type,byte_length,created_at',tenant_id:`eq.${tenantId}`,ticket_id:`eq.${ticketId}`,state:'eq.ready',order:'created_at.asc',limit:'30'}})
        ]);
        return sendJson(res,200,{ticket,messages:messages.data||[],attachments:attachments.data||[]});
      }
      const result=await supabaseRequest(ctx,'/rest/v1/support_tickets',{query:{select:'id,ticket_number,category,subject,description,status,created_at,updated_at,closed_at',tenant_id:`eq.${tenantId}`,created_by:`eq.${ctx.userId}`,order:'created_at.desc',limit:'100'}});
      return sendJson(res,200,{tickets:result.data||[]});
    }
    if(req.method==='POST'){
      const body=await jsonBody(req),clientSubmissionId=validateUuid(body.clientSubmissionId,'INVALID_SUBMISSION_ID');
      const category=text(body.category,80),subject=text(body.subject,180),description=text(body.description,10000);
      if(!category||!subject||!description)return sendJson(res,400,{error:'Category, subject, and issue description are required.',code:'TICKET_FIELDS_REQUIRED'});
      const result=await supabaseRequest(ctx,'/rest/v1/rpc/create_support_ticket',{method:'POST',body:{p_tenant_id:tenantId,p_client_submission_id:clientSubmissionId,p_category:category,p_subject:subject,p_description:description}});
      const ticket=Array.isArray(result.data)?result.data[0]:result.data;
      if(!ticket?.id||!ticket?.ticket_number)return sendJson(res,503,{error:'The server did not confirm ticket creation.',code:'TICKET_CREATE_UNCONFIRMED'});
      let push='queued';try{const dispatched=await dispatchSupportPush({tenantId,ticketId:ticket.id,maxItems:1});push=dispatched.delivered?'delivered':'queued'}catch{}
      return sendJson(res,201,{ticket,idempotent:true,pushStatus:push});
    }
    return sendJson(res,405,{error:'Method not allowed',code:'METHOD_NOT_ALLOWED'});
  }catch(error){return handleFailure(res,error)}
}
