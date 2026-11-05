import sharp from 'sharp';
import { randomId, handleFailure, jsonBody, requestTenantId, requireShop, roleIsAdmin, sendJson, sha256, SupportHttpError, supabaseRequest, text, validateUuid } from './_lib/support-center.mjs';

const MAX_BYTES=2_097_152;
const MIME_EXT=new Map([['image/jpeg','jpg'],['image/png','png'],['image/webp','webp']]);
const valid64=value=>typeof value==='string'&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
const safeName=value=>text(value,180).split(/[\\/]/).pop().replace(/[^A-Za-z0-9._ -]/g,'_').slice(0,180)||'screenshot';
export function decodeScreenshot(contentType,base64){
  if(!MIME_EXT.has(contentType)||!valid64(base64))throw new SupportHttpError(400,'INVALID_ATTACHMENT','Attach a PNG, JPEG, or WebP screenshot.');
  const bytes=Buffer.from(base64,'base64');
  if(!bytes.length||bytes.length>MAX_BYTES||bytes.toString('base64')!==base64)throw new SupportHttpError(413,'ATTACHMENT_TOO_LARGE_OR_INVALID','Screenshot must be 2 MB or smaller and use a supported image format.');
  return bytes;
}
export async function sanitizeScreenshot(contentType,bytes){
  const format=contentType==='image/jpeg'?'jpeg':contentType==='image/png'?'png':'webp';
  try{
    const image=sharp(bytes,{failOn:'error',limitInputPixels:16_000_000});
    const metadata=await image.metadata();
    if(metadata.format!==format||!metadata.width||!metadata.height)throw new Error('format_mismatch');
    const result=await image.rotate().toFormat(format,{...(format==='jpeg'?{quality:86}:format==='webp'?{quality:82}:{compressionLevel:8})}).toBuffer();
    if(!result.length||result.length>MAX_BYTES)throw new Error('sanitized_size');
    return result;
  }catch{throw new SupportHttpError(400,'INVALID_IMAGE_CONTENT','Screenshot could not be safely decoded as the selected image type.')}
}

async function loadAttachment(ctx,tenantId,attachmentId){
  const result=await supabaseRequest(ctx,'/rest/v1/support_ticket_attachments',{query:{select:'id,tenant_id,ticket_id,storage_path,original_name,content_type,state',tenant_id:`eq.${tenantId}`,id:`eq.${attachmentId}`,state:'eq.ready',limit:'1'}});
  return result.data?.[0]||null;
}

export default async function handler(req,res){
  try{
    const tenantId=requestTenantId(req),ctx=await requireShop(req);
    if(ctx.tenantId!==tenantId)return sendJson(res,403,{error:'Your account is not authorized for the selected shop.',code:'SUPPORT_ACCESS_DENIED'});
    if(req.method==='GET'){
      const attachmentId=validateUuid(req.query?.attachmentId,'INVALID_ATTACHMENT_ID'),attachment=await loadAttachment(ctx,tenantId,attachmentId);
      if(!attachment)return sendJson(res,404,{error:'Attachment not found.',code:'ATTACHMENT_NOT_FOUND'});
      const objectPath=attachment.storage_path.split('/').map(encodeURIComponent).join('/');
      const signed=await supabaseRequest(ctx,`/object/sign/nitros-support-attachments/${objectPath}`,{method:'POST',body:{expiresIn:60},storage:true});
      const signedUrl=signed.data?.signedURL;
      if(typeof signedUrl!=='string')return sendJson(res,503,{error:'A temporary attachment link could not be created.',code:'ATTACHMENT_LINK_FAILED'});
      const absoluteUrl=signedUrl.startsWith('https://')?signedUrl:`${ctx.projectUrl}/storage/v1${signedUrl.startsWith('/')?signedUrl:`/${signedUrl}`}`;
      return sendJson(res,200,{attachment:{id:attachment.id,name:attachment.original_name,contentType:attachment.content_type,url:absoluteUrl}});
    }
    if(req.method!=='POST')return sendJson(res,405,{error:'Method not allowed',code:'METHOD_NOT_ALLOWED'});
    const body=await jsonBody(req),ticketId=validateUuid(body.ticketId),contentType=String(body.contentType||''),extension=MIME_EXT.get(contentType),base64=body.base64;
    const bytes=await sanitizeScreenshot(contentType,decodeScreenshot(contentType,base64));
    const ticketResult=await supabaseRequest(ctx,'/rest/v1/support_tickets',{query:{select:'id,created_by',tenant_id:`eq.${tenantId}`,id:`eq.${ticketId}`,limit:'1'}}),ticket=ticketResult.data?.[0];
    if(!ticket||(!roleIsAdmin(ctx)&&ticket.created_by!==ctx.userId))return sendJson(res,404,{error:'Ticket not found.',code:'TICKET_NOT_FOUND'});
    const id=randomId(),path=`${tenantId}/${ticketId}/${id}.${extension}`,digest=sha256(bytes),name=safeName(body.name);
    const metadata=await supabaseRequest(ctx,'/rest/v1/support_ticket_attachments',{method:'POST',body:{id,tenant_id:tenantId,ticket_id:ticketId,uploaded_by:ctx.userId,storage_path:path,original_name:name,content_type:contentType,byte_length:bytes.byteLength,sha256:digest,state:'pending'},prefer:'return=representation'});
    if(!Array.isArray(metadata.data)||metadata.data[0]?.id!==id)return sendJson(res,503,{error:'Screenshot upload could not be prepared.',code:'ATTACHMENT_PREPARE_FAILED'});
    let uploaded=false;
    try{
      const encodedPath=path.split('/').map(encodeURIComponent).join('/');
      const response=await fetch(`${ctx.projectUrl}/storage/v1/object/nitros-support-attachments/${encodedPath}`,{method:'POST',headers:{apikey:ctx.key,Authorization:`Bearer ${ctx.bearer}`,'Content-Type':contentType,'x-upsert':'false'},body:bytes});
      if(!response.ok)throw new Error('upload_failed');uploaded=true;
      const ready=await supabaseRequest(ctx,'/rest/v1/rpc/finalize_support_attachment',{method:'POST',body:{p_tenant_id:tenantId,p_attachment_id:id,p_sha256:digest}});
      if(!ready.data?.id||ready.data.state!=='ready')throw new Error('metadata_finalize_failed');
      return sendJson(res,201,{attachment:{id,name,contentType,byteLength:bytes.byteLength,sha256:digest}});
    }catch{
      if(uploaded){const encodedPath=path.split('/').map(encodeURIComponent).join('/');await fetch(`${ctx.projectUrl}/storage/v1/object/nitros-support-attachments/${encodedPath}`,{method:'DELETE',headers:{apikey:ctx.key,Authorization:`Bearer ${ctx.bearer}`}}).catch(()=>{})}
      await supabaseRequest(ctx,'/rest/v1/support_ticket_attachments',{method:'DELETE',query:{id:`eq.${id}`,tenant_id:`eq.${tenantId}`}}).catch(()=>{});
      return sendJson(res,503,{error:'Screenshot upload was not confirmed. The ticket remains available without the attachment.',code:'ATTACHMENT_UPLOAD_FAILED'});
    }
  }catch(error){return handleFailure(res,error)}
}
