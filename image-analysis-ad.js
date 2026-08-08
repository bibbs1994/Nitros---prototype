/* Nitros 10.12.7AG semantic transport diagnostics with clean-room transaction isolation. */
(()=>{'use strict';
  const BUILD='10.12.7AG';
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

  function elapsed(start){return Math.max(0,Math.round(performance.now()-start))}
  function sanitizeDiagnosticText(value,limit=2000){
    if(value===undefined||value===null)return '';
    return String(value)
      .replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]')
      .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]+/g,'[REDACTED_API_KEY]')
      .replace(/OPENAI_API_KEY\s*[=:]\s*\S+/gi,'OPENAI_API_KEY=[REDACTED]')
      .replace(/data:image\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi,'[REDACTED_IMAGE_DATA]')
      .replace(/\b[A-Za-z0-9+/]{256,}={0,2}\b/g,'[REDACTED_ENCODED_DATA]')
      .slice(0,limit);
  }
  function safeEndpoint(value){
    try{const url=new URL(value,document.baseURI);return `${url.origin}${url.pathname}${url.search?'?[REDACTED_QUERY]':''}`}
    catch(_){return sanitizeDiagnosticText(value,300)}
  }
  function safeErrorResponseBody(payload){
    if(!payload||typeof payload!=='object'||Array.isArray(payload))return '[OMITTED: response body was not safe structured JSON]';
    const safe={};
    if(typeof payload.error==='string')safe.error=sanitizeDiagnosticText(payload.error,500);
    if(typeof payload.code==='string')safe.code=sanitizeDiagnosticText(payload.code,120);
    if(Number.isFinite(payload.transportStatus))safe.transportStatus=payload.transportStatus;
    return Object.keys(safe).length?JSON.stringify(safe):'[OMITTED: response body may contain sensitive content]';
  }
  function classifyTransportError(error,{endpoint,responseReceived=false}={}){
    const name=String(error?.name||'Error'),message=String(error?.message||error||''),combined=`${name} ${message}`.toLowerCase();
    if(name==='AbortError'||/\babort(?:ed)?\b/.test(combined))return {category:'REQUEST_ABORTED',layer:'Browser request cancellation',aborted:true};
    if(name==='TimeoutError'||/\b(?:timeout|timed out)\b/.test(combined))return {category:'TIMEOUT_ERROR',layer:'Browser or network timeout',timeout:true};
    if(/invalid url|malformed url|failed to parse url/.test(combined))return {category:'CONFIGURATION_ERROR',layer:'Endpoint URL validation',malformedUrl:true};
    if(/\bcors\b|cross-origin|access-control-allow-origin/.test(combined))return {category:'CORS_ERROR',layer:'Browser CORS enforcement',corsFailure:true};
    if(/dns|enotfound|name not resolved/.test(combined))return {category:'NETWORK_ERROR',layer:'DNS resolution',dnsFailure:true,networkFailure:true};
    if(name==='TypeError'||/load failed|failed to fetch|networkerror|network request failed|connection/.test(combined)){
      let crossOrigin=false;try{crossOrigin=new URL(endpoint,document.baseURI).origin!==location.origin}catch(_){}
      return {category:'NETWORK_ERROR',layer:crossOrigin?'Browser fetch / CORS / DNS / connectivity (browser supplied no HTTP response)':'Browser fetch / network connectivity',networkFailure:true,corsPossible:crossOrigin};
    }
    return {category:'UNKNOWN_TRANSPORT_ERROR',layer:responseReceived?'Semantic response processing':'Client-side request execution'};
  }
  function diagnosticError(message,category,details={}){
    const error=new Error(message);error.diagnosticCategory=category;Object.assign(error,details);return error;
  }
  function tagDiagnosticError(error,category,details={}){try{Object.assign(error,{diagnosticCategory:category,...details})}catch(_){}return error}
  function createSemanticDiagnostic(mimeType){
    return {requestId:createId('SA'),stage:'CREATED',outcome:'PENDING',endpoint:'Not configured',method:'POST',imagePrepared:false,mimeType:mimeType||'application/octet-stream',payloadGenerated:false,encodedPayloadBytes:0,requestBodyBytes:0,endpointConfigured:false,fetchStarted:false,responseReceived:false,httpStatus:null,httpStatusText:'',responseType:'',responseContentType:'',safeResponseBody:'Not received',parseResult:'NOT_STARTED',parsedErrorMessage:'',jsonParseFailure:'',errorCategory:'',errorName:'',errorMessage:'',errorCode:'',networkFailure:false,dnsFailure:false,corsFailure:false,corsPossible:false,timeout:false,aborted:false,malformedUrl:false,missingEndpoint:false,missingApiConfiguration:false,unsupportedRequestBody:false,clientException:false,likelyLayer:'Not started',imagePreparationMs:null,payloadEncodingMs:null,requestStartMs:null,responseReceivedMs:null,responseParsingMs:null,totalMs:null,startedAt:new Date().toISOString(),completedAt:''};
  }
  function diagnosticSize(bytes){if(!Number.isFinite(bytes)||bytes<=0)return '0 B';const mb=bytes/(1024*1024);return mb>=0.1?`${mb.toFixed(2)} MB`:`${(bytes/1024).toFixed(1)} KB`}
  function formatTransportDiagnostic(diag){
    if(!diag)return 'No semantic request has started.';
    const pass=value=>value?'PASS':diag.outcome==='FAILED'?'FAIL':'PENDING';
    const responseLine=diag.responseReceived?'PASS':'FAIL — NO HTTP RESPONSE RECEIVED';
    return [
      `Semantic Analysis: ${diag.outcome==='FAILED'?'SEMANTIC ANALYSIS FAILED':diag.outcome==='SUCCEEDED'?'SEMANTIC ANALYSIS SUCCEEDED':'IN PROGRESS'}`,
      `Semantic Request ID: ${diag.requestId||'None'}`,
      `Current Stage: ${diag.stage||'None'}`,
      '',
      `1. Image prepared: ${pass(diag.imagePrepared)}`,
      `2. MIME type: ${diag.mimeType||'Unknown'}`,
      `3. Encoded payload: ${pass(diag.payloadGenerated)}`,
      `4. Encoded payload size: ${diagnosticSize(diag.encodedPayloadBytes)}`,
      `5. Endpoint configured: ${pass(diag.endpointConfigured)}`,
      `   Request URL: ${diag.endpoint||'Not configured'}`,
      `   HTTP Method: ${diag.method||'POST'}`,
      `6. Request started: ${pass(diag.fetchStarted)}`,
      `7. HTTP response received: ${responseLine}`,
      `8. Error category: ${diag.errorCategory||'None'}`,
      `9. Error type: ${diag.errorName||'None'}`,
      `10. Error message: ${diag.errorMessage||'None'}`,
      '',
      `HTTP Status: ${diag.httpStatus??'None'}${diag.httpStatusText?` ${diag.httpStatusText}`:''}`,
      `Response Type: ${diag.responseType||'None'}`,
      `Response Content-Type: ${diag.responseContentType||'None'}`,
      `Response Body: ${diag.safeResponseBody||'None'}`,
      `Parse Result: ${diag.parseResult||'NOT_STARTED'}${diag.jsonParseFailure?` — ${diag.jsonParseFailure}`:''}`,
      `Parsed Error: ${diag.parsedErrorMessage||'None'}`,
      `Likely Transport Layer: ${diag.likelyLayer||'Unknown'}`,
      `Network failure: ${diag.networkFailure?'YES':'NO'} | DNS detectable: ${diag.dnsFailure?'YES':'NO'} | CORS detected/possible: ${diag.corsFailure?'DETECTED':diag.corsPossible?'POSSIBLE':'NO'}`,
      `Timeout: ${diag.timeout?'YES':'NO'} | Aborted: ${diag.aborted?'YES':'NO'} | Malformed URL: ${diag.malformedUrl?'YES':'NO'}`,
      `Missing endpoint: ${diag.missingEndpoint?'YES':'NO'} | Missing API configuration: ${diag.missingApiConfiguration?'YES':'NO'} | Unsupported body: ${diag.unsupportedRequestBody?'YES':'NO'}`,
      '',
      `Timing — image preparation: ${diag.imagePreparationMs??'Pending'} ms`,
      `Timing — payload encoding: ${diag.payloadEncodingMs??'Pending'} ms`,
      `Timing — request start: ${diag.requestStartMs??'Pending'} ms`,
      `Timing — response received: ${diag.responseReceivedMs??'No response'} ms`,
      `Timing — response parsing: ${diag.responseParsingMs??'Pending'} ms`,
      `Timing — total semantic attempt: ${diag.totalMs??'Pending'} ms`
    ].join('\n');
  }

  window.NitrosVisionAnalyzer={
    endpoint:semanticEndpoint(),
    async analyzeCurrentImage({bytes,mimeType,runId,imageHash,signal,diagnostic,onDiagnostic}){
      const attemptStarted=performance.now(),mark=changes=>{Object.assign(diagnostic,changes);onDiagnostic?.()};
      const endpoint=semanticEndpoint();mark({stage:'ENDPOINT_CONFIGURATION',endpoint:safeEndpoint(endpoint),endpointConfigured:Boolean(endpoint)});
      if(!endpoint){mark({outcome:'FAILED',errorCategory:'CONFIGURATION_ERROR',errorName:'ConfigurationError',errorMessage:'Semantic endpoint is not configured.',missingEndpoint:true,likelyLayer:'Endpoint configuration',totalMs:elapsed(attemptStarted),completedAt:new Date().toISOString()});throw diagnosticError('Semantic endpoint is not configured.','CONFIGURATION_ERROR')}
      let requestUrl;
      try{requestUrl=new URL(endpoint,document.baseURI);if(!/^https?:$/.test(requestUrl.protocol))throw new TypeError('Semantic endpoint must use HTTP or HTTPS.')}
      catch(error){mark({outcome:'FAILED',errorCategory:'CONFIGURATION_ERROR',errorName:error.name,errorMessage:sanitizeDiagnosticText(error.message),malformedUrl:true,likelyLayer:'Endpoint URL validation',totalMs:elapsed(attemptStarted),completedAt:new Date().toISOString()});throw tagDiagnosticError(error,'CONFIGURATION_ERROR')}
      let imageBase64,requestBody;
      const encodeStarted=performance.now();mark({stage:'PAYLOAD_ENCODING'});
      try{
        if(!(bytes instanceof ArrayBuffer)||!bytes.byteLength)throw diagnosticError('Image request body is empty or unsupported.','PAYLOAD_ERROR',{unsupportedRequestBody:true});
        imageBase64=bytesToBase64(bytes);
        requestBody=JSON.stringify({transactionId:runId,imageHash,mimeType,imageBase64});
        mark({payloadGenerated:true,encodedPayloadBytes:imageBase64.length,requestBodyBytes:new TextEncoder().encode(requestBody).byteLength,payloadEncodingMs:elapsed(encodeStarted)});
      }catch(error){mark({outcome:'FAILED',errorCategory:error.diagnosticCategory||'PAYLOAD_ERROR',errorName:error.name,errorMessage:sanitizeDiagnosticText(error.message),unsupportedRequestBody:Boolean(error.unsupportedRequestBody),clientException:true,likelyLayer:'Client payload generation',payloadEncodingMs:elapsed(encodeStarted),totalMs:elapsed(attemptStarted),completedAt:new Date().toISOString()});throw error}
      let response;
      try{
        mark({stage:'FETCH_EXECUTION',fetchStarted:true,requestStarted:new Date().toISOString(),requestStartMs:elapsed(attemptStarted)});
        response=await fetch(requestUrl.href,{method:'POST',headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:requestBody,signal,cache:'no-store',credentials:'same-origin'});
      }catch(error){
        const classification=classifyTransportError(error,{endpoint:requestUrl.href,responseReceived:false});
        mark({...classification,outcome:'FAILED',stage:'FETCH_FAILED',errorCategory:error.diagnosticCategory||classification.category,errorName:sanitizeDiagnosticText(error.name||'Error'),errorMessage:sanitizeDiagnosticText(error.message||error),errorCode:sanitizeDiagnosticText(error.code||''),clientException:true,responseReceived:false,safeResponseBody:'NO HTTP RESPONSE RECEIVED',totalMs:elapsed(attemptStarted),completedAt:new Date().toISOString()});
        throw tagDiagnosticError(error,error.diagnosticCategory||classification.category);
      }
      mark({stage:'HTTP_RESPONSE_RECEIVED',responseReceived:true,httpStatus:response.status,httpStatusText:sanitizeDiagnosticText(response.statusText,120),responseType:sanitizeDiagnosticText(response.type||'',80),responseContentType:sanitizeDiagnosticText(response.headers.get('content-type')||'',200),responseReceivedMs:elapsed(attemptStarted),transportStatus:response.status,likelyLayer:'HTTP response received'});
      const parseStarted=performance.now();let responseText='',payload=null;
      try{responseText=await response.text();if(responseText)payload=JSON.parse(responseText);mark({parseResult:responseText?'JSON_PARSE_PASS':'EMPTY_RESPONSE',responseParsingMs:elapsed(parseStarted),safeResponseBody:response.ok?'[OMITTED: successful response may contain image-derived content]':safeErrorResponseBody(payload)})}
      catch(error){mark({outcome:'FAILED',stage:'RESPONSE_PARSE_FAILED',errorCategory:'RESPONSE_PARSE_ERROR',errorName:sanitizeDiagnosticText(error.name),errorMessage:sanitizeDiagnosticText(error.message),jsonParseFailure:sanitizeDiagnosticText(error.message),parseResult:'JSON_PARSE_FAIL',responseParsingMs:elapsed(parseStarted),safeResponseBody:'[OMITTED: unparsed response body may contain sensitive content]',likelyLayer:'HTTP response parsing',totalMs:elapsed(attemptStarted),completedAt:new Date().toISOString()});throw tagDiagnosticError(error,'RESPONSE_PARSE_ERROR',{transportStatus:response.status})}
      if(!response.ok){
        const missingApi=payload?.code==='SERVICE_UNAVAILABLE',category=missingApi?'CONFIGURATION_ERROR':'HTTP_ERROR',message=payload?.error||`Semantic endpoint returned HTTP ${response.status}.`;
        mark({outcome:'FAILED',stage:'HTTP_ERROR',errorCategory:category,errorName:'SemanticHttpError',errorMessage:sanitizeDiagnosticText(message),parsedErrorMessage:sanitizeDiagnosticText(message),errorCode:sanitizeDiagnosticText(payload?.code||''),missingApiConfiguration:missingApi,likelyLayer:missingApi?'Server API configuration':'Semantic endpoint HTTP response',totalMs:elapsed(attemptStarted),completedAt:new Date().toISOString()});
        throw diagnosticError(message,category,{transportStatus:payload?.transportStatus||response.status});
      }
      mark({outcome:'SUCCEEDED',stage:'SEMANTIC_RESPONSE_RECEIVED',parseResult:'JSON_PARSE_PASS',totalMs:elapsed(attemptStarted),completedAt:new Date().toISOString()});
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
    if(!analyzer||typeof analyzer.analyzeCurrentImage!=='function'){
      Object.assign(run.analyzer,{outcome:'FAILED',stage:'CONFIGURATION_FAILED',errorCategory:'CONFIGURATION_ERROR',errorName:'ConfigurationError',errorMessage:'No genuine semantic vision analyzer is configured.',missingEndpoint:true,likelyLayer:'Client analyzer configuration',completedAt:new Date().toISOString()});
      updateDeveloper(run,{disposition:'FAILED'});throw diagnosticError('No genuine semantic vision analyzer is configured; no object-recognition claims were generated.','CONFIGURATION_ERROR');
    }
    const requestBytes=run.bytes.slice(0);
    run.analyzer.requestStarted=new Date().toISOString();
    const raw=await analyzer.analyzeCurrentImage({
      bytes:requestBytes,
      blob:new Blob([requestBytes],{type:run.mime}),
      mimeType:run.mime,
      runId:run.runId,
      imageHash:run.imageHash,
      signal:run.controller.signal,
      diagnostic:run.analyzer,
      onDiagnostic:()=>updateDeveloper(run,{disposition:'ANALYZING'}),
      cache:'no-store'
    });
    run.analyzer.requestCompleted=new Date().toISOString();run.analyzer.transportStatus=raw?.transportStatus??null;run.analyzer.resultReceived=true;
    try{const normalized=normalizeVisionResult(raw,run);run.analyzer.responseValidated=true;run.analyzer.stage='SEMANTIC_RESPONSE_VALIDATED';return normalized}
    catch(error){Object.assign(run.analyzer,{outcome:'FAILED',stage:'SEMANTIC_VALIDATION_FAILED',errorCategory:'SEMANTIC_API_ERROR',errorName:sanitizeDiagnosticText(error.name),errorMessage:sanitizeDiagnosticText(error.message),likelyLayer:'Semantic response validation',completedAt:new Date().toISOString()});throw tagDiagnosticError(error,'SEMANTIC_API_ERROR')}
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
    const mime=file.type||'application/octet-stream',analyzer=createSemanticDiagnostic(mime);
    Object.assign(analyzer,{configured:Boolean(window.NitrosVisionAnalyzer?.analyzeCurrentImage),staleRejected:false,resultReceived:false,responseValidated:false,transportStatus:null,requestStarted:'',requestCompleted:''});
    const run={runId:createId('AD'),controller:new AbortController(),bytes:null,imageHash:'',mime,started:new Date().toISOString(),completed:'',result:null,dimensions:null,analysisError:'',analyzer,stages:[
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
      const preparationStarted=performance.now();run.analyzer.stage='IMAGE_PREPARATION';updateDeveloper(run,{disposition:'ANALYZING'});
      await stage(run,0);
      const sourceBuffer=await file.arrayBuffer();
      if(!isActive(run))throw abortError();
      run.bytes=sourceBuffer.slice(0);
      run.dimensions=await decodeDimensions(run.bytes,run.mime,run.controller.signal);
      await stage(run,0,'PASS');
      await stage(run,1,'RUN');
      run.imageHash=await sha256(run.bytes);
      if(!isActive(run))throw abortError();
      Object.assign(run.analyzer,{imagePrepared:true,imagePreparationMs:elapsed(preparationStarted),mimeType:run.mime,stage:'IMAGE_PREPARED'});
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
      run.result=routed;run.completed=new Date().toISOString();run.analyzer.outcome='SUCCEEDED';run.analyzer.stage='COMPLETE';run.analyzer.requestCompleted=run.analyzer.completedAt||run.completed;
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
      if(!run.analyzer.errorCategory){const classification=classifyTransportError(error,{endpoint:run.analyzer.endpoint,responseReceived:run.analyzer.responseReceived});Object.assign(run.analyzer,classification,{outcome:'FAILED',stage:'CLIENT_EXCEPTION',errorCategory:error?.diagnosticCategory||classification.category,errorName:sanitizeDiagnosticText(error?.name||'Error'),errorMessage:sanitizeDiagnosticText(error?.message||error),errorCode:sanitizeDiagnosticText(error?.code||''),clientException:true,completedAt:run.completed})}
      run.analyzer.totalMs=run.analyzer.totalMs??Math.max(0,new Date(run.completed)-new Date(run.started));run.analyzer.requestCompleted=run.completed;
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
      nitrosActiveClassifier:'NitrosSemanticImageAnalysisAG / transport diagnostic / 10.12.7AG',nitrosStaleResultLog:lastStaleMessage,
      nitrosImageClassification:result?CATEGORY_LABELS[result.category]||result.category:'No image classified.',nitrosClassificationConfidence:result?(result.confidence===null?'Confidence unavailable':`${result.confidence}%`):'—',nitrosClassificationEvidence:result?.evidence?.join('; ')||'No image classified.',
      nitrosRuntimeGraphStatus:result?.category==='AUTOMOTIVE_GRAPH'?`${result.routeResult?.status||'Pending'}`:'Graph analysis not started.',
      nitrosSemanticConfigured:run?.analyzer?.configured?'YES':'NO',nitrosAnalyzerRequestStarted:run?.analyzer?.requestStarted||'None',nitrosAnalyzerRequestCompleted:run?.analyzer?.requestCompleted||'None',nitrosAnalyzerTransportStatus:run?.analyzer?.transportStatus??'None',nitrosSemanticResultReceived:run?.analyzer?.resultReceived?'YES':'NO',nitrosResponseValidated:run?.analyzer?.responseValidated?'YES':'NO',nitrosResultTransactionMatch:result?(result.runId===run?.runId?'PASS':'FAIL'):'Pending',nitrosResultHashMatch:result?(result.imageHash===run?.imageHash?'PASS':'FAIL'):'Pending',nitrosStaleResultRejected:lastStaleRejected?'YES':'NO',nitrosFinalCategory:result?CATEGORY_LABELS[result.category]||result.category:'None',nitrosSemanticRouting:result?.route||'Not started',nitrosAnalysisError:run?.analysisError||'NONE',nitrosSemanticRequestId:run?.analyzer?.requestId||'None',nitrosSemanticErrorCategory:run?.analyzer?.errorCategory||'None',nitrosSemanticTransportDiagnostic:formatTransportDiagnostic(run?.analyzer),
      nitrosPreviousResultReused:'NO',nitrosResultCacheHit:'NO',nitrosFreshVerification:extra.verification||'Pending',nitrosImageDimensions:run?.dimensions?`${run.dimensions.width} × ${run.dimensions.height}`:'None'
    };
    Object.entries(values).forEach(([id,value])=>{const element=$(id);if(element)element.textContent=value});
    window.NitrosDeveloperMode=window.NitrosDeveloperMode||{};window.NitrosDeveloperMode.semanticTransport=run?.analyzer?JSON.parse(JSON.stringify(run.analyzer)):null;
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

  function start(){document.title='Nitros Mobile Technician Portal v10.12.7AG — Semantic Transport Diagnostics';buildImportUi()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  window.addEventListener('pageshow',()=>setTimeout(start,40));
  new MutationObserver(()=>{if($('oliverHubSend')&&!$('oliverDiagnosticImport'))buildImportUi()}).observe(document.documentElement,{childList:true,subtree:true});
})();
