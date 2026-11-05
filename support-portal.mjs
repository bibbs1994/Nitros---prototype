import { getSession } from './support-auth.mjs';

const DRAFT='nitros_support_compose_handoff_v1',$=id=>document.getElementById(id);
function openCenter(){location.assign('/support-center.html')}
document.addEventListener('click',event=>{
  const inbox=event.target.closest?.('#nitrosSupportInboxButton');
  if(inbox){event.preventDefault();event.stopImmediatePropagation();openCenter();return}
  const send=event.target.closest?.('#nitrosSupportTicketSend');
  if(send){
    event.preventDefault();event.stopImmediatePropagation();
    const description=$('nitrosSupportTicketNote')?.value?.trim()||'';
    if(!description){const status=$('nitrosSupportTicketStatus');if(status){status.className='status bad';status.textContent='Describe the issue before opening the secure ticket form.'}return}
    const hasLegacyScreenshot=Boolean($('nitrosSupportTicketScreenshot')?.files?.length);
    try{sessionStorage.setItem(DRAFT,JSON.stringify({category:$('nitrosSupportTicketCategory')?.value||'Portal issue',subject:$('nitrosSupportTicketCategory')?.value||'Portal support request',description,hasLegacyScreenshot}))}catch{}
    openCenter();
  }
},true);

async function refreshOwnerBadge(){
  const badge=$('supportCenterHomeUnread'),button=$('supportCenterHomeButton');if(!badge||!button)return;button.hidden=true;
  try{
    const session=await getSession();if(!session){badge.hidden=true;return}
    const membershipsResponse=await fetch('/api/support-tenants',{headers:{Authorization:`Bearer ${session.access_token}`,Accept:'application/json'},cache:'no-store'});
    if(!membershipsResponse.ok){badge.hidden=true;return}
    const memberships=(await membershipsResponse.json()).memberships||[],owners=memberships.filter(item=>item.role==='owner');if(!owners.length){badge.hidden=true;return}button.hidden=false;let count=0;
    for(const shop of owners){const response=await fetch('/api/admin-support-tickets',{headers:{Authorization:`Bearer ${session.access_token}`,'X-Nitros-Tenant-Id':shop.tenantId,Accept:'application/json'},cache:'no-store'});if(response.ok){const data=await response.json();count+=Number(data.unreadCount)||0}}
    badge.textContent=count>99?'99+':String(count);badge.hidden=count===0;
    if('setAppBadge'in navigator)await navigator.setAppBadge(count).catch(()=>{});
  }catch{badge.hidden=true}
}
window.addEventListener('pageshow',()=>void refreshOwnerBadge());
window.addEventListener('nitros:support-center-changed',()=>void refreshOwnerBadge());
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refreshOwnerBadge()});
window.addEventListener('storage',event=>{if(event.key==='nitros_support_auth_v1')void refreshOwnerBadge()});
setInterval(()=>{if(document.visibilityState==='visible')void refreshOwnerBadge()},60000);
try{if(new URLSearchParams(location.search).get('compose')==='1'){const draft=JSON.parse(sessionStorage.getItem(DRAFT)||'null');if(draft)window.addEventListener('load',()=>{const category=$('category'),subject=$('subject'),description=$('description');if(category)category.value=draft.category||'Portal issue';if(subject)subject.value=draft.subject||'';if(description)description.value=draft.description||''},{once:true})}}catch{}
