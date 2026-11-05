import { handleFailure, requestIdentity, sendJson, supabaseRequest } from './_lib/support-center.mjs';

export default async function handler(req,res){
  try{
    if(req.method!=='GET')return sendJson(res,405,{error:'Method not allowed',code:'METHOD_NOT_ALLOWED'});
    const identity=await requestIdentity(req);
    const result=await supabaseRequest(identity,'/rest/v1/tenant_memberships',{query:{select:'tenant_id,role,status,tenants(display_name,tenant_type)',user_id:`eq.${identity.userId}`,status:'eq.active',order:'created_at.asc',limit:'50'}});
    if(!Array.isArray(result.data))return sendJson(res,503,{error:'Shop memberships could not be loaded.',code:'MEMBERSHIP_LOOKUP_FAILED'});
    return sendJson(res,200,{memberships:result.data.filter(row=>row?.status==='active'&&row?.tenant_id).map(row=>({tenantId:row.tenant_id,role:row.role,displayName:row.tenants?.display_name||'Shop',tenantType:row.tenants?.tenant_type||'repair_shop'}))});
  }catch(error){return handleFailure(res,error)}
}
