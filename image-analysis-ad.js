/* Nitros 10.12.7AD clean-room image analysis. No result persistence or legacy fallback. */
(()=>{'use strict';
  const BUILD='10.12.7AD';
  const MAX_TEXT_BYTES=1500000;
  const CATEGORIES=new Set([
    'Automotive Graph / Diagnostic Graph',
    'Automotive Vehicle / Automotive Component Photograph',
    'Document / Text / Screenshot',
    'General Photograph',
    'Unknown / Analysis Unavailable'
  ]);
  const $=id=>document.getElementById(id);
  const escapeHtml=value=>String(value??'').replace(/[&<>\"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[char]));
  const initialStatus='Attach an image, CSV/text export, or PDF. Every image starts a new uncached analysis run.';
  let activeRun=null;
  let activePreviewUrl='';
  let caseId=createId('CASE');
  let sessionId=createId('SESSION');
  let lastStaleMessage='None';

  function createId(prefix){
    const random=globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return prefix==='AD'?`AD-${random}`:`${prefix}-${random}`;
  }

  function revokePreview(){
    if(!activePreviewUrl)return;
    try{URL.revokeObjectURL(activePreviewUrl)}catch(_){ }
    activePreviewUrl='';
  }

  function clearAnalysisStorage(){
    const legacy=/^nitros.*(?:image.?analysis|classif|automotive|graph.?analysis|ocr.?analysis|analysis.?result|capture.?id|image.?hash)/i;
    try{Object.keys(localStorage).filter(key=>legacy.test(key)).forEach(key=>localStorage.removeItem(key))}catch(_){ }
    try{Object.keys(sessionStorage).filter(key=>legacy.test(key)).forEach(key=>sessionStorage.removeItem(key))}catch(_){ }
    if(globalThis.caches){
      caches.keys().then(names=>Promise.all(names.filter(name=>/(?:image.?analysis|classifier|automotive|graph.?analysis|ocr.?analysis)/i.test(name)).map(name=>caches.delete(name)))).catch(()=>{});
    }
    if(indexedDB?.databases){
      indexedDB.databases().then(databases=>databases.filter(db=>db.name&&/(?:image.?analysis|classifier|automotive|graph.?analysis|ocr.?analysis)/i.test(db.name)).forEach(db=>indexedDB.deleteDatabase(db.name))).catch(()=>{});
    }
  }

  function clearRenderedAnalysis({clearPreview=true}={}){
    if(clearPreview){
      const preview=$('oliverImportPreview');
      if(preview){preview.replaceChildren();preview.classList.remove('open')}
    } else {
      $('adAnalysisResult')?.remove();
      $('adAnalysisStages')?.remove();
    }
    const graphStatus=$('nitrosRuntimeGraphStatus');
    if(graphStatus)graphStatus.textContent='No current image analysis.';
    window.__nitrosCurrentImageAnalysis=null;
    window.__nitrosCurrentImageIdentity=null;
    window.NitrosDeveloperMode=window.NitrosDeveloperMode||{};
    window.NitrosDeveloperMode.imageClassification=null;
  }

  function abortAndDestroy(reason,{newCase=false,clearPreview=true}={}){
    try{activeRun?.controller.abort(reason)}catch(_){ }
    activeRun=null;
    revokePreview();
    clearRenderedAnalysis({clearPreview});
    clearAnalysisStorage();
    if(newCase){caseId=createId('CASE');sessionId=createId('SESSION')}
    updateDeveloper(null,{resetReason:reason,disposition:'NONE'});
  }

  window.resetOcrSessionState=function(reason='New Case'){
    const newCase=/new case|start new vehicle|clear case|start over/i.test(reason);
    abortAndDestroy(reason,{newCase,clearPreview:true});
    ['oliverImportFile','oliverImportCameraFile','diagImageInput'].forEach(id=>{const input=$(id);if(input)input.value=''});
    const status=$('oliverImportStatus');if(status)status.textContent=initialStatus;
    const raw=$('ocrRawText');if(raw)raw.textContent='No OCR scan has been completed.';
    const edit=$('ocrVinEdit');if(edit)edit.value='';
    $('ocrDiagnostic')?.classList.add('hidden');
    window.clearPendingOcrVin?.();
    window.NitrosOCRViewer?.close?.();
    return activeRun?.runId||null;
  };
  window.resetImageAnalysisIdentity=()=>abortAndDestroy('Identity reset',{clearPreview:false});

  function renderStages(run){
    const preview=$('oliverImportPreview');if(!preview)return;
    let host=$('adAnalysisStages');
    if(!host){host=document.createElement('div');host.id='adAnalysisStages';host.className='phase2-result';preview.appendChild(host)}
    host.innerHTML=run.stages.map(stage=>`<div><strong>${escapeHtml(stage.label)}</strong> <span>${escapeHtml(stage.status)}</span></div>`).join('');
  }

  async function stage(run,index,status='RUN'){
    if(!isActive(run))throw abortError();
    run.stages[index].status=status;
    renderStages(run);
    const statusText=$('oliverImportStatus');if(statusText)statusText.textContent=run.stages[index].label;
    await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
    if(!isActive(run))throw abortError();
  }

  function abortError(){const error=new DOMException('Analysis run superseded','AbortError');return error}
  function isActive(run){return activeRun===run&&!run.controller.signal.aborted}

  async function sha256(bytes){
    if(!crypto?.subtle)throw new Error('SHA-256 is unavailable in this browser.');
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  }

  async function decodeDimensions(bytes,mime,signal){
    if(signal.aborted)throw abortError();
    const bitmap=await createImageBitmap(new Blob([bytes],{type:mime||'application/octet-stream'}));
    const dimensions={width:bitmap.width,height:bitmap.height};
    bitmap.close?.();
    if(signal.aborted)throw abortError();
    return dimensions;
  }

  function normalizeVisionResult(raw,run){
    if(!raw||typeof raw!=='object')return unavailableResult(run,'No semantic vision analyzer returned a result.');
    const category=String(raw.category||'');
    if(!CATEGORIES.has(category))return unavailableResult(run,'Semantic vision analyzer returned no supported category.');
    const confidence=Number(raw.confidence);
    const evidence=Array.isArray(raw.evidence)?raw.evidence.filter(item=>typeof item==='string'&&item.trim()).slice(0,20):[];
    if(category!=='Unknown / Analysis Unavailable'&&!evidence.length)return unavailableResult(run,'Semantic vision analyzer returned no positive evidence.');
    return {
      runId:run.runId,
      imageHash:run.imageHash,
      category,
      confidence:Number.isFinite(confidence)?Math.max(0,Math.min(100,Math.round(confidence))):0,
      evidence,
      source:String(raw.source||'NitrosVisionAnalyzer semantic result'),
      routingData:raw.routingData??null
    };
  }

  function unavailableResult(run,reason){
    return {runId:run.runId,imageHash:run.imageHash,category:'Unknown / Analysis Unavailable',confidence:0,evidence:[reason],source:'CURRENT IMAGE BYTES — semantic analyzer unavailable',routingData:null};
  }

  async function classifyCurrentBytes(run){
    const analyzer=window.NitrosVisionAnalyzer;
    if(!analyzer||typeof analyzer.analyzeCurrentImage!=='function')return unavailableResult(run,'No genuine semantic vision analyzer is configured; no object-recognition claims were generated.');
    const requestBytes=run.bytes.slice(0);
    const raw=await analyzer.analyzeCurrentImage({
      bytes:requestBytes,
      blob:new Blob([requestBytes],{type:run.mime}),
      mimeType:run.mime,
      runId:run.runId,
      imageHash:run.imageHash,
      signal:run.controller.signal,
      cache:'no-store'
    });
    return normalizeVisionResult(raw,run);
  }

  async function routeFreshResult(run,result){
    const payload={bytes:run.bytes.slice(0),mimeType:run.mime,runId:run.runId,imageHash:run.imageHash,signal:run.controller.signal,cache:'no-store',classification:result};
    if(result.category==='Automotive Graph / Diagnostic Graph'){
      const analyzer=window.NitrosGraphAnalyzerAD;
      result.route='Graph/OCR';
      result.routeResult=typeof analyzer?.analyzeCurrentImage==='function'?await analyzer.analyzeCurrentImage(payload):{status:'Analysis unavailable',evidence:['No clean-room graph/OCR analyzer is configured.']};
    }else if(result.category==='Document / Text / Screenshot'){
      const analyzer=window.NitrosDocumentAnalyzerAD;
      result.route='Document/OCR';
      result.routeResult=typeof analyzer?.analyzeCurrentImage==='function'?await analyzer.analyzeCurrentImage(payload):{status:'Analysis unavailable',evidence:['No clean-room document/OCR analyzer is configured.']};
    }else if(result.category==='Automotive Vehicle / Automotive Component Photograph'){
      result.route='Automotive visual analysis';
      result.routeResult={status:'Completed',evidence:[...result.evidence]};
    }else if(result.category==='General Photograph'){
      result.route='General visual analysis';
      result.routeResult={status:'Completed',evidence:[...result.evidence]};
    }else{
      result.route='Stopped';result.routeResult={status:'Insufficient evidence',evidence:[...result.evidence]};
    }
    return result;
  }

  function rejectStale(run,result){
    const failed=[];
    if(activeRun!==run)failed.push('active run object');
    if(result?.runId!==activeRun?.runId)failed.push('Analysis Run ID');
    if(result?.imageHash!==activeRun?.imageHash)failed.push('Image SHA-256');
    if(!failed.length)return false;
    lastStaleMessage=`STALE RESULT REJECTED — RESULT NOT DISPLAYED (${failed.join(', ')})`;
    updateDeveloper(activeRun,{disposition:lastStaleMessage});
    return true;
  }

  function renderResult(run,result){
    const preview=$('oliverImportPreview');if(!preview)return;
    $('adAnalysisResult')?.remove();
    const host=document.createElement('div');host.id='adAnalysisResult';host.className='phase2-result';
    host.innerHTML=`<strong>Detected category:</strong> ${escapeHtml(result.category)} <span class="phase2-confidence">${result.confidence}%</span><br><strong>Genuine analyzer evidence:</strong> ${escapeHtml(result.evidence.join('; ')||'None')}<br><strong>Routing:</strong> ${escapeHtml(result.route)} — ${escapeHtml(result.routeResult?.status||'Not started')}<br><strong>Fresh-result verification:</strong> PASS`;
    preview.appendChild(host);
  }

  async function analyzeSelectedImage(file){
    abortAndDestroy('NEW_IMAGE',{clearPreview:true});
    const run={runId:createId('AD'),controller:new AbortController(),bytes:null,imageHash:'',mime:file.type||'application/octet-stream',started:new Date().toISOString(),completed:'',result:null,dimensions:null,stages:[
      {label:'Preparing image…',status:'PENDING'},
      {label:'Hashing image…',status:'PENDING'},
      {label:'Analyzing image contents…',status:'PENDING'},
      {label:'Classifying…',status:'PENDING'},
      {label:'Complete',status:'PENDING'}
    ]};
    activeRun=run;
    updateDeveloper(run,{disposition:'ANALYZING'});
    activePreviewUrl=URL.createObjectURL(file);
    const preview=$('oliverImportPreview');
    if(preview){preview.innerHTML=`<img alt="Current imported image" src="${activePreviewUrl}">`;preview.classList.add('open')}
    try{
      await stage(run,0);
      const sourceBuffer=await file.arrayBuffer();
      if(!isActive(run))throw abortError();
      run.bytes=sourceBuffer.slice(0);
      run.dimensions=await decodeDimensions(run.bytes,run.mime,run.controller.signal);
      await stage(run,1);
      run.imageHash=await sha256(run.bytes);
      if(!isActive(run))throw abortError();
      window.__nitrosCurrentImageIdentity={runId:run.runId,imageHash:run.imageHash};
      updateDeveloper(run,{disposition:'ANALYZING'});
      await stage(run,2);
      const result=await classifyCurrentBytes(run);
      if(!isActive(run)){rejectStale(run,result);return}
      await stage(run,3);
      const routed=await routeFreshResult(run,result);
      if(rejectStale(run,routed))return;
      run.result=routed;run.completed=new Date().toISOString();
      window.__nitrosCurrentImageAnalysis={runId:run.runId,imageHash:run.imageHash,result:routed};
      window.NitrosDeveloperMode=window.NitrosDeveloperMode||{};window.NitrosDeveloperMode.imageClassification=routed;
      renderResult(run,routed);
      await stage(run,4,'PASS');
      updateDeveloper(run,{disposition:'ACCEPTED',verification:'PASS'});
      const status=$('oliverImportStatus');if(status)status.textContent=`Complete — ${routed.category}`;
    }catch(error){
      if(error?.name==='AbortError'){lastStaleMessage='STALE RESULT REJECTED — RESULT NOT DISPLAYED';updateDeveloper(activeRun,{disposition:lastStaleMessage});return}
      if(!isActive(run))return;
      run.completed=new Date().toISOString();
      const failed=unavailableResult(run,`Analysis failed: ${error.message}`);run.result=failed;
      if(!rejectStale(run,failed)){renderResult(run,{...failed,route:'Stopped',routeResult:{status:'Analysis unavailable'}});updateDeveloper(run,{disposition:'FAILED',verification:'PASS'})}
      const status=$('oliverImportStatus');if(status)status.textContent='Unknown / Analysis Unavailable';
    }
  }

  function updateDeveloper(run,extra={}){
    const result=run?.result;
    const values={
      nitrosCaseId:caseId,nitrosAnalysisSessionId:sessionId,nitrosCaptureRequestId:run?.runId||'None',nitrosAnalysisId:run?.runId||'None',
      nitrosCurrentImageSha:run?.imageHash?`${run.imageHash.slice(0,16)}…`:'None',nitrosAnalyzerSource:result?.source||'CURRENT IMAGE BYTES',nitrosResultId:result?.runId||'None',
      nitrosAnalysisStarted:run?.started||'None',nitrosAnalysisCompleted:run?.completed||'None',nitrosResultDisposition:extra.disposition||'NONE',nitrosResetReason:extra.resetReason||'—',
      nitrosActiveClassifier:'NitrosCleanRoomImageAnalysisAD / classifyCurrentBytes / 10.12.7AD',nitrosStaleResultLog:lastStaleMessage,
      nitrosImageClassification:result?.category||'No image classified.',nitrosClassificationConfidence:result?`${result.confidence}%`:'—',nitrosClassificationEvidence:result?.evidence?.join('; ')||'No image classified.',
      nitrosRuntimeGraphStatus:result?.category==='Automotive Graph / Diagnostic Graph'?`${result.routeResult?.status||'Pending'}`:'Graph analysis not started.',
      nitrosPreviousResultReused:'NO',nitrosResultCacheHit:'NO',nitrosFreshVerification:extra.verification||'Pending',nitrosImageDimensions:run?.dimensions?`${run.dimensions.width} × ${run.dimensions.height}`:'None'
    };
    Object.entries(values).forEach(([id,value])=>{const element=$(id);if(element)element.textContent=value});
  }
  window.updateAnalysisSessionDeveloper=()=>updateDeveloper(activeRun);

  function sendFact(text){const input=$('oliverHubInput'),send=$('oliverHubSend');if(!input||!send)return false;input.value=text;send.click();return true}
  function parseTextFile(text,name){const codes=[...new Set((String(text).toUpperCase().match(/\b[PCBU][0-9A-F]{4}\b/g)||[]))].slice(0,24);const summary=[`Imported diagnostic file ${name}`];if(codes.length)summary.push(`DTCs found: ${codes.join(', ')}`);summary.push(String(text).replace(/\s+/g,' ').slice(0,1200));return {summary:summary.join('. '),preview:String(text).slice(0,5000)}}
  function previewData(html){const preview=$('oliverImportPreview');if(preview){preview.innerHTML=html;preview.classList.add('open')}}
  async function handleFile(file){
    if(!file)return;
    if((file.type||'').toLowerCase().startsWith('image/'))return analyzeSelectedImage(file);
    abortAndDestroy('NON_IMAGE_IMPORT',{clearPreview:true});
    if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){previewData(`<pre>PDF attached: ${escapeHtml(file.name)}. Local PDF extraction is unavailable.</pre>`);sendFact(`Attached diagnostic PDF: ${file.name}.`);return}
    if(file.size>MAX_TEXT_BYTES)throw new Error('File is too large for local import.');
    const parsed=parseTextFile(await file.text(),file.name);previewData(`<pre>${escapeHtml(parsed.preview)}</pre>`);sendFact(parsed.summary);
  }

  function findAnchor(){return $('oliverHubSend')?.parentElement||$('oliverHubTranscript')?.parentElement}
  function buildImportUi(){
    if($('oliverDiagnosticImport'))return;
    const anchor=findAnchor();if(!anchor)return;
    const wrap=document.createElement('div');wrap.className='oliver-import-row';wrap.id='oliverDiagnosticImport';
    wrap.innerHTML=`<button id="oliverImportToggle" class="oliver-import-btn" type="button">＋ Import Diagnostic Image or Data</button><div id="oliverImportPanel" class="oliver-import-panel"><div class="oliver-import-actions"><button class="oliver-import-action" id="oliverImportImage" type="button">📷 Automatic Image Analysis</button><button class="oliver-import-action" id="oliverImportData" type="button">📊 CSV / Text Data</button><button class="oliver-import-action" id="oliverImportPdf" type="button">📄 PDF Report</button><button class="oliver-import-action" id="oliverImportCamera" type="button">📱 Use Camera</button></div><input id="oliverImportFile" type="file" hidden><input id="oliverImportCameraFile" type="file" accept="image/*" capture="environment" hidden><div id="oliverImportStatus" class="oliver-import-status">${initialStatus}</div><div id="oliverImportPreview" class="oliver-import-preview"></div></div>`;
    anchor.insertAdjacentElement('afterend',wrap);
    $('oliverImportToggle').onclick=()=>$('oliverImportPanel').classList.toggle('open');
    const fileInput=$('oliverImportFile');
    $('oliverImportImage').onclick=()=>{fileInput.accept='image/*';fileInput.click()};
    $('oliverImportData').onclick=()=>{fileInput.accept='.csv,.txt,.json,text/csv,text/plain,application/json';fileInput.click()};
    $('oliverImportPdf').onclick=()=>{fileInput.accept='.pdf,application/pdf';fileInput.click()};
    $('oliverImportCamera').onclick=()=>$('oliverImportCameraFile').click();
    fileInput.onchange=()=>{const selected=fileInput.files?.[0];fileInput.value='';handleFile(selected).catch(error=>{const status=$('oliverImportStatus');if(status)status.textContent=`Import failed: ${error.message}`})};
    $('oliverImportCameraFile').onchange=event=>{const input=event.currentTarget,selected=input.files?.[0];input.value='';handleFile(selected).catch(error=>{const status=$('oliverImportStatus');if(status)status.textContent=`Camera import failed: ${error.message}`})};
    updateDeveloper(null,{resetReason:'APP_START'});
  }

  function start(){document.title='Nitros Mobile Technician Portal v10.12.7AD — Clean-Room Image Analysis';buildImportUi()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  window.addEventListener('pageshow',()=>setTimeout(start,40));
  new MutationObserver(()=>{if($('oliverHubSend')&&!$('oliverDiagnosticImport'))buildImportUi()}).observe(document.documentElement,{childList:true,subtree:true});
})();
