import { handleFailure, jsonBody, requestTenantId, requireShop, roleIsAdmin, sendJson, supabaseRequest, text, validateUuid } from './_lib/support-center.mjs';

export default async function handler(req,res){
  try{
    const tenantId=requestTenantId(req),ctx=await requireShop(req);
    if(ctx.tenantId!==tenantId||!roleIsAdmin(ctx))return sendJson(res,403,{error:'Administrator access is required for this shop.',code:'ADMIN_ACCESS_REQUIRED'});
    if(req.method==='GET'){
      const status=text(req.query?.status,20),rawOffset=Number.parseInt(req.query?.offset||'0',10),offset=Number.isFinite(rawOffset)?Math.max(0,Math.min(1000000,rawOffset)):0,limit=500;
      const query={select:'id,ticket_number,created_by,category,subject,description,status,created_at,updated_at,closed_at',tenant_id:`eq.${tenantId}`,order:'created_at.desc',limit:String(limit),offset:String(offset)};
      if(['Open','In Progress','Closed'].includes(status))query.status=`eq.${status}`;
      const ticketsResult=await supabaseRequest(ctx,'/rest/v1/support_tickets',{query}),tickets=ticketsResult.data||[];
      const ticketIds=tickets.map(ticket=>ticket.id),userIds=[...new Set(tickets.map(ticket=>ticket.created_by))];
      const [reads,profiles]=ticketIds.length?await Promise.all([
        supabaseRequest(ctx,'/rest/v1/support_ticket_reads',{query:{select:'ticket_id,acknowledged_at',tenant_id:`eq.${tenantId}`,admin_user_id:`eq.${ctx.userId}`,ticket_id:'in.('+ticketIds.join(',')+')',limit:'500'}}),
        supabaseRequest(ctx,'/rest/v1/user_profiles',{query:{select:'user_id,display_name',user_id:'in.('+userIds.join(',')+')',limit:'500'}})
      ]):[{data:[]},{data:[]}];
      const [unreadResult]=await Promise.all([supabaseRequest(ctx,'/rest/v1/rpc/support_admin_unread_count',{method:'POST',body:{p_tenant_id:tenantId}})]);
      const readIds=new Set((reads.data||[]).map(row=>row.ticket_id)),names=new Map((profiles.data||[]).map(row=>[row.user_id,row.display_name]));
      const enriched=tickets.map(ticket=>({...ticket,requesterName:names.get(ticket.created_by)||'Shop member',unread:!readIds.has(ticket.id)}));
      const unreadCount=Number(unreadResult.data)||0;
      return sendJson(res,200,{tickets:enriched,unreadCount,nextOffset:tickets.length===limit?offset+limit:null});
    }
    if(req.method==='POST'){
      const body=await jsonBody(req),ticketId=validateUuid(body.ticketId);
      if(body.acknowledge===true){
        const result=await supabaseRequest(ctx,'/rest/v1/support_ticket_reads?on_conflict=tenant_id,ticket_id,admin_user_id',{method:'POST',body:{tenant_id:tenantId,ticket_id:ticketId,admin_user_id:ctx.userId,acknowledged_at:new Date().toISOString()},prefer:'resolution=merge-duplicates,return=minimal'});
        return sendJson(res,200,{acknowledged:true});
      }
      const status=text(body.status,20),reply=text(body.reply,10000);
      if(!['Open','In Progress','Closed'].includes(status))return sendJson(res,400,{error:'Choose Open, In Progress, or Closed.',code:'INVALID_STATUS'});
      const result=await supabaseRequest(ctx,'/rest/v1/rpc/admin_update_support_ticket',{method:'POST',body:{p_tenant_id:tenantId,p_ticket_id:ticketId,p_status:status,p_reply:reply||null}});
      if(!result.data?.id)return sendJson(res,404,{error:'Ticket not found.',code:'TICKET_NOT_FOUND'});
      return sendJson(res,200,{ticket:result.data});
    }
    return sendJson(res,405,{error:'Method not allowed',code:'METHOD_NOT_ALLOWED'});
  }catch(error){return handleFailure(res,error)}
}
