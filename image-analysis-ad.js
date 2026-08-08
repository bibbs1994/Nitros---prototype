/* Nitros 10.12.7AF genuine semantic image analysis with clean-room transaction isolation. */
(()=>{'use strict';
  const BUILD='10.12.7AF';
  const MAX_TEXT_BYTES=1500000;
  const CATEGORIES=new Set([
    'AUTOMOTIVE_GRAPH',
    'AUTOMOTIVE_COMPONENT_OR_VEHICLE',
    'DOCUMENT_OR_TEXT_SCREENSHOT',
    'GENERAL_NON_AUTOMOTIVE_PHOTO',
    'UNKNOWN_OR_ANALYSIS_UNAVAILABLE'
  ]);
  const CATEGORY_LABELS={AUTOMOTIVE_GRAPH:'Automotive Graph / Diagnostic Graph',AUTOMOTIVE_COMPONENT_OR_VEHICLE:'Automotive Component / Vehicle Photo',DOCUMENT_OR_TEXT_SCREENSHOT:'Document / Text / Screenshot',GENERAL_NON_AUTOMOTIVE_PHOTO:'General / Non-Automotive Photograph',UNKNOWN_OR_ANALYSIS_UNAVAILABLE:'Unknown / Analysis Unavailable'};
  const $=id=>document.getElementById(id);
  const escapeHtml=value=>String(value??'').replace(/[&<>\"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[char]));
  const initialStatus='Attach an image, CSV/text export, or PDF. Every image starts a new uncached analysis run.';
  let activeRun=null;
  let activePreviewUrl='';
  let caseId=createId('CASE');
  let sessionId=createId('SESSION');
  let lastStaleMessage='None';
  let lastStaleRejected=false;

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
    if(activeRun&&!activeRun.controller.signal.aborted){
      lastStaleRejected=true;
      lastStaleMessage=`STALE REQUEST INVALIDATED (${reason})`;
      try{activeRun.controller.abort(reason)}catch(_){ }
    }
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

  function bytesToBase64(bytes){
    const view=new Uint8Array(bytes);let binary='';const size=0x8000;
    for(let offset=0;offset<view.length;offset+=size)binary+=String.fromCharCode(...view.subarray(offset,offset+size));
    return btoa(binary);
  }

  function semanticEndpoint(){return document.querySelector('meta[name="nitros-semantic-endpoint"]')?.content?.trim()||'/api/semantic-image-analysis'}

  window.NitrosVisionAnalyzer={
    endpoint:semanticEndpoint(),
    async analyzeCurrentImage({bytes,mimeType,runId,imageHash,signal}){
      const response=await fetch(semanticEndpoint(),{method:'POST',headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({transactionId:runId,imageHash,mimeType,imageBase64:bytesToBase64(bytes)}),signal,cache:'no-store',credentials:'same-origin'});
      let payload=null;try{payload=await response.json()}catch(_){}
      if(!response.ok)throw Object.assign(new Error(payload?.error||`Semantic endpoint returned HTTP ${response.status}.`),{transportStatus:payload?.transportStatus||response.status});
      return {...payload?.semanticResult,transactionId:payload?.transactionId,imageHash:payload?.imageHash,source:payload?.analyzer||'Secure semantic analyzer',transportStatus:payload?.transportStatus||response.status};
    }
  };

  async function decodeDimensions(bytes,mime,signal){
    if(signal.aborted)throw abortError();
    const bitmap=await createImageBitmap(new Blob([bytes],{type:mime||'application/octet-stream'}));
    const dimensions={width:bitmap.width,height:bitmap.height};
    bitmap.close?.();
    if(signal.aborted)throw abortError();
    return dimensions;
  }

  function stringArray(raw,name){if(!Array.isArray(raw)||raw.some(item=>typeof item!=='string'))throw new Error(`Semantic response field ${name} is invalid.`);return raw.map(item=>item.trim()).filter(Boolean).slice(0,24)}
  function normalizeVisionResult(raw,run){
    if(!raw||typeof raw!=='object')throw new Error('No semantic vision analyzer returned a structured result.');
    if(raw.transactionId!==run.runId)throw new Error('Semantic result transaction ID does not match the current image.');
    if(raw.imageHash!==run.imageHash)throw new Error('Semantic result image hash does not match the current image.');
    const category=String(raw.category||'');
    if(!CATEGORIES.has(category))throw new Error('Semantic vision analyzer returned no supported category.');
    const confidence=raw.confidence===null?null:Number(raw.confidence);
    if(confidence!==null&&(!Number.isFinite(confidence)||confidence<0||confidence>100))throw new Error('Semantic confidence is invalid.');
    const evidence=stringArray(raw.evidence,'evidence'),objects=stringArray(raw.objects,'objects'),automotiveEvidence=stringArray(raw.automotiveEvidence,'automotiveEvidence'),graphEvidence=stringArray(raw.graphEvidence,'graphEvidence'),documentEvidence=stringArray(raw.documentEvidence,'documentEvidence');
    if(category!=='UNKNOWN_OR_ANALYSIS_UNAVAILABLE'&&!evidence.length)throw new Error('Semantic vision analyzer returned no positive evidence.');
    if(category==='AUTOMOTIVE_GRAPH'&&graphEvidence.length<2)throw new Error('Graph classification lacks independent structural evidence.');
    if(category==='AUTOMOTIVE_COMPONENT_OR_VEHICLE'&&!automotiveEvidence.length)throw new Error('Automotive classification lacks positive visual evidence.');
    return {runId:raw.transactionId,imageHash:raw.imageHash,category,confidence:confidence===null?null:Math.round(confidence),objects,evidence,description:String(raw.description||'').trim(),automotiveEvidence,graphEvidence,documentEvidence,source:String(raw.source||'NitrosVisionAnalyzer semantic result'),transportStatus:raw.transportStatus??null,routingData:raw.routingData??null};
  }

  function unavailableResult(run,reason){
    return {runId:run.runId,imageHash:run.imageHash,category:'UNKNOWN_OR_ANALYSIS_UNAVAILABLE',confidence:null,objects:[],evidence:[reason],description:'Semantic image analysis could not be completed.',automotiveEvidence:[],graphEvidence:[],documentEvidence:[],source:'Secure semantic analyzer unavailable',transportStatus:run.analyzer?.transportStatus||null,routingData:null};
  }

  async function classifyCurrentBytes(run){
    const analyzer=window.NitrosVisionAnalyzer;
    if(!analyzer||typeof analyzer.analyzeCurrentImage!=='function')throw new Error('No genuine semantic vision analyzer is configured; no object-recognition claims were generated.');
    const requestBytes=run.bytes.slice(0);
    run.analyzer.requestStarted=new Date().toISOString();
    const raw=await analyzer.analyzeCurrentImage({
      bytes:requestBytes,
      blob:new Blob([requestBytes],{type:run.mime}),
      mimeType:run.mime,
      runId:run.runId,
      imageHash:run.imageHash,
      signal:run.controller.signal,
      cache:'no-store'
    });
    run.analyzer.requestCompleted=new Date().toISOString();run.analyzer.transportStatus=raw?.transportStatus??null;run.analyzer.resultReceived=true;
    const normalized=normalizeVisionResult(raw,run);run.analyzer.responseValidated=true;return normalized;
  }

  async function routeFreshResult(run,result){
    const payload={bytes:run.bytes.slice(0),mimeType:run.mime,runId:run.runId,imageHash:run.imageHash,signal:run.controller.signal,cache:'no-store',classification:result};
    if(result.category==='AUTOMOTIVE_GRAPH'){
      const analyzer=window.NitrosGraphAnalyzerAD;
      result.route='Graph/OCR';
      result.routeResult=typeof analyzer?.analyzeCurrentImage==='function'?await analyzer.analyzeCurrentImage(payload):{status:'Analysis unavailable',evidence:['No clean-room graph/OCR analyzer is configured.']};
    }else if(result.category==='DOCUMENT_OR_TEXT_SCREENSHOT'){
      const analyzer=window.NitrosDocumentAnalyzerAD;
      result.route='Document/OCR';
      result.routeResult=typeof analyzer?.analyzeCurrentImage==='function'?await analyzer.analyzeCurrentImage(payload):{status:'Analysis unavailable',evidence:['No clean-room document/OCR analyzer is configured.']};
    }else if(result.category==='AUTOMOTIVE_COMPONENT_OR_VEHICLE'){
      result.route='Automotive visual analysis';
      result.routeResult={status:'Completed',evidence:[...result.evidence]};
    }else if(result.category==='GENERAL_NON_AUTOMOTIVE_PHOTO'){
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
    if(run?.analyzer)run.analyzer.staleRejected=true;
    lastStaleRejected=true;
    lastStaleMessage=`STALE RESULT REJECTED — RESULT NOT DISPLAYED (${failed.join(', ')})`;
    updateDeveloper(activeRun,{disposition:lastStaleMessage});
    return true;
  }

  function renderResult(run,result){
    const preview=$('oliverImportPreview');if(!preview)return;
    $('adAnalysisResult')?.remove();
    const host=document.createElement('div');host.id='adAnalysisResult';host.className='phase2-result';
    const confidence=result.confidence===null?'Confidence unavailable':`${result.confidence}%`;
    host.innerHTML=`<strong>Detected category:</strong> ${escapeHtml(CATEGORY_LABELS[result.category]||result.category)}<br><strong>Confidence:</strong> <span class="phase2-confidence">${escapeHtml(confidence)}</span><br><strong>Observed objects:</strong> ${escapeHtml(result.objects?.join(', ')||'None reported')}<br><strong>Analyzer evidence:</strong> ${escapeHtml(result.evidence.join('; ')||'None')}<br><strong>Routing:</strong> ${escapeHtml(result.route)} — ${escapeHtml(result.routeResult?.status||'Not started')}<br><strong>Fresh-result verification:</strong> ${result.category==='UNKNOWN_OR_ANALYSIS_UNAVAILABLE'?'FAIL':'PASS'}`;
    preview.appendChild(host);
  }

  async function analyzeSelectedImage(file){
    abortAndDestroy('NEW_IMAGE',{clearPreview:true});
    const run={runId:createId('AD'),controller:new AbortController(),bytes:null,imageHash:'',mime:file.type||'application/octet-stream',started:new Date().toISOString(),completed:'',result:null,dimensions:null,analysisError:'',analyzer:{configured:Boolean(window.NitrosVisionAnalyzer?.analyzeCurrentImage),requestStarted:'',requestCompleted:'',transportStatus:null,resultReceived:false,responseValidated:false,staleRejected:false},stages:[
      {label:'Preparing image…',status:'PENDING'},
      {label:'Hashing image…',status:'PENDING'},
      {label:'Sending for semantic analysis…',status:'PENDING'},
      {label:'Analyzing image contents…',status:'PENDING'},
      {label:'Classifying…',status:'PENDING'},
      {label:'Fresh-result verification…',status:'PENDING'},
      {label:'Complete…',status:'PENDING'}
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
      await stage(run,0,'PASS');
      await stage(run,1,'RUN');
      run.imageHash=await sha256(run.bytes);
      if(!isActive(run))throw abortError();
      window.__nitrosCurrentImageIdentity={runId:run.runId,imageHash:run.imageHash};
      updateDeveloper(run,{disposition:'ANALYZING'});
      await stage(run,1,'PASS');
      await stage(run,2,'RUN');
      const semanticPromise=classifyCurrentBytes(run);
      await new Promise(resolve=>setTimeout(resolve,0));
      await stage(run,2,'PASS');
      await stage(run,3,'RUN');
      const result=await semanticPromise;
      await stage(run,3,'PASS');
      if(!isActive(run)){rejectStale(run,result);return}
      await stage(run,4,'RUN');
      const routed=await routeFreshResult(run,result);
      await stage(run,4,'PASS');
      await stage(run,5,'RUN');
      if(rejectStale(run,routed))return;
      await stage(run,5,'PASS');
      run.result=routed;run.completed=new Date().toISOString();
      window.__nitrosCurrentImageAnalysis={runId:run.runId,imageHash:run.imageHash,result:routed};
      window.NitrosDeveloperMode=window.NitrosDeveloperMode||{};window.NitrosDeveloperMode.imageClassification=routed;
      renderResult(run,routed);
      await stage(run,6,'PASS');
      updateDeveloper(run,{disposition:'ACCEPTED',verification:'PASS'});
      const status=$('oliverImportStatus');if(status)status.textContent=`Complete — ${CATEGORY_LABELS[routed.category]||routed.category}`;
    }catch(error){
      if(error?.name==='AbortError'){lastStaleRejected=true;lastStaleMessage='STALE RESULT REJECTED — RESULT NOT DISPLAYED';updateDeveloper(activeRun,{disposition:lastStaleMessage});return}
      if(!isActive(run))return;
      run.completed=new Date().toISOString();run.analysisError=String(error?.message||error);run.analyzer.transportStatus=error?.transportStatus||run.analyzer.transportStatus;
      const runningStage=run.stages.find(item=>item.status==='RUN');if(runningStage)runningStage.status='FAIL';run.stages[5].status='FAIL';run.stages[6].status='FAIL';renderStages(run);
      const failed=unavailableResult(run,`Analysis failed: ${error.message}`);run.result=failed;
      if(!rejectStale(run,failed)){renderResult(run,{...failed,route:'Stopped',routeResult:{status:'Insufficient evidence'}});updateDeveloper(run,{disposition:'FAILED',verification:'FAIL'})}
      const status=$('oliverImportStatus');if(status)status.textContent='Unknown / Analysis Unavailable';
    }
  }

  function updateDeveloper(run,extra={}){
    const result=run?.result;
    const values={
      nitrosCaseId:caseId,nitrosAnalysisSessionId:sessionId,nitrosCaptureRequestId:run?.runId||'None',nitrosAnalysisId:run?.runId||'None',
      nitrosCurrentImageSha:run?.imageHash?`${run.imageHash.slice(0,16)}…`:'None',nitrosAnalyzerSource:result?.source||'CURRENT IMAGE BYTES',nitrosResultId:result?.runId||'None',
      nitrosAnalysisStarted:run?.started||'None',nitrosAnalysisCompleted:run?.completed||'None',nitrosResultDisposition:extra.disposition||'NONE',nitrosResetReason:extra.resetReason||'—',
      nitrosActiveClassifier:'NitrosSemanticImageAnalysisAF / secure pixel endpoint / 10.12.7AF',nitrosStaleResultLog:lastStaleMessage,
      nitrosImageClassification:result?CATEGORY_LABELS[result.category]||result.category:'No image classified.',nitrosClassificationConfidence:result?(result.confidence===null?'Confidence unavailable':`${result.confidence}%`):'—',nitrosClassificationEvidence:result?.evidence?.join('; ')||'No image classified.',
      nitrosRuntimeGraphStatus:result?.category==='AUTOMOTIVE_GRAPH'?`${result.routeResult?.status||'Pending'}`:'Graph analysis not started.',
      nitrosSemanticConfigured:run?.analyzer?.configured?'YES':'NO',nitrosAnalyzerRequestStarted:run?.analyzer?.requestStarted||'None',nitrosAnalyzerRequestCompleted:run?.analyzer?.requestCompleted||'None',nitrosAnalyzerTransportStatus:run?.analyzer?.transportStatus??'None',nitrosSemanticResultReceived:run?.analyzer?.resultReceived?'YES':'NO',nitrosResponseValidated:run?.analyzer?.responseValidated?'YES':'NO',nitrosResultTransactionMatch:result?(result.runId===run?.runId?'PASS':'FAIL'):'Pending',nitrosResultHashMatch:result?(result.imageHash===run?.imageHash?'PASS':'FAIL'):'Pending',nitrosStaleResultRejected:lastStaleRejected?'YES':'NO',nitrosFinalCategory:result?CATEGORY_LABELS[result.category]||result.category:'None',nitrosSemanticRouting:result?.route||'Not started',nitrosAnalysisError:run?.analysisError||'NONE',
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

  function start(){document.title='Nitros Mobile Technician Portal v10.12.7AF — Genuine Semantic Image Analysis';buildImportUi()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  window.addEventListener('pageshow',()=>setTimeout(start,40));
  new MutationObserver(()=>{if($('oliverHubSend')&&!$('oliverDiagnosticImport'))buildImportUi()}).observe(document.documentElement,{childList:true,subtree:true});
})();
