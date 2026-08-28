/* Nitros 10.12.23 appointment dedicated field commit fix. */
(()=>{'use strict';
  const BUILD='10.13.96';
  const SEMANTIC_REQUEST_TIMEOUT_MS=60_000;
  const MAX_ANALYSIS_IMAGE_BYTES=2.4*1024*1024;
  const MAX_SEMANTIC_REQUEST_BYTES=3.25*1024*1024;
  const ANALYSIS_STAGES=Object.freeze([{longDimension:1536,quality:.78},{longDimension:1280,quality:.72},{longDimension:1024,quality:.68}]);
  const MAX_TEXT_BYTES=1500000;
  const CATEGORIES=new Set([
    'AUTOMOTIVE_GRAPH',
    'AUTOMOTIVE_WIRING_DIAGRAM',
    'AUTOMOTIVE_COMPONENT_OR_VEHICLE',
    'DOCUMENT_OR_TEXT_SCREENSHOT',
    'GENERAL_NON_AUTOMOTIVE_PHOTO',
    'UNKNOWN_OR_ANALYSIS_UNAVAILABLE'
  ]);
  const CATEGORY_LABELS={AUTOMOTIVE_GRAPH:'Automotive Graph / Diagnostic Graph',AUTOMOTIVE_WIRING_DIAGRAM:'Automotive Wiring Diagram',AUTOMOTIVE_COMPONENT_OR_VEHICLE:'Automotive Component / Vehicle Photo',DOCUMENT_OR_TEXT_SCREENSHOT:'Document / Text / Screenshot',GENERAL_NON_AUTOMOTIVE_PHOTO:'General / Non-Automotive Photograph',UNKNOWN_OR_ANALYSIS_UNAVAILABLE:'Unknown / Analysis Unavailable'};
  const $=id=>document.getElementById(id);
  const escapeHtml=value=>String(value??'').replace(/[&<>\"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[char]));
  const initialStatus='Attach an image, CSV/text export, or PDF. Every image starts a new uncached analysis run.';
  let activeRun=null;
  let activePreviewUrl='';
  let caseId=createId('CASE');
  let sessionId=createId('SESSION');
  let lastStaleMessage='None';
  let lastStaleRejected=false;
  let lastDiagnosticImport=null;

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
    lastDiagnosticImport=null;const verifyButton=$('oliverUseVerifiedRepairInfo');if(verifyButton)verifyButton.hidden=true;
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

  function syncSemanticStages(run){
    const diag=run.analyzer,server=diag.serverDiagnostic||{},set=(index,status)=>{if(run.stages[index]&&run.stages[index].status!==status)run.stages[index].status=status};
    if(diag.payloadGenerated)set(2,'PASS');
    if(diag.fetchStarted&&!diag.responseReceived)set(3,'RUN');
    if(diag.responseReceived){set(3,'PASS');set(4,'PASS')}else if(diag.outcome==='FAILED'&&diag.fetchStarted){set(3,'FAIL');set(4,'FAIL')}
    if(server.openaiResponseReceived&&server.openaiResponseOk)set(5,'PASS');else if(server.openaiRequestAttempted&&diag.outcome==='FAILED')set(5,'FAIL');
    if(server.openaiResponseParsed&&server.openaiResponseOk)set(6,'PASS');else if(server.openaiRequestAttempted&&diag.outcome==='FAILED')set(6,'FAIL');
    if(server.openaiResponseParsed)set(7,'PASS');else if(server.openaiResponseReceived&&diag.outcome==='FAILED')set(7,'FAIL');
    if(diag.responseShapeNormalized)set(8,'PASS');else if(diag.responseReceived&&diag.outcome==='FAILED')set(8,'FAIL');
    if(diag.semanticObjectCount>0&&diag.responseShapeNormalized)set(9,'PASS');else if(diag.responseReceived&&diag.outcome==='FAILED')set(9,'FAIL');
    set(10,diag.retryStatus||'SKIPPED');
    if(diag.pipeline?.CLASSIFICATION_STARTED==='PASS')set(11,'RUN');
    if(diag.pipeline?.CLASSIFICATION_COMPLETE==='PASS')set(11,'PASS');
    if(diag.pipeline?.CLASSIFICATION_COMPLETE==='FAIL')set(11,'FAIL');
    if(server.componentIdentificationAttempted){set(12,'PASS');set(13,'PASS');set(14,server.componentResultPresent?'PASS':'FAIL');set(15,server.componentResultPresent?'PASS':'FAIL')}
    else if(server.componentIdentificationSkipped){set(12,diag.pipeline?.CLASSIFICATION_COMPLETE==='PASS'?'PASS':'SKIPPED');set(13,'SKIPPED');set(14,'SKIPPED');set(15,'SKIPPED')}
    if(server.wiringDiagramAnalysisAttempted){set(16,'PASS');set(17,server.wiringDiagramResultPresent?'PASS':'FAIL');set(18,server.wiringDiagramResultPresent?'PASS':'FAIL')}
    else if(server.wiringDiagramAnalysisSkipped){set(16,'SKIPPED');set(17,'SKIPPED');set(18,'SKIPPED')}
    if(server.vehicleAreaRelationshipAttempted){set(21,server.vehicleAreaRelationshipResultPresent?'PASS':'FAIL');set(22,server.vehicleAreaRelationshipResultPresent?'PASS':'FAIL');set(23,server.vehicleAreaRelationshipResultPresent?'PASS':'FAIL')}
    else if(server.vehicleAreaRelationshipSkipped){set(21,'SKIPPED');set(22,'SKIPPED');set(23,'SKIPPED')}
    if(server.vehicleContextValidation==='PASS'){set(24,'PASS');set(25,'SKIPPED')}
    else if(server.vehicleContextValidation==='BLOCKED'){set(24,'FAIL');set(25,'BLOCKED')}
    else {set(24,'SKIPPED');set(25,'SKIPPED')}
    renderStages(run);
  }

  function finalizeAcceptedAnalysisStages(run,result){
    const server=run.analyzer.serverDiagnostic||{},set=(index,status)=>{if(run.stages[index])run.stages[index].status=status};
    const automotive=result.category==='AUTOMOTIVE_COMPONENT_OR_VEHICLE',relationship=result.vehicleAreaRelationshipAnalysis;
    if(automotive&&run.analyzer.vehicleContextSnapshot){
      const complete=relationship&&relationship.semanticRequestId===run.analyzer.requestId&&relationship.imageHash===run.imageHash&&relationship.status!=='FAILED';
      set(21,complete?'PASS':'FAIL');set(22,complete?'PASS':'FAIL');set(23,complete?'PASS':'FAIL');
      const contextPass=sameVehicleContext(run.analyzer.vehicleContextSnapshot,result.vehicleContextBinding)&&sameVehicleContext(run.analyzer.vehicleContextSnapshot,activeVehicleAnalysisContext());
      set(24,contextPass?'PASS':'FAIL');set(25,contextPass?'SKIPPED':'FAIL');
      Object.assign(run.analyzer,{vehicleContextValidation:contextPass?'PASS':'BLOCKED',vehicleContextMismatchBlocked:!contextPass});
    }else{
      set(21,server.vehicleAreaRelationshipAttempted?'FAIL':'SKIPPED');set(22,server.vehicleAreaRelationshipAttempted?'FAIL':'SKIPPED');set(23,server.vehicleAreaRelationshipAttempted?'FAIL':'SKIPPED');
      set(24,run.analyzer.vehicleContextSnapshot?'FAIL':'SKIPPED');set(25,run.analyzer.vehicleContextSnapshot?'FAIL':'SKIPPED');
    }
    renderStages(run);
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

  function canvasToJpeg(canvas,quality){
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Analysis JPEG encoding failed.')),'image/jpeg',quality));
  }

  async function prepareAnalysisImage(originalBytes,mimeType,signal,requestId){
    if(signal?.aborted)throw abortError();
    let bitmap;
    try{bitmap=await createImageBitmap(new Blob([originalBytes],{type:mimeType||'application/octet-stream'}),{imageOrientation:'from-image'})}
    catch(error){throw diagnosticError('Image could not be prepared for analysis.','PAYLOAD_ERROR',{cause:error})}
    const originalDimensions={width:bitmap.width,height:bitmap.height};
    try{
      for(let index=0;index<ANALYSIS_STAGES.length;index+=1){
        if(signal?.aborted)throw abortError();
        const config=ANALYSIS_STAGES[index],scale=Math.min(1,config.longDimension/Math.max(bitmap.width,bitmap.height));
        const width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
        const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
        const context=canvas.getContext('2d',{alpha:false});
        if(!context)throw new Error('Image canvas is unavailable.');
        context.drawImage(bitmap,0,0,width,height);
        const jpeg=await canvasToJpeg(canvas,config.quality),analysisBytes=await jpeg.arrayBuffer();
        const encodedSize=4*Math.ceil(analysisBytes.byteLength/3);
        const requestEnvelopeBytes=new TextEncoder().encode(JSON.stringify({transactionId:requestId,imageHash:'0'.repeat(64),mimeType:'image/jpeg',imageBase64:''})).byteLength;
        const projectedBodyBytes=requestEnvelopeBytes+encodedSize;
        if(analysisBytes.byteLength<=MAX_ANALYSIS_IMAGE_BYTES&&projectedBodyBytes<=MAX_SEMANTIC_REQUEST_BYTES){
          return {bytes:analysisBytes,mimeType:'image/jpeg',originalDimensions,dimensions:{width,height},quality:config.quality,stage:index+1,encodedSize,projectedBodyBytes,payloadImageCount:1};
        }
      }
    }catch(error){
      if(error?.name==='AbortError'||error?.diagnosticCategory==='PAYLOAD_ERROR')throw error;
      throw diagnosticError('Image could not be prepared for analysis.','PAYLOAD_ERROR',{cause:error});
    }finally{bitmap.close?.()}
    throw diagnosticError('Image could not be prepared for analysis.','PAYLOAD_ERROR',{unsupportedRequestBody:true});
  }

  function semanticEndpoint(){return document.querySelector('meta[name="nitros-semantic-endpoint"]')?.content?.trim()||'/api/semantic-image-analysis'}
  function activeVehicleAnalysisContext(){
    const uiContext=window.NitrosAskOliverContext?.get?.()||{},diagnostic=window.NitrosDiagnosticV10120?.getState?.()||{},diagnosticVehicle=diagnostic.vehicle&&diagnostic.vehicle.year&&diagnostic.vehicle.make&&diagnostic.vehicle.model?diagnostic.vehicle:null,context=diagnosticVehicle?{...uiContext,...diagnosticVehicle,activeCaseId:diagnostic.id||uiContext.activeCaseId||uiContext.caseId,repairOrderId:diagnostic.repairOrderId||uiContext.ro||uiContext.repairOrderId,vin:diagnostic.vin||uiContext.vin,contextVersion:diagnostic.id?`${diagnostic.id}:${diagnosticVehicle.year}:${diagnosticVehicle.make}:${diagnosticVehicle.model}:${diagnosticVehicle.engine||''}`:uiContext.contextVersion}:uiContext,clean=(value,max)=>String(value||'').trim().replace(/\s+/g,' ').slice(0,max),year=clean(context.year,4),vin=clean(context.vin,17).toUpperCase();
    const activeCaseId=clean(localStorage.getItem('activeRepairOrderId')||context.activeCaseId||context.caseId,128),repairOrderId=clean(context.ro||context.repairOrderId,128),vehicle={year:/^\d{4}$/.test(year)?year:'',make:clean(context.make,80),model:clean(context.model,100),engine:clean(context.engine,100),fuelType:clean(context.fuelType||context.fuel,60),drivetrain:clean(context.drivetrain||context.transmission,100),configuration:clean(context.configuration||context.vehicleConfiguration,180),vin:/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)?vin:'',activeCaseId,repairOrderId,vehicleId:clean(context.vehicleId||context.id||context.vin||`${year}:${context.make||''}:${context.model||''}`,160),contextVersion:clean(context.contextVersion||context.updatedAt||`${activeCaseId}:${repairOrderId}:${year}:${context.make||''}:${context.model||''}:${context.vin||''}`,240),source:activeCaseId?'ACTIVE_REPAIR_ORDER':'ACTIVE_PORTAL_CASE'};
    return vehicle.year&&vehicle.make&&vehicle.model?vehicle:null;
  }
  function createAnalysisVehicleSnapshot(){const context=activeVehicleAnalysisContext();return context?Object.freeze({...context}):null}
  function sameVehicleContext(left,right){return ['year','make','model','engine','vin','activeCaseId','repairOrderId','vehicleId','contextVersion'].every(field=>String(left?.[field]||'').trim().toLowerCase()===String(right?.[field]||'').trim().toLowerCase())}

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
  function safeResponsePreview(payload,responseText){
    if(!payload||typeof payload!=='object'||Array.isArray(payload))return sanitizeDiagnosticText(responseText,500)||'[EMPTY RESPONSE BODY]';
    const semantic=payload.semanticResult&&typeof payload.semanticResult==='object'&&!Array.isArray(payload.semanticResult)?payload.semanticResult:null;
    const safe={topLevelKeys:Object.keys(payload).sort(),responseId:sanitizeDiagnosticText(payload.responseId||payload.id||'',160)||null,transactionId:sanitizeDiagnosticText(payload.transactionId||'',160)||null,imageHash:typeof payload.imageHash==='string'?payload.imageHash:null,semanticResultPresent:Boolean(semantic),semanticResultKeys:semantic?Object.keys(semantic).sort():[],error:null};
    if(typeof payload.error==='string')safe.error={message:sanitizeDiagnosticText(payload.error,500),code:sanitizeDiagnosticText(payload.code||'',120)||null};
    else if(payload.error&&typeof payload.error==='object')safe.error={message:sanitizeDiagnosticText(payload.error.message||'',500)||null,type:sanitizeDiagnosticText(payload.error.type||'',120)||null,code:sanitizeDiagnosticText(payload.error.code||'',120)||null};
    return JSON.stringify(safe);
  }
  function normalizeSemanticAnalysisResponse(payload){
    const required=['category','confidence','objects','evidence','description','automotiveEvidence','graphEvidence','documentEvidence'],seen=new Set();
    const parseText=value=>{if(typeof value!=='string'||!value.trim())return null;const trimmed=value.trim(),unfenced=trimmed.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();try{return JSON.parse(unfenced)}catch(_){return null}};
    const visit=(value,shape='direct-object',identity={})=>{
      if(typeof value==='string'){const parsed=parseText(value);return parsed===null?null:visit(parsed,`${shape} > JSON text`,identity)}
      if(!value||typeof value!=='object'||seen.has(value))return null;seen.add(value);
      if(Array.isArray(value)){for(const item of value){const found=visit(item,`${shape} > array[]`,identity);if(found)return found}return null}
      const nextIdentity={transactionId:value.transactionId??value.requestId??identity.transactionId,imageHash:value.imageHash??identity.imageHash,analyzer:value.analyzer??identity.analyzer,transportStatus:value.transportStatus??identity.transportStatus,serverDiagnostic:value.serverDiagnostic??identity.serverDiagnostic};
      if(required.every(field=>value[field]!==undefined))return {semanticResult:value,transactionId:nextIdentity.transactionId??value.transactionId,imageHash:nextIdentity.imageHash??value.imageHash,analyzer:nextIdentity.analyzer,transportStatus:nextIdentity.transportStatus,serverDiagnostic:nextIdentity.serverDiagnostic,responseShape:shape};
      for(const [key,label] of [['semanticResult','semanticResult'],['semantic_analysis','semantic_analysis'],['semanticAnalysis','semanticAnalysis'],['structured_output','structured_output'],['structuredOutput','structuredOutput'],['output_parsed','output_parsed'],['parsed','parsed'],['json','json'],['payload','payload'],['data','data'],['result','result'],['analysis','analysis'],['output','output[]'],['content','content[]'],['text','text']])if(value[key]!==undefined){const found=visit(value[key],`${shape} > ${label}`,nextIdentity);if(found)return found}
      return null;
    };
    return visit(payload);
  }
  window.NitrosNormalizeSemanticAnalysisResponse=normalizeSemanticAnalysisResponse;
  window.NitrosNormalizeSemanticResponse=normalizeSemanticAnalysisResponse;
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
    return {requestId:createId('sem'),imageHash:'Pending',stage:'CREATED',outcome:'PENDING',failureClass:'none',analysisAttempt:0,retryStatus:'SKIPPED',rawResponseType:'pending',responseShape:'pending',responseShapeNormalized:false,semanticPayloadLocated:false,semanticPayloadParsed:false,canonicalNormalizationSuccessful:false,semanticObjectCount:0,semanticPayloadLocation:'pending',endpoint:'Not configured',endpointFunction:'NitrosVisionAnalyzer.analyzeCurrentImage',method:'POST',payloadType:'application/json',imagePrepared:false,mimeType:mimeType||'application/octet-stream',imageBytes:0,imageDataAttached:false,payloadGenerated:false,encodedPayloadBytes:0,requestBodyBytes:0,originalDimensions:null,originalImageBytes:0,analysisDimensions:null,analysisJpegQuality:null,compressionStage:null,payloadImageCount:0,endpointConfigured:false,apiConfigurationPresent:'UNKNOWN',fetchStarted:false,responseReceived:false,responseOk:null,httpStatus:null,httpStatusText:'',responseType:'',responseContentType:'',responseCharacters:0,responseBytes:0,safeResponseBody:'Not received',topLevelKeys:[],semanticResultKeys:[],expectedSemanticFieldsPresent:false,missingSemanticPaths:[],responseId:'',responseTransactionId:'',responseImageHash:'',requestMatches:false,imageHashMatches:false,attemptMatches:false,parseResult:'NOT_STARTED',parsedErrorMessage:'',jsonParseFailure:'',errorCategory:'',errorName:'',errorMessage:'',errorCode:'',networkFailure:false,dnsFailure:false,corsFailure:false,corsPossible:false,timeout:false,aborted:false,malformedUrl:false,missingEndpoint:false,missingApiConfiguration:false,unsupportedRequestBody:false,clientException:false,likelyLayer:'Not started',imagePreparationMs:null,payloadEncodingMs:null,requestStartMs:null,responseReceivedMs:null,responseParsingMs:null,totalMs:null,startedAt:new Date().toISOString(),completedAt:'',serverDiagnostic:null,pipeline:{REQUEST_SENT:'PENDING',RESPONSE_RECEIVED:'PENDING',RESPONSE_HTTP_OK:'PENDING',RESPONSE_PARSED:'PENDING',SEMANTIC_CONTENT_FOUND:'PENDING',CLASSIFICATION_STARTED:'PENDING',CLASSIFICATION_COMPLETE:'PENDING'}};
  }
  function diagnosticSize(bytes){if(!Number.isFinite(bytes)||bytes<=0)return '0 B';const mb=bytes/(1024*1024);return mb>=0.1?`${mb.toFixed(2)} MB`:`${(bytes/1024).toFixed(1)} KB`}
  function formatTransportDiagnostic(diag){
    if(!diag)return 'No semantic request has started.';
    const pass=value=>value?'PASS':diag.outcome==='FAILED'?'FAIL':'PENDING';
    const responseLine=diag.responseReceived?'PASS':'FAIL — NO HTTP RESPONSE RECEIVED';
    const server=diag.serverDiagnostic||{};
    return [
      'SEMANTIC PIPELINE DIAGNOSTICS',
      `Semantic Analysis: ${diag.outcome==='FAILED'?'SEMANTIC ANALYSIS FAILED':diag.outcome==='SUCCEEDED'?'SEMANTIC ANALYSIS SUCCEEDED':'IN PROGRESS'}`,
      `Semantic Request ID: ${diag.requestId||'None'}`,
      `Current Image Hash: ${diag.imageHash||'None'}`,
      `Original image: ${diag.originalDimensions?`${diag.originalDimensions.width} × ${diag.originalDimensions.height}`:'Pending'} / ${diagnosticSize(diag.originalImageBytes)}`,
      `Analysis image: ${diag.analysisDimensions?`${diag.analysisDimensions.width} × ${diag.analysisDimensions.height}`:'Pending'}`,
      `Analysis JPEG quality: ${diag.analysisJpegQuality??'Pending'}`,
      `Encoded analysis image: ${diagnosticSize(diag.encodedPayloadBytes)}`,
      `Payload image count: ${diag.payloadImageCount}`,
      `Compression stage: ${diag.compressionStage??'Pending'}`,
      `Request Start Timestamp: ${diag.requestStarted||diag.startedAt||'None'}`,
      `Current Stage: ${diag.stage||'None'}`,
      '',
      `1. Image prepared: ${pass(diag.imagePrepared)}`,
      `2. MIME type: ${diag.mimeType||'Unknown'}`,
      `3. Encoded payload: ${pass(diag.payloadGenerated)}`,
      `4. Encoded payload size: ${diagnosticSize(diag.encodedPayloadBytes)}`,
      `5. Endpoint configured: ${pass(diag.endpointConfigured)}`,
      `   Request URL: ${diag.endpoint||'Not configured'}`,
      `   Function: ${diag.endpointFunction||'None'}`,
      `   HTTP Method: ${diag.method||'POST'}`,
      `   Payload Type: ${diag.payloadType||'None'}`,
      `   Image byte size: ${diagnosticSize(diag.imageBytes)}`,
      `   Image data attached: ${diag.imageDataAttached?'YES':'NO'}`,
      `   Server API configuration present: ${diag.apiConfigurationPresent}`,
      `6. Request started: ${pass(diag.fetchStarted)}`,
      `7. HTTP response received: ${responseLine}`,
      `8. Error category: ${diag.errorCategory||'None'}`,
      `9. Error type: ${diag.errorName||'None'}`,
      `10. Error message: ${diag.errorMessage||'None'}`,
      '',
      `HTTP Status: ${diag.httpStatus??'None'}${diag.httpStatusText?` ${diag.httpStatusText}`:''}`,
      `Response Type: ${diag.responseType||'None'}`,
      `Response Content-Type: ${diag.responseContentType||'None'}`,
      `Response Length: ${diag.responseCharacters||0} characters / ${diag.responseBytes||0} bytes`,
      `Response OK: ${diag.responseOk===null?'Pending':diag.responseOk?'TRUE':'FALSE'}`,
      `Elapsed Request Time: ${diag.responseReceivedMs??diag.totalMs??'Pending'} ms`,
      `Sanitized Response Preview: ${diag.safeResponseBody||'None'}`,
      `Top-level JSON keys: ${diag.topLevelKeys?.join(', ')||'None'}`,
      `Semantic result keys: ${diag.semanticResultKeys?.join(', ')||'None'}`,
      `Response shape: ${diag.responseShape||'pending'}`,
      `Raw semantic response type: ${diag.rawResponseType||'pending'}`,
      `Semantic payload located: ${diag.semanticPayloadLocated?'PASS':diag.outcome==='FAILED'?'FAIL':'PENDING'}`,
      `Semantic payload parsed: ${diag.semanticPayloadParsed?'PASS':diag.outcome==='FAILED'?'FAIL':'PENDING'}`,
      `Canonical normalization: ${diag.canonicalNormalizationSuccessful?'PASS':diag.outcome==='FAILED'?'FAIL':'PENDING'}`,
      `Semantic object count: ${diag.semanticObjectCount||0}`,
      `Semantic payload location: ${diag.semanticPayloadLocation||'pending'}`,
      `Semantic failure class: ${diag.failureClass||'none'}`,
      `Semantic analysis attempt: ${diag.analysisAttempt||'Not started'}`,
      `Semantic analysis retry: ${diag.retryStatus||'SKIPPED'}`,
      `Expected semantic fields: ${diag.expectedSemanticFieldsPresent?'PASS':diag.outcome==='FAILED'?'FAIL':'PENDING'}`,
      `Missing semantic paths: ${diag.missingSemanticPaths?.join(', ')||'None'}`,
      `Response ID: ${diag.responseId||'None'}`,
      `Request ID match: ${diag.requestMatches?'PASS':diag.responseReceived?'FAIL':'PENDING'} | Image hash match: ${diag.imageHashMatches?'PASS':diag.responseReceived?'FAIL':'PENDING'}`,
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
      ,'',
      'BROWSER → VERCEL',
      `Vercel request attempted: ${diag.fetchStarted?'YES':'NO'}`,
      `Vercel endpoint reached: ${diag.responseReceived?'PASS':diag.outcome==='FAILED'?'FAIL':'PENDING'}`,
      `Vercel HTTP: ${diag.httpStatus??'No response'}${diag.httpStatusText?` ${diag.httpStatusText}`:''}`,
      `Request duration: ${diag.responseReceivedMs??diag.totalMs??'Pending'} ms`,
      `Response Content-Type: ${diag.responseContentType||'None'}`,
      `Response body received: ${diag.responseCharacters>0?'YES':'NO'}`,
      `Browser error: ${diag.errorName?`${diag.errorName}: ${diag.errorMessage}`:'None'}`,
      '',
      'VERCEL → OPENAI',
      `Vercel request ID: ${server.requestId||'No server response'}`,
      `Request received by Vercel: ${server.requestReceived?'PASS':diag.responseReceived?'FAIL':'PENDING'}`,
      `Image received by server: ${server.imagePayloadFound?'PASS':server.requestReceived?'FAIL':'PENDING'}`,
      `Server image MIME/bytes/hash: ${server.imageMimeType||'Unknown'} / ${server.imageByteLength??'Unknown'} / ${server.imageHashShort||'Unknown'}`,
      `Server/OpenAI payload image count: ${server.payloadImageCount??'Unknown'}`,
      `OpenAI API credential configured: ${server.openaiCredentialConfigured===true?'YES':server.openaiCredentialConfigured===false?'NO':'UNKNOWN'}`,
      `OpenAI request attempted: ${server.openaiRequestAttempted?'PASS':server.requestReceived?'NO':'PENDING'}`,
      `OpenAI response received: ${server.openaiResponseReceived?'PASS':server.openaiRequestAttempted?'FAIL':'PENDING'}`,
      `OpenAI HTTP status: ${server.openaiHttpStatus??'No response'}`,
      `OpenAI response parsed: ${server.openaiResponseParsed?'PASS':server.openaiResponseReceived?'FAIL':'PENDING'}`,
      `Semantic output present: ${server.semanticOutputPresent?'PASS':server.openaiResponseParsed?'FAIL':'PENDING'}`,
      `Semantic objects returned: ${server.semanticObjectsReturned??'Unknown'}`,
      `Server stage/error: ${server.stage||'Unknown'} / ${server.errorCategory||'None'} / ${server.errorType||'None'} / ${server.errorCode||'None'} / ${server.errorMessage||'None'}`,
      `Component identification attempted: ${server.componentIdentificationAttempted?'YES':server.componentIdentificationSkipped?'SKIPPED':'NO'}`,
      `Component response/status: ${server.componentResponseReceived?'RECEIVED':'NONE'} / ${server.componentHttpStatus??'No response'} / ${server.componentStatus||'None'}`,
      `Component result/confidence normalization: ${server.componentResultPresent?'PASS':'FAIL'} / ${server.componentResultPresent?'PASS':'PENDING'}`,
      `Component error: ${server.componentErrorCategory||'None'} / ${server.componentErrorMessage||'None'}`,
      '',
      'PIPELINE STATE',
      ...Object.entries(diag.pipeline||{}).map(([name,status])=>`${name}: ${status}`)
    ].join('\n');
  }

  window.NitrosVisionAnalyzer={
    endpoint:semanticEndpoint(),
    async analyzeCurrentImage({bytes,mimeType,runId,imageHash,vehicleContextSnapshot,signal,diagnostic,onDiagnostic,analysisAttempt=1}){
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
        const vehicleContext=vehicleContextSnapshot||null;
        if(vehicleContext&&!sameVehicleContext(vehicleContext,activeVehicleAnalysisContext()))throw diagnosticError('VEHICLE_CONTEXT_MISMATCH: active vehicle changed before request dispatch.','VEHICLE_CONTEXT_MISMATCH',{retryable:false});
        mark({vehicleContextSnapshot:vehicleContext,vehicleContextValidation:vehicleContext?'PASS':'SKIPPED',vehicleContextMismatchBlocked:false});
        requestBody=JSON.stringify({transactionId:runId,imageHash,mimeType,imageBase64,...(vehicleContext?{vehicleContext}:{})});
        const requestBodyBytes=new TextEncoder().encode(requestBody).byteLength;
        if(requestBodyBytes>MAX_SEMANTIC_REQUEST_BYTES)throw diagnosticError('Image could not be prepared for analysis.','PAYLOAD_ERROR',{unsupportedRequestBody:true});
        mark({payloadGenerated:true,imageDataAttached:Boolean(imageBase64),imageBytes:bytes.byteLength,encodedPayloadBytes:imageBase64.length,requestBodyBytes,payloadImageCount:1,payloadEncodingMs:elapsed(encodeStarted)});
      }catch(error){mark({outcome:'FAILED',errorCategory:error.diagnosticCategory||'PAYLOAD_ERROR',errorName:error.name,errorMessage:sanitizeDiagnosticText(error.message),unsupportedRequestBody:Boolean(error.unsupportedRequestBody),clientException:true,likelyLayer:'Client payload generation',payloadEncodingMs:elapsed(encodeStarted),totalMs:elapsed(attemptStarted),completedAt:new Date().toISOString()});throw error}
      let response;
      const requestController=new AbortController();
      const forwardAbort=()=>requestController.abort(signal?.reason||abortError());
      if(signal?.aborted)forwardAbort();else signal?.addEventListener('abort',forwardAbort,{once:true});
      const requestTimer=setTimeout(()=>requestController.abort(new DOMException('Semantic analysis timeout','TimeoutError')),SEMANTIC_REQUEST_TIMEOUT_MS);
      try{
        mark({stage:'FETCH_EXECUTION',fetchStarted:true,requestStarted:new Date().toISOString(),requestStartMs:elapsed(attemptStarted),pipeline:{...diagnostic.pipeline,REQUEST_SENT:'PASS'}});
        response=await fetch(requestUrl.href,{method:'POST',headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:requestBody,signal:requestController.signal,cache:'no-store',credentials:'same-origin'});
      }catch(error){
        const classification=classifyTransportError(error,{endpoint:requestUrl.href,responseReceived:false});
        mark({...classification,outcome:'FAILED',stage:'FETCH_FAILED',failureClass:'transport_failure',errorCategory:'transport_failure',errorName:sanitizeDiagnosticText(error.name||'Error'),errorMessage:`SEMANTIC_NETWORK_ERROR: ${sanitizeDiagnosticText(error.message||error)}`,errorCode:sanitizeDiagnosticText(error.code||''),clientException:true,responseReceived:false,safeResponseBody:'NO HTTP RESPONSE RECEIVED',pipeline:{...diagnostic.pipeline,RESPONSE_RECEIVED:'FAIL',RESPONSE_HTTP_OK:'FAIL',RESPONSE_PARSED:'FAIL',SEMANTIC_CONTENT_FOUND:'FAIL'},totalMs:elapsed(attemptStarted),completedAt:new Date().toISOString()});
        throw tagDiagnosticError(error,error.diagnosticCategory||classification.category);
      }finally{
        clearTimeout(requestTimer);signal?.removeEventListener('abort',forwardAbort);
      }
      mark({stage:'HTTP_RESPONSE_RECEIVED',responseReceived:true,responseOk:response.ok,httpStatus:response.status,httpStatusText:sanitizeDiagnosticText(response.statusText,120),responseType:sanitizeDiagnosticText(response.type||'',80),responseContentType:sanitizeDiagnosticText(response.headers.get('content-type')||'',200),responseReceivedMs:elapsed(attemptStarted),transportStatus:response.status,likelyLayer:'HTTP response received',pipeline:{...diagnostic.pipeline,RESPONSE_RECEIVED:'PASS',RESPONSE_HTTP_OK:response.ok?'PASS':'FAIL'}});
      const parseStarted=performance.now();let responseText='',payload=null,normalizedResponse=null;
      try{
        responseText=await response.text();const responseBytes=new TextEncoder().encode(responseText).byteLength;
        if(!responseText)throw diagnosticError('Semantic endpoint returned an empty response body.','empty_model_response');
        try{payload=JSON.parse(responseText)}catch(error){throw tagDiagnosticError(error,'RESPONSE_PARSE_ERROR',{responseNotJson:true})}
        normalizedResponse=normalizeSemanticAnalysisResponse(payload);const semantic=normalizedResponse?.semanticResult||null;
        const serverDiagnostic=payload?.serverDiagnostic&&typeof payload.serverDiagnostic==='object'?payload.serverDiagnostic:null;
        mark({parseResult:'JSON_PARSE_PASS',analysisAttempt,rawResponseType:Array.isArray(payload)?'array':typeof payload,responseShape:normalizedResponse?.responseShape||'unsupported',responseShapeNormalized:Boolean(normalizedResponse),semanticPayloadLocated:Boolean(normalizedResponse),semanticPayloadParsed:Boolean(semantic),canonicalNormalizationSuccessful:Boolean(normalizedResponse),semanticObjectCount:semantic?1:0,semanticPayloadLocation:normalizedResponse?.responseShape||'unsupported',responseParsingMs:elapsed(parseStarted),responseCharacters:responseText.length,responseBytes,safeResponseBody:safeResponsePreview(payload,responseText),topLevelKeys:payload&&typeof payload==='object'&&!Array.isArray(payload)?Object.keys(payload).sort():[],semanticResultKeys:semantic?Object.keys(semantic).sort():[],responseId:sanitizeDiagnosticText(payload?.responseId||payload?.id||'',160),responseTransactionId:sanitizeDiagnosticText(normalizedResponse?.transactionId||'',160),responseImageHash:typeof normalizedResponse?.imageHash==='string'?normalizedResponse.imageHash:'',serverDiagnostic,apiConfigurationPresent:serverDiagnostic?.openaiCredentialConfigured===true?'YES':serverDiagnostic?.openaiCredentialConfigured===false?'NO':'UNKNOWN',pipeline:{...diagnostic.pipeline,RESPONSE_PARSED:'PASS'}});
      }
      catch(error){const responseBytes=new TextEncoder().encode(responseText).byteLength,failureClass=error.diagnosticCategory==='empty_model_response'?'empty_model_response':'malformed_semantic_response',message=`SEMANTIC_PARSE_ERROR: ${sanitizeDiagnosticText(error.message)}`;mark({outcome:'FAILED',stage:'RESPONSE_PARSE_FAILED',failureClass,errorCategory:failureClass,errorName:sanitizeDiagnosticText(error.name),errorMessage:message,jsonParseFailure:sanitizeDiagnosticText(error.message),parseResult:error.responseNotJson?'RESPONSE_NOT_JSON':'JSON_PARSE_FAIL',responseCharacters:responseText.length,responseBytes,responseParsingMs:elapsed(parseStarted),safeResponseBody:sanitizeDiagnosticText(responseText,500)||'[EMPTY RESPONSE BODY]',likelyLayer:'HTTP response parsing',pipeline:{...diagnostic.pipeline,RESPONSE_PARSED:'FAIL',SEMANTIC_CONTENT_FOUND:'FAIL'},totalMs:elapsed(attemptStarted),completedAt:new Date().toISOString()});throw tagDiagnosticError(error,failureClass,{retryable:true,transportStatus:response.status})}
      if(!response.ok){
        const missingApi=payload?.code==='SERVICE_UNAVAILABLE',failureClass=payload?.serverDiagnostic?.openaiRequestAttempted&&!payload?.serverDiagnostic?.openaiResponseReceived?'openai_request_failure':'endpoint_failure',message=payload?.error||`Semantic endpoint returned HTTP ${response.status}.`;
        mark({outcome:'FAILED',stage:'HTTP_ERROR',failureClass,errorCategory:failureClass,errorName:'SemanticHttpError',errorMessage:sanitizeDiagnosticText(message),parsedErrorMessage:sanitizeDiagnosticText(message),errorCode:sanitizeDiagnosticText(payload?.code||''),missingApiConfiguration:missingApi,apiConfigurationPresent:missingApi?'NO':'UNKNOWN',likelyLayer:missingApi?'Server API configuration':'Semantic endpoint HTTP response',pipeline:{...diagnostic.pipeline,SEMANTIC_CONTENT_FOUND:'FAIL'},totalMs:elapsed(attemptStarted),completedAt:new Date().toISOString()});
        throw diagnosticError(message,failureClass,{transportStatus:payload?.transportStatus||response.status});
      }
      if(!normalizedResponse){const failureClass=payload===null?'empty_model_response':typeof payload==='object'?'unsupported_response_shape':'malformed_semantic_response',message=`SEMANTIC_RESPONSE_NORMALIZATION_FAILED: ${failureClass}`;mark({outcome:'FAILED',stage:'SEMANTIC_SHAPE_UNSUPPORTED',failureClass,errorCategory:failureClass,errorName:'SemanticShapeError',errorMessage:message,responseShape:'unsupported',responseShapeNormalized:false,likelyLayer:'Semantic response normalization',pipeline:{...diagnostic.pipeline,SEMANTIC_CONTENT_FOUND:'FAIL'},totalMs:elapsed(attemptStarted),completedAt:new Date().toISOString()});throw diagnosticError(message,failureClass,{retryable:true,transportStatus:response.status})}
      const expectedSemantic=['category','confidence','objects','evidence','description','automotiveEvidence','graphEvidence','documentEvidence'];
      const missing=[...['transactionId','imageHash'].filter(field=>normalizedResponse?.[field]===undefined),...expectedSemantic.filter(field=>normalizedResponse?.semanticResult?.[field]===undefined).map(field=>`semanticResult.${field}`)];
      const requestMatches=normalizedResponse?.transactionId===runId,imageHashMatches=normalizedResponse?.imageHash===imageHash,attemptMatches=diagnostic.analysisAttempt===analysisAttempt;
      if(!requestMatches)missing.push('transactionId(CURRENT_REQUEST_MISMATCH)');if(!imageHashMatches)missing.push('imageHash(CURRENT_IMAGE_MISMATCH)');
      if(!attemptMatches)missing.push('analysisAttempt(CURRENT_ATTEMPT_MISMATCH)');
      if(missing.length){const failureClass=missing.some(item=>/MISMATCH/.test(item))?'stale_semantic_response':'malformed_semantic_response',message=`SEMANTIC_RESULT_MISSING: ${missing.join(', ')}`;mark({outcome:'FAILED',stage:'SEMANTIC_CONTENT_MISSING',failureClass,errorCategory:failureClass,errorName:'SemanticResultError',errorMessage:message,parsedErrorMessage:message,missingSemanticPaths:missing,expectedSemanticFieldsPresent:false,requestMatches,imageHashMatches,attemptMatches,apiConfigurationPresent:'YES',likelyLayer:'Semantic endpoint response schema',pipeline:{...diagnostic.pipeline,SEMANTIC_CONTENT_FOUND:'FAIL'},totalMs:elapsed(attemptStarted),completedAt:new Date().toISOString()});throw diagnosticError(message,failureClass,{retryable:failureClass==='malformed_semantic_response',transportStatus:response.status})}
      if(!normalizedResponse.semanticResult.evidence?.length&&normalizedResponse.semanticResult.category!=='UNKNOWN_OR_ANALYSIS_UNAVAILABLE'){const message='Valid semantic response contains no usable visual evidence.';mark({outcome:'FAILED',failureClass:'valid_response_no_usable_visual_evidence',errorCategory:'valid_response_no_usable_visual_evidence',errorMessage:message});throw diagnosticError(message,'valid_response_no_usable_visual_evidence',{retryable:false})}
      mark({outcome:'SUCCEEDED',stage:'SEMANTIC_RESPONSE_RECEIVED',parseResult:'JSON_PARSE_PASS',expectedSemanticFieldsPresent:true,missingSemanticPaths:[],requestMatches:true,imageHashMatches:true,attemptMatches:true,failureClass:'none',apiConfigurationPresent:'YES',pipeline:{...diagnostic.pipeline,SEMANTIC_CONTENT_FOUND:'PASS'},totalMs:elapsed(attemptStarted),completedAt:new Date().toISOString()});
      return {...normalizedResponse.semanticResult,transactionId:normalizedResponse.transactionId,imageHash:normalizedResponse.imageHash,source:normalizedResponse.analyzer||'Secure semantic analyzer',transportStatus:normalizedResponse.transportStatus||response.status,serverDiagnostic:normalizedResponse.serverDiagnostic||payload?.serverDiagnostic||null,responseShape:normalizedResponse.responseShape,analysisAttempt};
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
  function normalizeComponentIdentification(raw,category,run){
    if(category!=='AUTOMOTIVE_COMPONENT_OR_VEHICLE')return null;
    if(!raw||typeof raw!=='object'||!['IDENTIFIED','UNCERTAIN','FAILED'].includes(raw.status))throw new Error('Specific component identification result is missing or invalid.');
    if(raw.semanticRequestId!==run.analyzer.requestId||raw.imageHash!==run.imageHash)throw new Error('Specific component identification does not match the current image request.');
    const confidence=raw.normalizedComponentConfidence===null?null:Number(raw.normalizedComponentConfidence??raw.componentConfidence);
    if(confidence!==null&&(!Number.isFinite(confidence)||confidence<0||confidence>100))throw new Error('Component identification confidence is invalid.');
    const supportingEvidence=stringArray(raw.supportingEvidence,'component supportingEvidence'),secondaryComponents=stringArray(raw.secondaryComponents,'secondaryComponents'),possibleAlternatives=stringArray(raw.possibleAlternatives,'possibleAlternatives'),likelyConnectionsOrDestinations=stringArray(raw.likelyConnectionsOrDestinations||[],'likelyConnectionsOrDestinations');
    return {status:raw.status,primaryComponent:String(raw.primaryComponent||'Unable to determine exact component').trim(),componentConfidence:confidence,rawComponentConfidence:raw.rawComponentConfidence??null,normalizedComponentConfidence:confidence,system:raw.system?String(raw.system).trim():null,secondaryComponents,supportingEvidence,possibleAlternatives,likelyConnectionsOrDestinations,uncertaintyReason:raw.uncertaintyReason?String(raw.uncertaintyReason).trim():null,drivetrainDiscrimination:raw.drivetrainDiscrimination||null,semanticRequestId:raw.semanticRequestId,imageHash:raw.imageHash};
  }
  function normalizeVisualConditionInspection(raw,category,run){
    if(category!=='AUTOMOTIVE_COMPONENT_OR_VEHICLE')return null;
    if(!raw||typeof raw!=='object'||!['OBSERVED_CONDITION','POSSIBLE_CONCERN_DETECTED','UNVERIFIED_CONDITION','NO_VISIBLE_CONCERN_DETECTED','UNABLE_TO_INSPECT','FAILED'].includes(raw.status))throw new Error('Visual condition inspection result is missing or invalid.');
    if(raw.semanticRequestId!==run.analyzer.requestId||raw.imageHash!==run.imageHash)throw new Error('Visual condition inspection does not match the current image request.');
    const confidence=raw.normalizedConditionConfidence===null?null:Number(raw.normalizedConditionConfidence??raw.conditionConfidence);
    if(confidence!==null&&(!Number.isFinite(confidence)||confidence<0||confidence>100))throw new Error('Visual condition confidence is invalid.');
    const possibleConcerns=Array.isArray(raw.possibleConcerns)?raw.possibleConcerns.map(concern=>({location:String(concern?.location||'').trim(),appearance:String(concern?.appearance||'').trim(),physicalConfirmationRequired:concern?.physicalConfirmationRequired===true,recommendedVerification:String(concern?.recommendedVerification||'').trim()})).filter(concern=>concern.location&&concern.appearance&&concern.recommendedVerification&&concern.physicalConfirmationRequired).slice(0,8):[];
    if(raw.status==='POSSIBLE_CONCERN_DETECTED'&&!possibleConcerns.length)throw new Error('Visual condition possible concern lacks required verification.');
    const connectionAssessments=Array.isArray(raw.connectionAssessments)?raw.connectionAssessments.map(item=>({location:String(item?.location||'').trim(),seatingStatus:String(item?.seatingStatus||'NOT_RELIABLY_VISIBLE').trim(),findingType:String(item?.findingType||'').trim(),severity:String(item?.severity||'').trim(),findingConfidence:item?.findingConfidence===null?null:Number(item?.findingConfidence),visibleEvidence:String(item?.visibleEvidence||'').trim(),matingComponentVisible:item?.matingComponentVisible===true,directDamageVisible:item?.directDamageVisible===true,missingContext:item?.missingContext?String(item.missingContext).trim():null,recommendedVerification:String(item?.recommendedVerification||'').trim(),safetyDrivabilityImpact:item?.safetyDrivabilityImpact?String(item.safetyDrivabilityImpact).trim():null})).filter(item=>item.location&&['SEPARATION_OR_GAP_VISIBLE','POSSIBLE_IMPROPER_SEATING','NO_GAP_OR_SEPARATION_VISIBLE','NOT_RELIABLY_VISIBLE','COMPONENT_OR_CONNECTION_CONTEXT_NOT_VISIBLE'].includes(item.seatingStatus)&&['CLEAR_DEFECT','POSSIBLE_CONCERN','UNVERIFIED_CONDITION','RESIDUE_OR_STAINING','SEATING_NOT_RELIABLY_VISIBLE','NO_DEFECT_VISIBLE'].includes(item.findingType)&&['CRITICAL','HIGH','MODERATE','LOW','UNDETERMINED'].includes(item.severity)&&Number.isFinite(item.findingConfidence)&&item.findingConfidence>=0&&item.findingConfidence<=100&&item.visibleEvidence&&item.recommendedVerification).slice(0,12):[];
    if(raw.status==='NO_VISIBLE_CONCERN_DETECTED'&&(!connectionAssessments.length||connectionAssessments.some(item=>item.seatingStatus!=='NO_GAP_OR_SEPARATION_VISIBLE'||item.findingType!=='NO_DEFECT_VISIBLE')))throw new Error('No-visible-concern condition result lacks confirmed visible connection seating.');
    if(connectionAssessments.some(item=>item.seatingStatus==='SEPARATION_OR_GAP_VISIBLE')&&raw.status!=='OBSERVED_CONDITION')throw new Error('Visible connection separation was downgraded below an observed condition.');
    return {status:raw.status,conditionConfidence:confidence,rawConditionConfidence:raw.rawConditionConfidence??null,normalizedConditionConfidence:confidence,observedCondition:stringArray(raw.observedCondition||[],'visual condition observedCondition'),possibleConcerns,connectionAssessments,noVisibleConcernMessage:String(raw.noVisibleConcernMessage||'').trim(),unableToInspectReason:raw.unableToInspectReason?String(raw.unableToInspectReason).trim():null,visibleEvidence:stringArray(raw.visibleEvidence||[],'visual condition visibleEvidence'),recommendedVerification:stringArray(raw.recommendedVerification||[],'visual condition recommendedVerification'),safetyDrivabilityImpact:raw.safetyDrivabilityImpact?String(raw.safetyDrivabilityImpact).trim():null,consistencyCorrections:stringArray(raw.consistencyCorrections||[],'visual condition consistencyCorrections'),semanticRequestId:raw.semanticRequestId,imageHash:raw.imageHash};
  }
  function normalizeVehicleAreaRelationship(raw,category,run){
    if(category!=='AUTOMOTIVE_COMPONENT_OR_VEHICLE'||!raw)return null;
    if(typeof raw!=='object'||!['READY','INSUFFICIENT_CONTEXT'].includes(raw.status)||raw.semanticRequestId!==run.analyzer.requestId||raw.imageHash!==run.imageHash)throw new Error('Vehicle-area relationship result is missing or invalid.');
    const text=(value,max)=>String(value||'').trim().slice(0,max),confidence=value=>value===null||value===undefined?null:Number(value);
    const locationConfidence=confidence(raw.locationConfidence),items=Array.isArray(raw.observedItems)?raw.observedItems.map(item=>({observedItem:text(item?.observedItem,240),itemLocationInImage:text(item?.itemLocationInImage,240),nearestIdentifiableAssembly:text(item?.nearestIdentifiableAssembly,240),likelyRelationshipOrDestination:text(item?.likelyRelationshipOrDestination,500),relationshipConfidence:confidence(item?.relationshipConfidence),visibleEvidence:text(item?.visibleEvidence,500),vehicleContextEvidence:text(item?.vehicleContextEvidence,500),whatCannotBeConfirmed:text(item?.whatCannotBeConfirmed,500),recommendedNextPhotoVerification:text(item?.recommendedNextPhotoVerification,500)})).filter(item=>item.observedItem&&item.itemLocationInImage&&item.visibleEvidence&&item.whatCannotBeConfirmed&&item.recommendedNextPhotoVerification):[];
    if((locationConfidence!==null&&(!Number.isFinite(locationConfidence)||locationConfidence<0||locationConfidence>100))||items.some(item=>item.relationshipConfidence!==null&&(!Number.isFinite(item.relationshipConfidence)||item.relationshipConfidence<0||item.relationshipConfidence>100)))throw new Error('Vehicle-area relationship confidence is invalid.');
    const gap=raw.expectedComponentCheck||{},gapVisual=stringArray(gap.supportingVisualEvidence||[],'expected component visual evidence'),gapContext=stringArray(gap.vehicleContextSupport||[],'expected component context support'),gapCandidate=text(gap.possibleMissingOrRemovedComponent,240),gapValid=gapCandidate&&gapCandidate!=='No visually supported missing component detected.'&&gapVisual.length&&gapContext.length;
    const expectedComponentCheck={expectedMajorComponents:stringArray(gap.expectedMajorComponents||[],'expected major components'),visiblyAccountedFor:stringArray(gap.visiblyAccountedFor||[],'visibly accounted components'),possibleMissingOrRemovedComponent:gapValid?gapCandidate:'No visually supported missing component detected.',supportingVisualEvidence:gapValid?gapVisual:[],vehicleContextSupport:gapValid?gapContext:[],confidence:gapValid?confidence(gap.confidence):null,whatPreventsConfirmation:text(gap.whatPreventsConfirmation,500)||'No visually supported missing component can be confirmed from this image.',recommendedTechnicianVerification:text(gap.recommendedTechnicianVerification,500)||'Take a wider, well-lit image showing the mounting area and all nearby connectors.'};
    return {status:raw.status,vehicleAreaLocation:text(raw.vehicleAreaLocation,240)||'Location uncertain',locationConfidence,locationEvidence:stringArray(raw.locationEvidence||[],'vehicle area locationEvidence'),vehicleContextSupport:stringArray(raw.vehicleContextSupport||[],'vehicle area vehicleContextSupport'),primaryVisibleAssembly:text(raw.primaryVisibleAssembly,240)||'Broad assembly cannot be confirmed',observedItems:items,expectedComponentCheck,whatPreventsConfirmation:text(raw.whatPreventsConfirmation,500),recommendedNextPhotoVerification:text(raw.recommendedNextPhotoVerification,500),semanticRequestId:raw.semanticRequestId,imageHash:raw.imageHash};
  }
  function normalizeWiringDiagram(raw,category,run){
    if(category!=='AUTOMOTIVE_WIRING_DIAGRAM')return null;
    if(!raw||typeof raw!=='object'||!['READY','INSUFFICIENT_READABILITY','FAILED'].includes(raw.status))throw new Error('Wiring diagram analysis result is missing or invalid.');
    if(raw.semanticRequestId!==run.analyzer.requestId||raw.imageHash!==run.imageHash)throw new Error('Wiring diagram result does not match the current image request.');
    const entries=value=>{if(value===null||value===undefined)return[];if(typeof value==='string')return value.split(/\s*(?:->|→)\s*/).map(item=>item.trim()).filter(Boolean);if(Array.isArray(value))return value.flatMap(entries);if(typeof value==='object'){for(const key of ['path','steps','nodes','components','testPoints','connectors'])if(value[key]!==undefined)return entries(value[key]);return[value]}return[]};
    const normalizeField=value=>entries(value).map(entry=>{if(typeof entry==='string')return{component:entry,terminal:'',wire:'',circuit:'',voltageExpected:'',description:''};const get=(...keys)=>{for(const key of keys)if(typeof entry?.[key]==='string'||typeof entry?.[key]==='number')return String(entry[key]).trim();return''},node={component:get('component','name','label','node'),terminal:get('terminal','pin'),wire:get('wire','wireColor','color'),circuit:get('circuit','circuitId'),voltageExpected:get('voltageExpected','expectedVoltage','expected'),description:get('description','detail')};return Object.values(node).some(Boolean)?node:null}).filter(Boolean).slice(0,24);
    const wiringStrings=value=>normalizeField(value).map(node=>node.component||node.description||[node.terminal,node.wire,node.circuit,node.voltageExpected].filter(Boolean).join(' — ')).filter(Boolean),normalized={structuralEvidence:stringArray(raw.structuralEvidence,'structuralEvidence')};
    for(const field of ['detectedComponents','connectorsAndPins','fuses','relays','splices','wireDetails','importantObservations','unreadableFields'])normalized[field]=wiringStrings(raw[field]);
    if(!normalized.detectedComponents.length)normalized.detectedComponents=wiringStrings(raw.components);
    if(!normalized.connectorsAndPins.length)normalized.connectorsAndPins=wiringStrings(raw.connectors);
    let circuitPaths=Array.isArray(raw.circuitPaths)?raw.circuitPaths.slice(0,16).map((path,index)=>({label:String(path?.label||`Circuit Leg ${String.fromCharCode(65+index)}`),path:String(path?.path||'Not reliably readable from supplied diagram.'),function:String(path?.function||'Circuit function not reliably confirmed from supplied diagram.'),functionConfirmed:Boolean(path?.functionConfirmed)})):[];
    const powerPath=normalizeField(raw.powerPath),groundPath=normalizeField(raw.groundPath),controlPath=normalizeField(raw.controlPath??raw.signalPath),testPoints=normalizeField(raw.testPoints);
    if(!circuitPaths.length)circuitPaths=[['Reported power path',powerPath],['Reported ground path',groundPath],['Reported control/signal path',controlPath]].filter(([,nodes])=>nodes.length).map(([label,nodes])=>({label,path:nodes.map(node=>[node.component,node.terminal,node.wire,node.circuit].filter(Boolean).join(' ')).join(' → '),function:label,functionConfirmed:false}));
    return {...normalized,circuitPaths,powerPath,groundPath,controlPath,testPoints,status:raw.status,circuitComponent:String(raw.circuitComponent||'Not reliably readable from supplied diagram.').trim(),confidence:raw.normalizedConfidence===null?null:Number(raw.normalizedConfidence??raw.confidence),rawConfidence:raw.rawConfidence??null,normalizedConfidence:raw.normalizedConfidence??null,safetyWarning:raw.safetyWarning?String(raw.safetyWarning).trim():null,testPlan:Array.isArray(raw.testPlan)?raw.testPlan.slice(0,8):[],semanticRequestId:raw.semanticRequestId,imageHash:raw.imageHash};
  }
  function normalizeDocumentRepairInformation(raw,category,run){
    if(category!=='DOCUMENT_OR_TEXT_SCREENSHOT')return null;
    if(!raw||typeof raw!=='object')return {status:'UNREADABLE',dtcApplicability:'',dtcs:[],testName:'',componentOrCircuit:'',testLocation:'',method:'',criterion:'',criterionEvidence:'',requestedResult:'',comparator:'',minimum:null,maximum:null,visibleTextEvidence:[],missingRequiredFields:['DTC applicability','component or circuit','test location','test method','criterion','requested technician result'],semanticRequestId:run.analyzer.requestId,imageHash:run.imageHash};
    if(raw.semanticRequestId!==run.analyzer.requestId||raw.imageHash!==run.imageHash)throw new Error('Document extraction result does not match the current image request.');
    const text=(field,limit)=>String(raw[field]||'').trim().slice(0,limit),firstText=(fields,limit)=>{for(const field of fields){const value=String(raw[field]||'').trim();if(value)return value.slice(0,limit)}return''},dtcs=Array.isArray(raw.dtcs)?[...new Set(raw.dtcs.filter(code=>/^[PCBU][0-9A-F]{4}$/.test(code)))]:[],allowedMissing=['component or circuit','test location','test method','criterion','test'];
    const applicability=['APPLICABLE','NOT APPLICABLE','UNKNOWN / CANNOT DETERMINE'].includes(raw.dtcApplicability)?raw.dtcApplicability:'',visibleTextEvidence=Array.isArray(raw.visibleTextEvidence)?raw.visibleTextEvidence.map(String).filter(Boolean).slice(0,24):[],claimedCriterion=firstText(['criterion','criteria','specification','spec','expectedValue','expected_value','acceptableRange','acceptable_range'],300),criterionEvidence=text('criterionEvidence',500)||visibleTextEvidence.find(item=>claimedCriterion&&item.toLowerCase().includes(claimedCriterion.toLowerCase()))||'',criterionNumbers=claimedCriterion.match(/\d+(?:\.\d+)?/g)||[],evidenceNumbers=criterionEvidence.match(/\d+(?:\.\d+)?/g)||[],criterionEvidenceVisible=!!criterionEvidence&&visibleTextEvidence.some(item=>item.toLowerCase().includes(criterionEvidence.toLowerCase())||criterionEvidence.toLowerCase().includes(item.toLowerCase())),criterionGrounded=criterionEvidenceVisible&&criterionNumbers.every(number=>evidenceNumbers.includes(number));
    const result={status:['COMPLETE','INCOMPLETE','UNREADABLE'].includes(raw.status)?raw.status:'UNREADABLE',dtcApplicability:applicability,dtcs,testName:text('testName',200),componentOrCircuit:text('componentOrCircuit',300),testLocation:text('testLocation',400),method:text('method',700),criterion:criterionGrounded?claimedCriterion:'',criterionEvidence:criterionGrounded?criterionEvidence:'',requestedResult:text('requestedResult',300),comparator:criterionGrounded&&['','<=','>=','range'].includes(raw.comparator)?raw.comparator:'',minimum:criterionGrounded&&Number.isFinite(raw.minimum)?raw.minimum:null,maximum:criterionGrounded&&Number.isFinite(raw.maximum)?raw.maximum:null,visibleTextEvidence,missingRequiredFields:Array.isArray(raw.missingRequiredFields)?raw.missingRequiredFields.filter(field=>allowedMissing.includes(field)):[],semanticRequestId:raw.semanticRequestId,imageHash:raw.imageHash};
    if(result.dtcApplicability)result.missingRequiredFields=result.missingRequiredFields.filter(field=>field!=='DTC applicability');
    const required=[['test',result.testName],['component or circuit',result.componentOrCircuit],['test location',result.testLocation],['test method',result.method],['criterion',result.criterion]];result.missingRequiredFields=[...new Set([...result.missingRequiredFields,...required.filter(([,value])=>!value).map(([field])=>field)])];if(result.missingRequiredFields.length)result.status='INCOMPLETE';return {...result,analysisRunId:run.runId,extractionRunId:run.runId}
  }
  function canonicalSourceNumber(...candidates){for(const candidate of candidates){if(typeof candidate==='number'&&Number.isFinite(candidate))return candidate;if(typeof candidate==='string'){const normalized=candidate.trim().replace(/[−–—]/g,'-').replace(/\s*(?:%|V|RPM)\s*$/i,'');if(/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)){const numeric=Number(normalized);if(Number.isFinite(numeric))return numeric}}}return null}
  function renderedNumberText(value,unit,precision){if(!Number.isFinite(value))return'unavailable';if(String(unit).toUpperCase()==='RPM')return`${value.toFixed(precision)} RPM`;return`${value>0?'+':''}${value.toFixed(precision)}${unit}`}
  function parseFinalRenderedNumber(text,unit){if(typeof text!=='string'||text==='unavailable')return null;const suffix=String(unit||''),numericText=(suffix&&text.endsWith(suffix)?text.slice(0,-suffix.length):text).trim();if(!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(numericText))return null;const numeric=Number(numericText);return Number.isFinite(numeric)?numeric:null}
  function renderedTripletValidation(row){const currentNumeric=parseFinalRenderedNumber(row.currentText,row.unit),minNumeric=parseFinalRenderedNumber(row.minText,row.unit),maxNumeric=parseFinalRenderedNumber(row.maxText,row.unit),finiteNumbers=[currentNumeric,minNumeric,maxNumeric].every(Number.isFinite),minimumLessThanOrEqualMaximum=finiteNumbers&&minNumeric<=maxNumeric,minimumLessThanOrEqualCurrent=finiteNumbers&&minNumeric<=currentNumeric,currentLessThanOrEqualMaximum=finiteNumbers&&currentNumeric<=maxNumeric,chainPass=minimumLessThanOrEqualCurrent&&currentLessThanOrEqualMaximum,evidenceState=!finiteNumbers?'INCOMPLETE':minimumLessThanOrEqualMaximum&&chainPass?'COMPLETE_VALID':'INCONSISTENT',tripletResult=evidenceState==='COMPLETE_VALID'?'PASS':evidenceState==='INCOMPLETE'?'UNVERIFIABLE':'FAIL',numericConsistencyStatus=evidenceState==='COMPLETE_VALID'?'PASS':evidenceState==='INCOMPLETE'?'INCOMPLETE':'FAIL — INCONSISTENT';let invariantFailureReason='';if(evidenceState==='INCOMPLETE')invariantFailureReason='Current, Min, or Max is unavailable or unparseable.';else if(!minimumLessThanOrEqualMaximum)invariantFailureReason='Min exceeds Max.';else if(!minimumLessThanOrEqualCurrent)invariantFailureReason='Current is below Min.';else if(!currentLessThanOrEqualMaximum)invariantFailureReason='Current exceeds Max.';return{currentNumeric,minNumeric,maxNumeric,finiteNumbers,minimumLessThanOrEqualMaximum,minimumLessThanOrEqualCurrent,currentLessThanOrEqualMaximum,chainPass,invariantPass:tripletResult==='PASS',evidenceState,numericConsistencyStatus,tripletResult,invariantFailureReason}}
  function createRenderedNumericTriplet(source){const unit=String(source?.unit||''),precision=Number.isInteger(source?.precision)?source.precision:unit.toUpperCase()==='RPM'?0:3,round=value=>Number.isFinite(value)?Number(value.toFixed(precision)):null,currentCandidate=round(canonicalSourceNumber(source?.currentNumeric,source?.current,source?.rawCurrent)),minCandidate=round(canonicalSourceNumber(source?.minNumeric,source?.minimum,source?.numericRange?.minimum,source?.rawMinimum)),maxCandidate=round(canonicalSourceNumber(source?.maxNumeric,source?.maximum,source?.numericRange?.maximum,source?.rawMaximum)),text={currentText:renderedNumberText(currentCandidate,unit,precision),minText:renderedNumberText(minCandidate,unit,precision),maxText:renderedNumberText(maxCandidate,unit,precision)},validation=renderedTripletValidation({...text,unit}),pidName=String(source?.pidName||'Unknown PID'),sourceMetadata=Object.freeze({rawCurrentCandidate:source?.rawCurrent??null,rawMinCandidate:source?.rawMinimum??null,rawMaxCandidate:source?.rawMaximum??null,boundCurrent:currentCandidate,boundMin:minCandidate,boundMax:maxCandidate,sourceField:String(source?.sourceField||'FINAL_NORMALIZED_PID_CURRENT_MIN_MAX'),bindingIdentifier:`${pidName}:${String(source?.sourceField||'FINAL_NORMALIZED_PID_CURRENT_MIN_MAX')}`,sourceRegion:source?.sourceRegions||null,candidateAudit:source?.candidateAudit||null,confidence:source?.confidence??null,parseStatus:validation.tripletResult==='UNVERIFIABLE'?'INCOMPLETE_OR_UNPARSEABLE':'COMPLETE',rejectedCandidates:Object.freeze([...(source?.rejectedCandidates||[])])});return Object.freeze({pidName,unit,precision,...text,...validation,sourceMetadata,currentDisplay:text.currentText,minDisplay:text.minText,maxDisplay:text.maxText,parsedCurrent:validation.currentNumeric,parsedMin:validation.minNumeric,parsedMax:validation.maxNumeric,displayCurrent:text.currentText,displayMinimum:text.minText,displayMaximum:text.maxText,current:validation.currentNumeric,minimum:validation.minNumeric,maximum:validation.maxNumeric,invariantResult:validation.tripletResult,violationReason:validation.invariantFailureReason})}
  function validateFinalRenderedPid(row){return renderedTripletValidation(row)}
  function assertFinalRenderedPidEvidence(rows){const renderedPidEvidence=Array.isArray(rows)?rows:[],invalid=renderedPidEvidence.filter(row=>renderedTripletValidation(row).evidenceState==='INCONSISTENT'),unverifiable=renderedPidEvidence.filter(row=>renderedTripletValidation(row).evidenceState==='INCOMPLETE'),failed=[...invalid,...unverifiable],status=invalid.length?'FAIL':unverifiable.length?'INCOMPLETE':'PASS';return Object.freeze({renderedPidEvidence,invalid,unverifiable,failed,status})}
  function finalObservedFromRenderedTriplets(observed,rows){const finalRows=Array.isArray(rows)?rows:[],canonicalPattern=row=>row.unit.toUpperCase()==='RPM'?/\b(?:Engine Speed(?:\s*\(RPM\))?|Engine RPM|RPM)\b/i:new RegExp(row.pidName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'),isSupersededNumericObservation=item=>finalRows.some(row=>canonicalPattern(row).test(String(item||''))&&/[-+]?\d|\b(?:Current|Min(?:imum)?|Max(?:imum)?)\b/i.test(String(item||''))),nonNumericObserved=(Array.isArray(observed)?observed:[]).filter(item=>!isSupersededNumericObservation(item)),tripletObserved=finalRows.map(row=>`${row.pidName}${row.unit?` (${row.unit})`:''} — Min: ${row.minText}; Current: ${row.currentText}; Max: ${row.maxText}`);return Object.freeze([...nonNumericObserved,...tripletObserved])}
  function reconcileCanonicalNumericRows(rows){const sourceRows=Array.isArray(rows)?rows:[],isEngineSpeed=row=>/\b(?:Engine Speed(?:\s*\(RPM\))?|Engine RPM)\b/i.test(String(row?.pidName||''))||/^RPM$/i.test(String(row?.pidName||'')),engineRows=sourceRows.filter(isEngineSpeed),otherRows=sourceRows.filter(row=>!isEngineSpeed(row));if(!engineRows.length)return sourceRows;const collect=(role,aliases)=>engineRows.flatMap((row,index)=>{const value=canonicalSourceNumber(...aliases.map(alias=>row?.[alias]));return value===null?[]:[{value,source:String(row?.sourceField||`ENGINE_SPEED_SOURCE_${index}`),rowIndex:index}]}),currentCandidates=collect('current',['currentNumeric','current','rawCurrent']),minimumCandidates=collect('minimum',['minNumeric','minimum','numericRange.minimum','rawMinimum']),maximumCandidates=collect('maximum',['maxNumeric','maximum','numericRange.maximum','rawMaximum']),select=candidates=>{const unique=[...new Set(candidates.map(candidate=>candidate.value))];return unique.length===1?unique[0]:null},current=select(currentCandidates),minimum=select(minimumCandidates),maximum=select(maximumCandidates),candidateAudit=Object.freeze({canonicalPid:'Engine Speed',canonicalPidName:'Engine Speed (RPM)',currentCandidates:Object.freeze(currentCandidates),minimumCandidates:Object.freeze(minimumCandidates),maximumCandidates:Object.freeze(maximumCandidates),selectedCurrent:current,selectedMinimum:minimum,selectedMaximum:maximum,duplicateCanonicalRecordsRemoved:Math.max(0,engineRows.length-1),rawEvidenceTokens:Object.freeze(engineRows.flatMap(row=>row?.candidateAudit?.rawEvidenceTokens||row?.sourceRegions||[])),candidates:Object.freeze([{role:'current',value:current,status:current===null?'REJECTED':'ACCEPTED',reason:current===null?'MISSING_OR_CONFLICTING_CANONICAL_CANDIDATES':'CANONICAL_CANDIDATE_RECONCILIATION'},{role:'minimum',value:minimum,status:minimum===null?'REJECTED':'ACCEPTED',reason:minimum===null?'MISSING_OR_CONFLICTING_CANONICAL_CANDIDATES':'CANONICAL_CANDIDATE_RECONCILIATION'},{role:'maximum',value:maximum,status:maximum===null?'REJECTED':'ACCEPTED',reason:maximum===null?'MISSING_OR_CONFLICTING_CANONICAL_CANDIDATES':'CANONICAL_CANDIDATE_RECONCILIATION'}])}),merged=Object.freeze({...engineRows[0],pidName:'Engine Speed',canonicalPidName:'Engine Speed (RPM)',unit:'RPM',current,minimum,maximum,currentNumeric:current,minNumeric:minimum,maxNumeric:maximum,candidateAudit,rejectedCandidates:candidateAudit.candidates.filter(candidate=>candidate.status==='REJECTED'),sourceField:'RECONCILED_ENGINE_SPEED_AUTHORITATIVE_TRIPLET'});return Object.freeze([...otherRows,merged])}
  function closedLoopNextTestSelection(graph){const testName='Acquire Fuel System Status / Closed Loop Status to verify whether the engine was operating in closed loop when the PID evidence was captured.',selectionReason="Fuel System Status is not available in the current evidence and is required to establish whether the ECM was operating in closed loop when the captured mixture and fuel-trim PID values were recorded.",diagnosticObjective='Establish the PCM fuel-control state for the captured mixture and fuel-trim evidence.',evidenceMissing=Object.freeze(['Fuel System Status / Closed Loop state']),evidenceAlreadyAvailable=Object.freeze([...(graph?.evidenceInventory?.channels||[])]),selectedNextTest=Object.freeze({testName,diagnosticObjective,evidenceAlreadyAvailable,evidenceMissing,selectionReason,blockedInterpretation:'Fuel-trim and mixture-related PID interpretation cannot be assigned full significance without PCM fuel-control state.',source:'CANONICAL_EVIDENCE_AWARE_NEXT_TEST_SELECTOR'}),nextTestRationaleAligned=/Fuel System Status|Closed Loop/i.test(testName)&&/fuel-control|closed loop/i.test(diagnosticObjective)&&/Fuel System Status|closed loop/i.test(selectionReason);return Object.freeze({selectedNextTest,nextTestRationaleAligned,nextTest:nextTestRationaleAligned?[testName]:['Undetermined — next-test rationale could not be aligned with available evidence.'],nextTestReason:nextTestRationaleAligned?selectionReason:'A reliable evidence-aligned next test could not be established from the current snapshot.'})}
  function finalizeRenderedNumericEvidence(graph){
    if(!graph||typeof graph!=='object')return graph;
    const rawRows=reconcileCanonicalNumericRows(graph.numericEvidence),initialRows=Object.freeze(rawRows.map(createRenderedNumericTriplet)),recoveryRows=Array.isArray(graph.targetedPidRecovery)?graph.targetedPidRecovery:[],samePid=(left,right)=>String(left||'').trim().toLowerCase()===String(right||'').trim().toLowerCase(),targetedRecoveryLog=[],renderedPidEvidence=Object.freeze(initialRows.map((initial,index)=>{if(initial.evidenceState!=='INCONSISTENT'){targetedRecoveryLog.push(Object.freeze({pidName:initial.pidName,initialTriplet:Object.freeze({current:initial.currentNumeric,min:initial.minNumeric,max:initial.maxNumeric}),initialEvidenceState:initial.evidenceState,recoveryAttempted:'NO',recoverySourceGenerationId:null,recoveredCurrent:null,recoveredMin:null,recoveredMax:null,finalTriplet:Object.freeze({current:initial.currentNumeric,min:initial.minNumeric,max:initial.maxNumeric}),finalEvidenceState:initial.evidenceState}));return initial}const recovery=recoveryRows.find(item=>samePid(item?.pidName,initial.pidName)),identityMatch=Boolean(recovery&&recovery.semanticRequestId===graph.semanticRequestId&&recovery.imageHash===graph.imageHash&&recovery.generationId===graph.semanticRequestId),completeRecovery=identityMatch&&[recovery.current,recovery.minimum,recovery.maximum].every(Number.isFinite),finalRow=completeRecovery?createRenderedNumericTriplet({...rawRows[index],current:recovery.current,minimum:recovery.minimum,maximum:recovery.maximum,currentNumeric:recovery.current,minNumeric:recovery.minimum,maxNumeric:recovery.maximum,rawCurrent:recovery.current,rawMinimum:recovery.minimum,rawMaximum:recovery.maximum,sourceField:'TARGETED_CURRENT_GENERATION_PID_RECOVERY',sourceRegions:recovery.visibleEvidence||[],candidateAudit:Object.freeze({canonicalPid:initial.pidName,rawEvidenceTokens:Object.freeze([...(recovery.visibleEvidence||[])]),recoveryGenerationId:recovery.generationId,candidates:Object.freeze([{role:'current',value:recovery.current,status:'ACCEPTED',reason:'CURRENT_IMAGE_TARGETED_RECOVERY'},{role:'minimum',value:recovery.minimum,status:'ACCEPTED',reason:'CURRENT_IMAGE_TARGETED_RECOVERY'},{role:'maximum',value:recovery.maximum,status:'ACCEPTED',reason:'CURRENT_IMAGE_TARGETED_RECOVERY'}])})}):initial;targetedRecoveryLog.push(Object.freeze({pidName:initial.pidName,initialTriplet:Object.freeze({current:initial.currentNumeric,min:initial.minNumeric,max:initial.maxNumeric}),initialEvidenceState:initial.evidenceState,recoveryAttempted:'YES',recoverySourceGenerationId:identityMatch?recovery.generationId:null,recoveryIdentityStatus:identityMatch?'PASS':'REJECTED_OR_UNAVAILABLE',recoveredCurrent:completeRecovery?recovery.current:null,recoveredMin:completeRecovery?recovery.minimum:null,recoveredMax:completeRecovery?recovery.maximum:null,finalTriplet:Object.freeze({current:finalRow.currentNumeric,min:finalRow.minNumeric,max:finalRow.maxNumeric}),finalEvidenceState:finalRow.evidenceState}));return finalRow})),assertion=assertFinalRenderedPidEvidence(renderedPidEvidence),finalCanonicalPidEvidence=renderedPidEvidence,failed=assertion.failed,finalRenderValidationStatus=assertion.status;
    const renderedInvariantLog=Object.freeze(renderedPidEvidence.map(row=>Object.freeze({pidName:row.pidName,canonicalPidName:row.unit.toUpperCase()==='RPM'?'Engine Speed (RPM)':row.pidName,rawEvidenceTokens:row.sourceMetadata.candidateAudit?.rawEvidenceTokens||[],candidateAudit:row.sourceMetadata.candidateAudit,rawCurrentCandidate:row.sourceMetadata.rawCurrentCandidate,rawMinCandidate:row.sourceMetadata.rawMinCandidate,rawMaxCandidate:row.sourceMetadata.rawMaxCandidate,boundCurrent:row.sourceMetadata.boundCurrent,boundMin:row.sourceMetadata.boundMin,boundMax:row.sourceMetadata.boundMax,currentNumeric:row.currentNumeric,minNumeric:row.minNumeric,maxNumeric:row.maxNumeric,currentText:row.currentText,minText:row.minText,maxText:row.maxText,finalRenderedTriplet:`Min ${row.minText} / Current ${row.currentText} / Max ${row.maxText}`,unit:row.unit,evidenceState:row.evidenceState,parseStatus:row.sourceMetadata.parseStatus,bindingIdentifier:row.sourceMetadata.bindingIdentifier,rejectedCandidates:row.sourceMetadata.rejectedCandidates,duplicateCanonicalRecordsRemoved:row.sourceMetadata.candidateAudit?.duplicateCanonicalRecordsRemoved||0,finiteNumberValidation:row.finiteNumbers?'PASS':'FAIL',minimumLessThanOrEqualMaximum:row.minimumLessThanOrEqualMaximum?'PASS':'FAIL',minimumLessThanOrEqualCurrentAndCurrentLessThanOrEqualMaximum:row.chainPass?'PASS':'FAIL',renderedInvariant:row.invariantResult})));
    const result={...graph,targetedRecoveryLog:Object.freeze(targetedRecoveryLog),renderedPidEvidence,finalCanonicalPidEvidence,renderedInvariantLog,finalRenderValidationStatus,evidenceResultVerification:finalRenderValidationStatus==='PASS'&&graph.semanticConsistencyStatus!=='FAIL'?'PASS':finalRenderValidationStatus,numericValidation:{...(graph.numericValidation||{}),validationStage:'POST_TARGETED_RECOVERY_SHARED_RENDERED_NUMERIC_TRIPLET_HARD_GATE',authoritativeSource:'SHARED_IMMUTABLE_RENDERED_NUMERIC_TRIPLET',finalRenderValidationStatus,currentMinMaxConsistency:finalRenderValidationStatus==='PASS'?'PASS':finalRenderValidationStatus,invalidPidEvidence:failed.map(row=>row.pidName)},freshResultVerification:graph.freshResultVerification};
    if(failed.length){const names=failed.map(row=>row.pidName),namePattern=new RegExp(names.map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace('Long FT #1','(?:Long FT #1|LTFT(?: B1)?)').replace('Short FT #1','(?:Short FT #1|STFT(?: B1)?)').replace('Engine Speed','(?:Engine Speed(?:\\s*\\(RPM\\))?|Engine RPM|RPM)')).join('|'),'i'),first=failed[0],incomplete=failed.filter(row=>row.evidenceState==='INCOMPLETE'),inconsistent=failed.filter(row=>row.evidenceState==='INCONSISTENT'),details=failed.map(row=>`${row.pidName} displays Current ${row.displayCurrent}, Min ${row.displayMinimum}, and Max ${row.displayMaximum}; ${row.violationReason}`).join(' '),selection=closedLoopNextTestSelection(graph);result.interpretation=(graph.interpretation||[]).filter(item=>!namePattern.test(item));result.interpretation.unshift(inconsistent.length?`Numeric evidence is internally inconsistent. ${details} Interpretation of the conflicting PID evidence is indeterminate.`:`${first.pidName} numeric evidence is incomplete because Min and/or Max could not be reliably recovered. Interpretation requiring the complete ${first.pidName} triplet is indeterminate.`);result.traceFindings=(graph.traceFindings||[]).filter(item=>!namePattern.test(item));result.diagnosticSignificance='INDETERMINATE';result.diagnosticSignificanceReason=inconsistent.length?'RENDERED_NUMERIC_EVIDENCE_INCONSISTENT':'RENDERED_NUMERIC_EVIDENCE_INCOMPLETE';result.semanticConsistencyStatus=inconsistent.length?'FAIL_NUMERIC_EVIDENCE':'INCOMPLETE_NUMERIC_EVIDENCE';result.nextTest=selection.nextTest;result.nextTestReason=selection.nextTestReason;result.selectedNextTest=selection.selectedNextTest;result.nextTestRationaleAligned=selection.nextTestRationaleAligned;result.nextTestSelection=selection.nextTestRationaleAligned?'PASS':'INDETERMINATE';result.unresolvedQuestion='Was the engine operating in closed loop when this evidence was captured?';result.evidenceLimitations=Object.freeze(failed.map(row=>`${row.pidName}: ${row.violationReason}`))}
    return result;
  }
  window.NitrosValidateFinalRenderedPid=validateFinalRenderedPid;
  window.NitrosAssertFinalRenderedPidEvidence=assertFinalRenderedPidEvidence;
  window.NitrosFinalizeRenderedNumericEvidence=finalizeRenderedNumericEvidence;
  function normalizeVisionResult(raw,run){
    if(!isActive(run))throw abortError();
    if(!raw||typeof raw!=='object')throw new Error('No semantic vision analyzer returned a structured result.');
    if(raw.transactionId!==run.analyzer.requestId)throw new Error('Semantic result transaction ID does not match the current semantic request.');
    if(raw.imageHash!==run.imageHash)throw new Error('Semantic result image hash does not match the current image.');
    const category=String(raw.category||'');
    if(!CATEGORIES.has(category))throw new Error('Semantic vision analyzer returned no supported category.');
    const confidence=raw.normalizedConfidence===null?null:Number(raw.normalizedConfidence??raw.confidence);
    if(confidence!==null&&(!Number.isFinite(confidence)||confidence<0||confidence>100))throw new Error('Semantic confidence is invalid.');
    const evidence=stringArray(raw.evidence,'evidence'),objects=stringArray(raw.objects,'objects'),automotiveEvidence=stringArray(raw.automotiveEvidence,'automotiveEvidence'),graphEvidence=stringArray(raw.graphEvidence,'graphEvidence'),documentEvidence=stringArray(raw.documentEvidence,'documentEvidence');
    if(category!=='UNKNOWN_OR_ANALYSIS_UNAVAILABLE'&&!evidence.length)throw new Error('Semantic vision analyzer returned no positive evidence.');
    if(category==='AUTOMOTIVE_GRAPH'&&graphEvidence.length<2)throw new Error('Graph classification lacks independent structural evidence.');
    if(category==='AUTOMOTIVE_COMPONENT_OR_VEHICLE'&&!automotiveEvidence.length){const fallback=[...evidence,...objects].filter(Boolean);if(!fallback.length)throw new Error('Automotive classification lacks positive visual evidence.');automotiveEvidence.push(...fallback);run.analyzer.nonfatalClassificationDegradation='AUTOMOTIVE_EVIDENCE_DERIVED_FROM_CURRENT_RESPONSE';}
    const componentIdentification=normalizeComponentIdentification(raw.componentIdentification,category,run),vehicleAreaRelationshipAnalysis=normalizeVehicleAreaRelationship(raw.vehicleAreaRelationshipAnalysis,category,run),visualConditionInspection=normalizeVisualConditionInspection(raw.visualConditionInspection,category,run);
    const wiringDiagramAnalysis=normalizeWiringDiagram(raw.wiringDiagramAnalysis,category,run),documentRepairInformation=normalizeDocumentRepairInformation(raw.documentRepairInformation,category,run);let automotiveGraphAnalysis=category==='AUTOMOTIVE_GRAPH'&&raw.automotiveGraphAnalysis?finalizeRenderedNumericEvidence({...raw.automotiveGraphAnalysis}):null;if(automotiveGraphAnalysis?.postRecoveryReasoning&&automotiveGraphAnalysis.targetedRecoveryLog?.some(item=>item.recoveryAttempted==='YES'&&item.finalEvidenceState==='COMPLETE_VALID')){const post=automotiveGraphAnalysis.postRecoveryReasoning;automotiveGraphAnalysis={...automotiveGraphAnalysis,interpretation:post.interpretation,traceFindings:post.traceFindings,diagnosticSignificance:post.diagnosticSignificance,diagnosticSignificanceReason:post.diagnosticSignificanceReason,semanticConsistencyStatus:post.semanticConsistencyStatus,nextTest:post.nextTest,nextTestReason:post.nextTestReason,nextTestSelection:post.nextTestSelection,unresolvedQuestion:post.unresolvedQuestion,reasoningEvidence:post.reasoningEvidence,evidenceInventory:post.evidenceInventory,evidenceInventoryStatus:post.evidenceInventoryStatus};}
    if(category==='AUTOMOTIVE_GRAPH'&&(!automotiveGraphAnalysis||automotiveGraphAnalysis.semanticRequestId!==run.analyzer.requestId||automotiveGraphAnalysis.imageHash!==run.imageHash))throw new Error('Automotive graph analysis is missing or does not match the current image.');
    if(automotiveGraphAnalysis)automotiveGraphAnalysis={...automotiveGraphAnalysis,freshResultVerification:'PASS',freshResultProvenance:Object.freeze({status:'PASS',runId:run.runId,semanticRequestId:run.analyzer.requestId,imageHash:run.imageHash,transactionMatch:'PASS',imageHashMatch:'PASS',activeRunMatch:'PASS'})};
    const vehicleContextApplied=raw.vehicleContextApplied&&typeof raw.vehicleContextApplied==='object'?{available:raw.vehicleContextApplied.available===true,summary:String(raw.vehicleContextApplied.summary||'').trim()}:null,vehicleContextBinding=raw.vehicleContextBinding&&typeof raw.vehicleContextBinding==='object'?raw.vehicleContextBinding:null,requestedVehicleContext=run.analyzer.vehicleContextSnapshot||null;
    if(requestedVehicleContext&&(!vehicleContextBinding||!sameVehicleContext(requestedVehicleContext,vehicleContextBinding)||!sameVehicleContext(requestedVehicleContext,activeVehicleAnalysisContext()))){run.analyzer.vehicleContextValidation='BLOCKED';run.analyzer.vehicleContextMismatchBlocked=true;throw new Error('Vehicle context mismatch — stale vehicle-aware result was blocked. Re-run analysis for the active repair order.');}
    return {runId:run.runId,semanticRequestId:raw.transactionId,imageHash:raw.imageHash,category,confidence,rawConfidence:raw.rawConfidence??null,normalizedConfidence:confidence,componentIdentification,vehicleAreaRelationshipAnalysis,visualConditionInspection,automotiveGraphAnalysis,wiringDiagramAnalysis,documentRepairInformation,objects,evidence,description:String(raw.description||'').trim(),automotiveEvidence,graphEvidence,documentEvidence,vehicleContextApplied,vehicleContextBinding,source:String(raw.source||'NitrosVisionAnalyzer semantic result'),transportStatus:raw.transportStatus??null,routingData:raw.routingData??null};
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
    const requestBytes=run.analysisBytes.slice(0);
    run.analyzer.requestStarted=new Date().toISOString();
    let raw,lastError;
    for(let analysisAttempt=1;analysisAttempt<=2;analysisAttempt+=1){
      try{run.analyzer.analysisAttempt=analysisAttempt;if(analysisAttempt===2){run.analyzer.retryStatus='RUNNING';run.analyzer.responseShapeNormalized=false;run.analyzer.semanticPayloadLocated=false;run.analyzer.semanticPayloadParsed=false;run.analyzer.canonicalNormalizationSuccessful=false;run.analyzer.semanticObjectCount=0;syncSemanticStages(run);updateDeveloper(run,{disposition:'SEMANTIC RETRY RUNNING'})}
        raw=await analyzer.analyzeCurrentImage({bytes:requestBytes,blob:new Blob([requestBytes],{type:run.mime}),mimeType:run.analysisMime,runId:run.analyzer.requestId,imageHash:run.imageHash,vehicleContextSnapshot:run.analyzer.vehicleContextSnapshot,signal:run.controller.signal,diagnostic:run.analyzer,onDiagnostic:()=>{syncSemanticStages(run);updateDeveloper(run,{disposition:'ANALYZING'})},cache:'no-store',analysisAttempt});
        if(analysisAttempt===2)run.analyzer.retryStatus='PASS';break;
      }catch(error){lastError=error;const retryable=Boolean(error?.retryable)&&['empty_model_response','malformed_semantic_response','unsupported_response_shape'].includes(error?.diagnosticCategory);if(analysisAttempt===1&&retryable)continue;if(analysisAttempt===2)run.analyzer.retryStatus='FAIL';throw error}
    }
    if(!raw)throw lastError||diagnosticError('Semantic response is unavailable.','empty_model_response');
    run.analyzer.requestCompleted=new Date().toISOString();run.analyzer.transportStatus=raw?.transportStatus??null;run.analyzer.resultReceived=true;
    run.analyzer.pipeline={...run.analyzer.pipeline,CLASSIFICATION_STARTED:'PASS'};run.analyzer.stage='CLASSIFICATION_STARTED';updateDeveloper(run,{disposition:'ANALYZING'});
    try{const normalized=normalizeVisionResult(raw,run);run.analyzer.responseValidated=true;run.analyzer.stage='CLASSIFICATION_COMPLETE';run.analyzer.pipeline={...run.analyzer.pipeline,CLASSIFICATION_COMPLETE:'PASS'};return normalized}
    catch(error){Object.assign(run.analyzer,{outcome:'FAILED',stage:'SEMANTIC_VALIDATION_FAILED',errorCategory:'SEMANTIC_API_ERROR',errorName:sanitizeDiagnosticText(error.name),errorMessage:sanitizeDiagnosticText(error.message),likelyLayer:'Semantic response validation',completedAt:new Date().toISOString(),pipeline:{...run.analyzer.pipeline,CLASSIFICATION_COMPLETE:'FAIL'}});throw tagDiagnosticError(error,'SEMANTIC_API_ERROR')}
  }

  async function routeFreshResult(run,result){
    const payload={bytes:run.bytes.slice(0),mimeType:run.mime,runId:run.runId,imageHash:run.imageHash,signal:run.controller.signal,cache:'no-store',classification:result};
    if(result.category==='AUTOMOTIVE_GRAPH'){
      result.route='Automotive graph analysis';
      const graph=result.automotiveGraphAnalysis,fresh=graph.freshResultVerification==='PASS',evidenceVerified=graph.status!=='FAILED'&&graph.finalRenderValidationStatus==='PASS'&&graph.semanticConsistencyStatus!=='FAIL';
      result.routeResult={status:evidenceVerified?'Diagnostic interpretation complete':'Analysis withheld pending evidence reconciliation',evidence:[...graph.observed],freshResultVerification:fresh?'PASS':'FAIL',evidenceResultVerification:evidenceVerified?'PASS':graph.finalRenderValidationStatus};
    }else if(result.category==='AUTOMOTIVE_WIRING_DIAGRAM'){
      result.route='Wiring diagram / guided component test';
      result.routeResult={status:result.wiringDiagramAnalysis?.status==='READY'?'Circuit analysis ready':'Insufficient diagram readability',evidence:[...(result.wiringDiagramAnalysis?.structuralEvidence||[])]};
    }else if(result.category==='DOCUMENT_OR_TEXT_SCREENSHOT'){
      result.route='Document/OCR';
      const extraction=result.documentRepairInformation,fresh=extraction?.semanticRequestId===run.analyzer.requestId&&extraction?.imageHash===run.imageHash&&extraction?.extractionRunId===run.runId,missing=[...(extraction?.missingRequiredFields||[])],complete=fresh&&!missing.length;result.documentRepairInformation={...extraction,missingRequiredFields:missing,verificationMissingFields:[...missing],freshResultVerification:fresh?'PASS':'FAIL',extractionStatus:complete?'COMPLETE':'INCOMPLETE',verifiedRepairInformationStatus:complete?'VERIFIED':'PENDING',verificationRunId:run.runId,synchronizationStatus:fresh?'PASS':'FAIL'};
      result.isolationTests=[];
      result.routeResult={status:complete?'Document test extraction complete':extraction?.status==='UNREADABLE'?'Document text unreadable':'Document test extraction incomplete',evidence:extraction?.visibleTextEvidence||[],missingRequiredFields:missing};
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
    if(result?.semanticRequestId&&result.semanticRequestId!==activeRun?.analyzer?.requestId)failed.push('Semantic Request ID');
    if(result?.imageHash!==activeRun?.imageHash)failed.push('Image SHA-256');
    if(run?.analyzer?.vehicleContextSnapshot&&!sameVehicleContext(run.analyzer.vehicleContextSnapshot,activeVehicleAnalysisContext()))failed.push('Vehicle Context Snapshot');
    if(!failed.length)return false;
    if(run?.analyzer)run.analyzer.staleRejected=true;
    lastStaleRejected=true;
    lastStaleMessage=`STALE RESULT REJECTED — RESULT NOT DISPLAYED (${failed.join(', ')})`;
    updateDeveloper(activeRun,{disposition:lastStaleMessage});
    return true;
  }

  const CONCLUSION_LABELS={CONTINUE:'TESTING — continue testing',VERIFIED_COMPONENT_FAILURE:'VERIFIED: component failure',VERIFIED_POWER_SUPPLY_FAULT:'VERIFIED: supply-circuit fault',VERIFIED_GROUND_FAULT:'VERIFIED: circuit return fault',VERIFIED_CONTROL_CIRCUIT_FAULT:'VERIFIED: control-circuit fault',VERIFIED_SIGNAL_CIRCUIT_FAULT:'VERIFIED: signal-circuit fault',POSSIBLE_MODULE_DRIVER_FAULT_FURTHER_TESTING_REQUIRED:'SUSPECTED: possible module/driver fault — further testing required',COMPONENT_PASSES_CURRENT_TESTS:'PASSED: component passes current tests',INSUFFICIENT_EVIDENCE:'SUPPORTED BY TEST RESULTS, not verified — additional evidence required'};
  function evaluateGuidedResult(step,text){
    const value=String(text||'').trim(),lower=value.toLowerCase(),match=lower.match(/-?\d+(?:\.\d+)?/),numeric=match?Number(match[0]):null;
    if(numeric!==null&&(step.expectedMin!==null||step.expectedMax!==null)){const min=step.expectedMin??-Infinity,max=step.expectedMax??Infinity;return {status:numeric>=min&&numeric<=max?'PASS':'FAIL',interpretation:`Measured ${value}; expected ${step.expectedBehavior}.`}}
    const negative=/\b(?:no|none|zero|dead|missing|absent|failed|dim)\b|\bol\b|open circuit|no pulse/.test(lower),positive=/\b(?:good|bright|present|passes|pass|normal|square|pulse|working)\b/.test(lower);
    if(numeric!==null)return {status:'INCONCLUSIVE',interpretation:`${value} has been recorded at ${step.redLead} relative to ${step.blackLead}. That reading alone does not verify a fault because no reliable numeric specification is available. Additional circuit testing is required.`};
    if(['POWER_PRESENT','CONTROL_PRESENT','SIGNAL_PRESENT','CONTINUITY_GOOD'].includes(step.evaluationType)){if(negative)return {status:'FAIL',interpretation:`Result does not show the expected ${step.expectedBehavior}.`};if(positive)return {status:'PASS',interpretation:`Result supports ${step.expectedBehavior}.`}}
    if(step.evaluationType==='GROUND_GOOD'){if(/ground is good|bright|passes|pass/.test(lower))return {status:'PASS',interpretation:'Ground test passes under the stated test condition.'};if(/bad ground|dim|open|ol/.test(lower))return {status:'FAIL',interpretation:'Ground path does not pass the stated test.'}}
    if(step.evaluationType==='VOLTAGE_DROP_LOW'){if(positive||/low drop/.test(lower))return {status:'PASS',interpretation:'Reported voltage drop passes.'};if(/high drop|excessive/.test(lower))return {status:'FAIL',interpretation:'Reported voltage drop is excessive.'}}
    return {status:'INCONCLUSIVE',interpretation:`Result recorded as “${value},” but it cannot be compared reliably without clarification or a visible/supplied specification.`};
  }
  function isResistanceTest(step){return /ohm|resistance|continuity/i.test(`${step.tool} ${step.instructions} ${step.evaluationType}`)}
  function isDeenergized(step){return /key\s*off|de-energized|deenergized/i.test(`${step.instructions} ${step.operatingCondition}`)}
  function evidenceRecord(session,step,measurement,evaluation){return {testNumber:session.completedTests.length+1,component:session.circuitComponent,circuitPin:step.redLead,ignitionState:step.operatingCondition,connectorState:step.connectorCondition,meterMode:step.tool,redLeadLocation:step.redLead,blackLeadLocation:step.blackLead,technicianReading:measurement,expectedBehavior:step.expectedBehavior,interpretation:evaluation.interpretation,result:evaluation.status,timestamp:new Date().toISOString()}}
  function verificationSupported(session,step){const failed=session.completedTests.filter(item=>item.result==='FAIL');return failed.length>=2&&/isolat|both ends|module connector|ecm connector|pcm connector/i.test(`${step.objective} ${step.instructions} ${step.connectorCondition}`)}
  function renderGuidedTest(run,host){
    const session=run.componentTestSession;if(!session||!host)return;
    const completed=session.completedTests.map(item=>`<li>TEST ${item.testNumber} — ${escapeHtml(item.circuitPin)} — ${escapeHtml(item.technicianReading)} — ${escapeHtml(item.result)}<br>${escapeHtml(item.interpretation)}</li>`).join('');
    if(session.conclusion&&session.conclusion!=='CONTINUE'){host.innerHTML=`<strong>Diagnostic conclusion:</strong> ${escapeHtml(CONCLUSION_LABELS[session.conclusion]||session.conclusion)}${completed?`<ul>${completed}</ul>`:''}`;return}
    const step=session.testPlan[session.currentStep];if(!step){session.conclusion='INSUFFICIENT_EVIDENCE';renderGuidedTest(run,host);return}
    if(isResistanceTest(step)&&!isDeenergized(step)){host.innerHTML='<strong>TEST BLOCKED — INVALID TEST CONDITION</strong><p>Key OFF. Circuit must be de-energized before resistance/continuity testing.</p>';return}
    host.innerHTML=`<strong>Diagnostic confidence:</strong> ${escapeHtml(session.confidenceState)}<br><strong>Current test:</strong> ${escapeHtml(step.objective)}<br><strong>Meter mode:</strong> ${escapeHtml(step.tool)}<br><strong>Procedure:</strong> ${escapeHtml(step.instructions)}<br><strong>Red lead:</strong> ${escapeHtml(step.redLead)}<br><strong>Black lead:</strong> ${escapeHtml(step.blackLead)}<br><strong>Connector state:</strong> ${escapeHtml(step.connectorCondition)}<br><strong>Ignition/engine state:</strong> ${escapeHtml(step.operatingCondition)}<br><strong>Circuit loading:</strong> ${step.loaded?'loaded':'not loaded'}<br><strong>Expected behavior:</strong> ${escapeHtml(step.expectedBehavior)}${session.lastInterpretation?`<p>${escapeHtml(session.lastInterpretation)}</p>`:''}${completed?`<details><summary>Diagnostic evidence log</summary><ol>${completed}</ol></details>`:''}<label><input class="guided-test-confirm" type="checkbox"> I confirm the connector, ignition/engine, meter mode, and lead locations shown above.</label><label>Technician result<input class="guided-test-result" type="text" autocomplete="off" placeholder="Example: 5.02 V, 8 volts, 0 V, OL"></label><button class="oliver-import-action guided-test-submit" type="button">SUBMIT TEST RESULT</button>`;
    host.querySelector('.guided-test-submit').onclick=()=>{const input=host.querySelector('.guided-test-result'),confirmed=host.querySelector('.guided-test-confirm')?.checked,measurement=input?.value?.trim();if(!confirmed){session.lastInterpretation='Confirm the exact test conditions before the reading can be interpreted.';renderGuidedTest(run,host);return}if(!measurement)return;const evaluation=evaluateGuidedResult(step,measurement),record=evidenceRecord(session,step,measurement,evaluation);session.measurements.push(measurement);session.completedTests.push(record);session.evidenceLog.push(record);session.lastInterpretation=evaluation.interpretation;session.confidenceState=evaluation.status==='PASS'?'SUPPORTED BY TEST RESULTS':evaluation.status==='FAIL'?'SUSPECTED':'TESTING';const branchStatus=evaluation.status==='PASS'?'PASS':'FAIL',requestedConclusion=branchStatus==='PASS'?step.passConclusion:step.failConclusion,next=branchStatus==='PASS'?step.nextOnPass:step.nextOnFail,isVerified=/^VERIFIED_/.test(requestedConclusion||'');if(isVerified&&!verificationSupported(session,step)){session.lastInterpretation+=' Fault not yet verified. Additional circuit testing required.';session.hypothesis='SUSPECTED';session.confidenceState='SUSPECTED'}else if(evaluation.status!=='INCONCLUSIVE'&&requestedConclusion&&requestedConclusion!=='CONTINUE'){session.conclusion=requestedConclusion;session.confidenceState=isVerified?'VERIFIED':'PASSED';session.nextRecommendedTest='Confirm repair and rerun the affected circuit operation as appropriate'}if(session.conclusion==='CONTINUE'&&Number.isInteger(next)&&session.testPlan[next]){session.currentStep=next;session.nextRecommendedTest=session.testPlan[next].objective}else if(session.conclusion==='CONTINUE'&&!Number.isInteger(next)){session.conclusion='INSUFFICIENT_EVIDENCE';session.nextRecommendedTest='Obtain additional circuit information or a clearer diagram'}renderGuidedTest(run,host);updateDeveloper(run,{disposition:'GUIDED TEST ACTIVE',verification:'PASS'})};
  }

  function renderResult(run,result){
    const preview=$('oliverImportPreview');if(!preview)return;
    $('adAnalysisResult')?.remove();
    const host=document.createElement('div');host.id='adAnalysisResult';host.className='phase2-result';
    const routingConfidence=result.confidence===null?'Not provided':`${result.confidence}%`;
    const freshVerification=result.category==='UNKNOWN_OR_ANALYSIS_UNAVAILABLE'?'FAIL':result.category==='AUTOMOTIVE_GRAPH'?(result.routeResult?.freshResultVerification||'FAIL'):'PASS';
    const component=result.componentIdentification;
    if(component){
      const componentConfidence=component.componentConfidence===null?'Not provided':`${component.componentConfidence}%`,list=items=>items?.length?`<ul>${items.map(item=>`<li>${escapeHtml(item)}</li>`).join('')}</ul>`:'<p class="condition-empty">None</p>';
      const section=document.createElement('section');section.className='specific-component-identification';
      const identificationLabel=component.status==='IDENTIFIED'?'CONFIRMED VISUAL FINDING':result.vehicleContextApplied?.available?'LIKELY IDENTIFICATION — VEHICLE CONTEXT':'CANNOT CONFIRM';
      section.innerHTML=`<h3>SPECIFIC COMPONENT IDENTIFICATION</h3><div class="condition-field"><strong>Identification basis</strong><span>${escapeHtml(identificationLabel)}</span></div>${result.vehicleContextApplied?.available?`<div class="condition-field"><strong>Vehicle context used as non-visual reference</strong><span>${escapeHtml(result.vehicleContextApplied.summary||'Active repair-order vehicle context')}</span></div>`:''}<div class="condition-field"><strong>Status</strong><span>${escapeHtml(component.status)}</span></div><div class="condition-field"><strong>Exact component identification</strong><span>${escapeHtml(component.primaryComponent)}</span></div><div class="condition-field"><strong>Component-identification confidence</strong><span class="phase2-confidence">${escapeHtml(componentConfidence)}</span></div><div class="condition-field"><strong>Visible defining evidence</strong>${list(component.supportingEvidence)}</div><div class="condition-field"><strong>What cannot be confirmed</strong><span>${escapeHtml(component.uncertaintyReason||'No additional limitation was returned.')}</span></div><div class="condition-field"><strong>Likely connection or destination (not confirmed)</strong>${list(component.likelyConnectionsOrDestinations)}</div><div class="condition-field"><strong>Secondary visible components</strong>${list(component.secondaryComponents)}</div><div class="condition-field"><strong>Possible identification</strong>${list(component.possibleAlternatives)}</div><div class="condition-field"><strong>System</strong><span>${escapeHtml(component.system||'Not determined')}</span></div>`;
      host.appendChild(section);
    }
    const relationship=result.vehicleAreaRelationshipAnalysis;
    if(relationship){
      const pct=value=>value===null?'Not provided':`${value}%`,list=items=>items?.length?`<ul>${items.map(item=>`<li>${escapeHtml(item)}</li>`).join('')}</ul>`:'<p class="condition-empty">None</p>',items=relationship.observedItems.length?relationship.observedItems.map(item=>`<article class="condition-field"><strong>Observed item</strong><span>${escapeHtml(item.observedItem)}</span><strong>Item location in image</strong><span>${escapeHtml(item.itemLocationInImage)}</span><strong>Nearest identifiable assembly</strong><span>${escapeHtml(item.nearestIdentifiableAssembly)}</span><strong>Likely relationship / destination</strong><span>${escapeHtml(item.likelyRelationshipOrDestination)}</span><strong>Relationship confidence</strong><span class="phase2-confidence">${escapeHtml(pct(item.relationshipConfidence))}</span><strong>Visible evidence</strong><span>${escapeHtml(item.visibleEvidence)}</span>${item.vehicleContextEvidence?`<strong>Vehicle-context evidence</strong><span>${escapeHtml(item.vehicleContextEvidence)}</span>`:''}<strong>What cannot be confirmed</strong><span>${escapeHtml(item.whatCannotBeConfirmed)}</span><strong>Recommended next photo / verification</strong><span>${escapeHtml(item.recommendedNextPhotoVerification)}</span></article>`).join(''):'<p class="condition-empty">No distinct item relationship could be established.</p>';
      const section=document.createElement('section');section.className='vehicle-area-relationship';section.innerHTML=`<h3>VEHICLE-AREA &amp; COMPONENT RELATIONSHIP</h3>${result.vehicleContextApplied?.available?`<div class="condition-field"><strong>Vehicle context used</strong><span>${escapeHtml(result.vehicleContextApplied.summary||'Active repair-order vehicle context')}</span></div>`:''}<div class="condition-field"><strong>Vehicle-area location</strong><span>${escapeHtml(relationship.vehicleAreaLocation)}</span></div><div class="condition-field"><strong>Location confidence</strong><span class="phase2-confidence">${escapeHtml(pct(relationship.locationConfidence))}</span></div><div class="condition-field"><strong>Primary visible assembly</strong><span>${escapeHtml(relationship.primaryVisibleAssembly)}</span></div><div class="condition-field"><strong>Location evidence</strong>${list(relationship.locationEvidence)}</div><div class="condition-field"><strong>Vehicle-context support</strong>${list(relationship.vehicleContextSupport)}</div><div class="condition-field"><strong>Observed loose/disconnected items</strong><div class="condition-finding-cards">${items}</div></div><div class="condition-field"><strong>What prevents confirmation</strong><span>${escapeHtml(relationship.whatPreventsConfirmation||'Current image context is limited.')}</span></div><div class="condition-field"><strong>Recommended next photo / verification</strong><span>${escapeHtml(relationship.recommendedNextPhotoVerification||'Take a wider, well-lit image that includes the item and surrounding mounting area.')}</span></div>`;host.appendChild(section);
      const gap=relationship.expectedComponentCheck||{},gapSection=document.createElement('section');gapSection.className='vehicle-area-relationship';gapSection.innerHTML=`<h3>EXPECTED / MISSING COMPONENT CHECK</h3><div class="condition-field"><strong>Vehicle context used</strong><span>${escapeHtml(result.vehicleContextApplied?.summary||'Validated analysis vehicle snapshot')}</span></div><div class="condition-field"><strong>Identified vehicle area</strong><span>${escapeHtml(relationship.vehicleAreaLocation)}</span></div><div class="condition-field"><strong>Expected major components in this area</strong>${list(gap.expectedMajorComponents)}</div><div class="condition-field"><strong>Expected components visibly accounted for</strong>${list(gap.visiblyAccountedFor)}</div><div class="condition-field"><strong>Possible missing / removed component</strong><span>${escapeHtml(gap.possibleMissingOrRemovedComponent||'No visually supported missing component detected.')}</span></div><div class="condition-field"><strong>Supporting visual evidence</strong>${list(gap.supportingVisualEvidence)}</div><div class="condition-field"><strong>Vehicle-context support</strong>${list(gap.vehicleContextSupport)}</div><div class="condition-field"><strong>Confidence</strong><span>${escapeHtml(pct(gap.confidence))}</span></div><div class="condition-field"><strong>What prevents confirmation</strong><span>${escapeHtml(gap.whatPreventsConfirmation||'No visually supported missing component can be confirmed from this image.')}</span></div><div class="condition-field"><strong>Technician verification step</strong><span>${escapeHtml(gap.recommendedTechnicianVerification||'Take a wider, well-lit image showing the mounting area and nearby connectors.')}</span></div>`;host.appendChild(gapSection);
    }
    const visualCondition=result.visualConditionInspection;
    if(visualCondition){
      const inspectionUnavailable=visualCondition.status==='UNABLE_TO_INSPECT'||visualCondition.status==='FAILED',emptyText=inspectionUnavailable?'Not available because the visual inspection could not complete.':'None',list=items=>items?.length?`<ul>${items.map(item=>`<li>${escapeHtml(item)}</li>`).join('')}</ul>`:`<p class="condition-empty">${escapeHtml(emptyText)}</p>`;
      const overallInspectionConfidence=visualCondition.conditionConfidence===null?'Not provided':`${visualCondition.conditionConfidence}%`,section=document.createElement('section');section.className='visual-condition-inspection';
      const classification=item=>({CLEAR_DEFECT:'CLEAR DEFECT',POSSIBLE_CONCERN:'POSSIBLE CONCERN DETECTED',UNVERIFIED_CONDITION:item.missingContext&&/removed|outside the frame|out of frame/i.test(item.missingContext)?'POSSIBLE REMOVED OR OUT-OF-FRAME COMPONENT':'UNVERIFIED CONDITION',NO_DEFECT_VISIBLE:'NO VISIBLE DEFECT'}[item.findingType]||item.findingType.replaceAll('_',' '));
      const relationshipObserved=Boolean(result.vehicleAreaRelationshipAnalysis?.observedItems?.length),connectionList=visualCondition.connectionAssessments?.length?`<div class="condition-finding-cards">${visualCondition.connectionAssessments.map(item=>`<article class="condition-field"><strong>Finding location</strong><span>${escapeHtml(item.location)}</span><strong>Classification</strong><span>${escapeHtml(classification(item))}</span><strong>Visible evidence</strong><span>${escapeHtml(item.visibleEvidence)}</span>${item.missingContext?`<strong>Missing context</strong><span>${escapeHtml(item.missingContext)}</span>`:''}<strong>Finding confidence</strong><span class="phase2-confidence">${escapeHtml(`${item.findingConfidence}%`)}</span><strong>Recommended technician verification</strong><span>${escapeHtml(item.recommendedVerification)}</span>${item.safetyDrivabilityImpact?`<strong>Safety / drivability impact</strong><span>${escapeHtml(item.safetyDrivabilityImpact)}</span>`:''}</article>`).join('')}</div>`:`<p class="condition-empty">${inspectionUnavailable?'No connection assessment was returned because the visual inspection could not complete.':relationshipObserved?'Possible item relationship observed; exact connection and destination cannot be confirmed from this image.':'No connection could be reliably assessed.'}</p>`;
      const inspectionStatus=visualCondition.status==='UNVERIFIED_CONDITION'?'INSPECTED — CONDITION UNVERIFIED':visualCondition.status.replaceAll('_',' ');
      section.innerHTML=`<h3>VISUAL CONDITION INSPECTION</h3><div class="condition-field"><strong>Inspection status</strong><span>${escapeHtml(inspectionStatus)}</span></div><div class="condition-field"><strong>Overall visual-inspection confidence</strong><span class="phase2-confidence">${escapeHtml(overallInspectionConfidence)}</span></div><div class="condition-field"><strong>Findings</strong>${connectionList}</div>${visualCondition.status==='NO_VISIBLE_CONCERN_DETECTED'?`<div class="condition-field"><strong>Result</strong><p>${escapeHtml(visualCondition.noVisibleConcernMessage||'No visible defect can be confirmed from this image. Inspect the component physically before making a repair decision.')}</p></div>`:''}${visualCondition.status==='UNABLE_TO_INSPECT'||visualCondition.status==='FAILED'?`<div class="condition-field"><strong>What cannot be confirmed</strong><span>${escapeHtml(visualCondition.unableToInspectReason||'A reliable visual assessment could not be completed.')}</span></div>`:''}`;
      host.appendChild(section);
    }
    const routingSection=document.createElement('section');routingSection.className='visual-routing-summary';routingSection.innerHTML=`<div class="condition-field"><strong>Detected category</strong><span>${escapeHtml(CATEGORY_LABELS[result.category]||result.category)}</span></div><div class="condition-field"><strong>Image/category routing confidence</strong><span class="phase2-confidence">${escapeHtml(routingConfidence)}</span></div><div class="condition-field"><strong>Observed objects</strong><span>${escapeHtml(result.objects?.join(', ')||'None reported')}</span></div><div class="condition-field"><strong>Analyzer evidence</strong><span>${escapeHtml(result.evidence.join('; ')||'None')}</span></div><div class="condition-field"><strong>Routing</strong><span>${escapeHtml(result.route)} — ${escapeHtml(result.routeResult?.status||'Not started')}</span></div><div class="condition-field"><strong>Fresh-result verification</strong><span>${freshVerification}</span></div>`;host.appendChild(routingSection);
    const graph=result.automotiveGraphAnalysis;
    if(graph)graph.observed=finalObservedFromRenderedTriplets(graph.observed,graph.renderedPidEvidence||graph.finalCanonicalPidEvidence||[]);
    if(graph){const section=document.createElement('section'),list=items=>items?.length?`<ul>${items.map(item=>`<li>${escapeHtml(item)}</li>`).join('')}</ul>`:'<p>None required or reliably readable.</p>',heading=graph.analysisMode==='PID_SNAPSHOT'?'AUTOMOTIVE PID SNAPSHOT ANALYSIS':'AUTOMOTIVE PID GRAPH ANALYSIS',postRenderAssertion=assertFinalRenderedPidEvidence(graph.renderedPidEvidence||graph.finalCanonicalPidEvidence||[]),rows=postRenderAssertion.renderedPidEvidence,failed=postRenderAssertion.failed,numericFailure=postRenderAssertion.status!=='PASS';if(numericFailure&&graph.finalRenderValidationStatus==='PASS'){console.error('POST_RENDER_INVARIANT_BLOCKED_FALSE_PASS',failed.map(row=>({pidName:row.pidName,currentNumeric:row.currentNumeric,minNumeric:row.minNumeric,maxNumeric:row.maxNumeric,currentText:row.currentText,minText:row.minText,maxText:row.maxText,evidenceState:row.evidenceState,finiteNumbers:row.finiteNumbers,minimumLessThanOrEqualCurrent:row.minimumLessThanOrEqualCurrent,currentLessThanOrEqualMaximum:row.currentLessThanOrEqualMaximum,minimumLessThanOrEqualMaximum:row.minimumLessThanOrEqualMaximum})));window.NitrosDeveloperMode=window.NitrosDeveloperMode||{};window.NitrosDeveloperMode.postRenderInvariantAssertion={status:postRenderAssertion.status,failed}}const numericRows=rows.length?`<ul>${rows.map(row=>`<li><strong>${escapeHtml(row.pidName)} — ${escapeHtml(row.evidenceState)}</strong>: Current ${escapeHtml(row.currentText)}, Min ${escapeHtml(row.minText)}, Max ${escapeHtml(row.maxText)}${row.invariantFailureReason?`. ${escapeHtml(row.invariantFailureReason)}`:''}</li>`).join('')}</ul>`:'',incomplete=failed.filter(row=>row.evidenceState==='INCOMPLETE'),inconsistent=failed.filter(row=>row.evidenceState==='INCONSISTENT'),failures=inconsistent.length?`<strong>Numeric Evidence Consistency: FAIL — INCONSISTENT</strong>${numericRows}<p><strong>${escapeHtml(inconsistent.map(row=>`${row.pidName} numeric evidence is internally inconsistent because the rendered Current/Min/Max values violate Min <= Current <= Max. Diagnostic interpretation of this PID is withheld.`).join(' '))}</strong></p>`:incomplete.length?`<strong>Numeric Evidence Consistency: INCOMPLETE</strong>${numericRows}<p><strong>${escapeHtml(incomplete.map(row=>`${row.pidName} numeric evidence is incomplete because Min and/or Max could not be reliably recovered. Interpretation requiring the complete triplet is indeterminate.`).join(' '))}</strong></p>`:`<strong>Numeric Evidence Consistency: PASS</strong>${numericRows}`,safeInterpretation=graph.interpretation,safeTraceFindings=graph.traceFindings;section.className='automotive-graph-analysis';section.innerHTML=`<h3>${heading}</h3>${failures}<strong>Observed:</strong>${list(graph.observed)}${graph.analysisMode!=='PID_SNAPSHOT'&&safeTraceFindings?.length?`<strong>Trace Behavior:</strong>${list(safeTraceFindings)}`:''}<strong>Interpretation:</strong>${list(safeInterpretation)}<strong>Diagnostic Significance:</strong><p>${numericFailure?'Undetermined — numeric evidence '+(incomplete.length?'incomplete':'inconsistent'):escapeHtml(String(graph.diagnosticSignificance||'INCONCLUSIVE').replaceAll('_',' ').toLowerCase())}</p><strong>Next Test:</strong>${list(graph.nextTest)}${graph.nextTestReason?`<strong>Why:</strong><p>${escapeHtml(graph.nextTestReason)}</p>`:''}${graph.unreadableOrUncertain?.length?`<strong>Unreadable / Uncertain:</strong>${list(graph.unreadableOrUncertain)}`:''}`;host.appendChild(section)}
    const documentInfo=result.documentRepairInformation;
    if(documentInfo){const section=document.createElement('section'),field=(label,value)=>`<strong>${label}:</strong> ${escapeHtml(value||'Not visibly provided')}<br>`,missing=documentInfo.missingRequiredFields?.length?documentInfo.missingRequiredFields.join(', '):'None',verified=documentInfo.freshResultVerification==='PASS'&&missing==='None'&&documentInfo.verifiedRepairInformationStatus==='VERIFIED';section.className='document-repair-information';section.innerHTML=`<h3>DOCUMENT REPAIR INFORMATION EXTRACTION</h3>${field('Extraction status',documentInfo.extractionStatus||documentInfo.status)}${field('DTC applicability',documentInfo.dtcApplicability)}${field('DTCs',documentInfo.dtcs?.join(', '))}${field('Test',documentInfo.testName)}${field('Component / circuit',documentInfo.componentOrCircuit)}${field('Test location / connector / terminal',documentInfo.testLocation)}${field('Method',documentInfo.method)}${field('Criterion',documentInfo.criterion)}${field('Requested technician result',documentInfo.requestedResult)}${field('Missing required fields',missing)}${field('Fresh-result verification',documentInfo.freshResultVerification)}${field('Verified Repair Information',verified?'PASS / VERIFIED':documentInfo.verifiedRepairInformationStatus||'PENDING')}${field('Missing or unsupported',missing)}`;if(documentInfo.freshResultVerification==='PASS'&&missing==='None'&&!verified)section.insertAdjacentHTML('beforeend','<p>INTERNAL STATE MISMATCH: fresh verification passed with no missing fields, but Verified Repair Information did not transition to VERIFIED.</p>');else if(!verified)section.insertAdjacentHTML('beforeend',`<p>Verified Repair Information Required remains pending. Missing or unsupported: ${escapeHtml(missing)}.</p>`);host.appendChild(section)}
    const diagram=result.wiringDiagramAnalysis;
    if(diagram){
      const list=items=>items?.length?`<ul>${items.map(item=>`<li>${escapeHtml(item)}</li>`).join('')}</ul>`:'Not reliably readable from supplied diagram.',diagramConfidence=diagram.confidence===null?'Not provided':`${diagram.confidence}%`;
      const section=document.createElement('section');section.className='specific-component-identification wiring-diagram-analysis';
      const paths=diagram.circuitPaths?.length?`<ol>${diagram.circuitPaths.map(path=>`<li><strong>${escapeHtml(path.label)}:</strong> ${escapeHtml(path.path)}<br><strong>Function:</strong> ${escapeHtml(path.functionConfirmed?path.function:'Circuit function not reliably confirmed from supplied diagram.')}</li>`).join('')}</ol>`:'Circuit function not reliably confirmed from supplied diagram.';
      const nodeList=nodes=>nodes?.length?`<ul>${nodes.map(node=>`<li>${escapeHtml([node.component,node.terminal,node.wire,node.circuit,node.voltageExpected,node.description].filter(Boolean).join(' — '))}</li>`).join('')}</ul>`:'Not reliably confirmed from supplied diagram.';
      section.innerHTML=`<h3>WIRING DIAGRAM ANALYSIS</h3><strong>Status:</strong> ${escapeHtml(diagram.status)}<br><strong>Circuit / Component:</strong> ${escapeHtml(diagram.circuitComponent)}<br><strong>Wiring-diagram analysis confidence:</strong> ${escapeHtml(diagramConfidence)}<br><strong>Circuit paths:</strong>${paths}<strong>Normalized power path:</strong>${nodeList(diagram.powerPath)}<strong>Normalized ground path:</strong>${nodeList(diagram.groundPath)}<strong>Normalized control/signal path:</strong>${nodeList(diagram.controlPath)}<strong>Visible test points:</strong>${nodeList(diagram.testPoints)}<strong>Visible connectors/pins:</strong>${list(diagram.connectorsAndPins)}<strong>Important circuit observations:</strong>${list(diagram.importantObservations)}<strong>Unreadable/uncertain fields:</strong>${list(diagram.unreadableFields)}${diagram.safetyWarning?`<strong>Safety warning:</strong> ${escapeHtml(diagram.safetyWarning)}<br>`:''}`;
      if(window.NitrosDiagnosticV10120?.isComplete?.()){const button=document.createElement('button');button.type='button';button.className='oliver-import-action continue-repair-decision';button.textContent='CONTINUE TO REPAIR DECISION';button.onclick=()=>{window.NitrosDiagnosticV10120?.continueToRepairDecision?.();const status=$('oliverImportStatus');if(status)status.textContent='Diagnostic testing remains complete. Continue with Oliver’s repair-decision conclusion.'};section.append(button)}
      else if(diagram.status==='READY'&&diagram.testPlan.length){const button=document.createElement('button');button.type='button';button.className='oliver-import-action guide-component-test';button.textContent='START GUIDED COMPONENT TEST';const guide=document.createElement('div');guide.className='guided-component-test';button.onclick=()=>{if(window.NitrosDiagnosticV10120?.isComplete?.()){button.textContent='CONTINUE TO REPAIR DECISION';button.className='oliver-import-action continue-repair-decision';button.onclick=()=>window.NitrosDiagnosticV10120?.continueToRepairDecision?.();window.NitrosDiagnosticV10120?.continueToRepairDecision?.();return}run.componentTestSession={id:createId('WTEST'),uploadedDiagram:{runId:run.runId,imageHash:run.imageHash},imageHash:run.imageHash,semanticRequestId:run.analyzer.requestId,circuitComponent:diagram.circuitComponent,currentStep:0,completedTests:[],evidenceLog:[],measurements:[],confidenceState:'NOT TESTED',hypothesis:'No fault verified. Confirm test conditions and gather evidence.',nextRecommendedTest:diagram.testPlan[0]?.objective||'',conclusion:'CONTINUE',testPlan:diagram.testPlan,lastInterpretation:''};button.remove();renderGuidedTest(run,guide);updateDeveloper(run,{disposition:'GUIDED TEST ACTIVE',verification:'PASS'})};section.append(button,guide)}
      else section.insertAdjacentHTML('beforeend','<p>Critical connector/pin information is not readable enough for a reliable component test. Please upload a clearer or zoomed section.</p>');
      host.appendChild(section);
    }
    preview.appendChild(host);
  }

  function renderPayloadFailure(){
    const preview=$('oliverImportPreview');if(!preview)return;
    $('adAnalysisResult')?.remove();
    const host=document.createElement('div');host.id='adAnalysisResult';host.className='phase2-result';
    host.innerHTML='<strong>TRANSPORT/PAYLOAD FAILURE</strong><br>Image could not be prepared for analysis.<br><strong>Semantic classification:</strong> Not performed';
    preview.appendChild(host);
  }

  async function analyzeSelectedImage(file){
    abortAndDestroy('NEW_IMAGE',{clearPreview:true});
    const mime=file.type||'application/octet-stream',analyzer=createSemanticDiagnostic(mime);
    const vehicleContextSnapshot=createAnalysisVehicleSnapshot();
    Object.assign(analyzer,{configured:Boolean(window.NitrosVisionAnalyzer?.analyzeCurrentImage),staleRejected:false,resultReceived:false,responseValidated:false,transportStatus:null,requestStarted:'',requestCompleted:''});
    const run={runId:createId('AD'),fileName:file.name||'Imported diagnostic image',fileSize:Number(file.size)||0,controller:new AbortController(),bytes:null,analysisBytes:null,imageHash:'',mime,analysisMime:'image/jpeg',started:new Date().toISOString(),completed:'',result:null,dimensions:null,analysisDimensions:null,analysisError:'',analyzer,stages:[
      {label:'Preparing image…',status:'PENDING'},
      {label:'Hashing image…',status:'PENDING'},
      {label:'Building semantic request…',status:'PENDING'},
      {label:'Contacting Vercel endpoint…',status:'PENDING'},
      {label:'Vercel endpoint response…',status:'PENDING'},
      {label:'OpenAI request…',status:'PENDING'},
      {label:'OpenAI response…',status:'PENDING'},
      {label:'Parsing semantic response…',status:'PENDING'},
      {label:'Semantic response shape normalized…',status:'PENDING'},
      {label:'Semantic objects received…',status:'PENDING'},
      {label:'Semantic analysis retry…',status:'PENDING'},
      {label:'Classifying…',status:'PENDING'},
      {label:'Automotive category confirmed…',status:'PENDING'},
      {label:'Identifying specific component…',status:'PENDING'},
      {label:'Component result received…',status:'PENDING'},
      {label:'Component confidence normalized…',status:'PENDING'},
      {label:'Wiring diagram confirmed…',status:'PENDING'},
      {label:'Analyzing visible circuit…',status:'PENDING'},
      {label:'Component test guidance received…',status:'PENDING'},
      {label:'Fresh-result verification…',status:'PENDING'},
      {label:'Complete…',status:'PENDING'},
      {label:'Determining vehicle-area location…',status:'PENDING'},
      {label:'Analyzing component relationships…',status:'PENDING'},
      {label:'Generating photo-verification guidance…',status:'PENDING'},
      {label:'Validating active vehicle context…',status:'PENDING'},
      {label:'Vehicle context mismatch…',status:'PENDING'}
    ]};
    Object.assign(analyzer,{vehicleContextSnapshot,vehicleContextValidation:vehicleContextSnapshot?'PENDING':'SKIPPED',vehicleContextMismatchBlocked:false});
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
      const prepared=await prepareAnalysisImage(run.bytes,run.mime,run.controller.signal,run.analyzer.requestId);
      run.dimensions=prepared.originalDimensions;run.analysisDimensions=prepared.dimensions;run.analysisBytes=prepared.bytes;run.analysisMime=prepared.mimeType;
      Object.assign(run.analyzer,{originalDimensions:prepared.originalDimensions,originalImageBytes:run.bytes.byteLength,analysisDimensions:prepared.dimensions,analysisJpegQuality:prepared.quality,compressionStage:prepared.stage,encodedPayloadBytes:prepared.encodedSize,requestBodyBytes:prepared.projectedBodyBytes,payloadImageCount:prepared.payloadImageCount,mimeType:prepared.mimeType,imageBytes:prepared.bytes.byteLength,imagePrepared:true,imagePreparationMs:elapsed(preparationStarted),stage:'ANALYSIS_IMAGE_PREPARED'});
      await stage(run,0,'PASS');
      await stage(run,1,'RUN');
      run.imageHash=await sha256(run.analysisBytes);
      if(!isActive(run))throw abortError();
      Object.assign(run.analyzer,{imageHash:run.imageHash,stage:'IMAGE_PREPARED'});
      window.__nitrosCurrentImageIdentity={runId:run.runId,imageHash:run.imageHash};
      updateDeveloper(run,{disposition:'ANALYZING'});
      await stage(run,1,'PASS');
      await stage(run,2,'RUN');
      const result=await classifyCurrentBytes(run);
      syncSemanticStages(run);
      if(!isActive(run)){rejectStale(run,result);return}
      const routed=await routeFreshResult(run,result);
      await stage(run,19,'RUN');
      if(rejectStale(run,routed))return;
      await stage(run,19,'PASS');
      run.result=routed;run.completed=new Date().toISOString();run.analyzer.outcome='SUCCEEDED';run.analyzer.stage='COMPLETE';run.analyzer.requestCompleted=run.analyzer.completedAt||run.completed;
      finalizeAcceptedAnalysisStages(run,routed);
      window.__nitrosCurrentImageAnalysis={runId:run.runId,imageHash:run.imageHash,result:routed};
      window.NitrosDeveloperMode=window.NitrosDeveloperMode||{};window.NitrosDeveloperMode.imageClassification=routed;
      publishImport({kind:'image-analysis',fileName:run.fileName,fileSize:run.fileSize,importedAt:run.completed,imageHash:run.imageHash,analysis:routed});
      renderResult(run,routed);
      const graphFact=graphConversationText(routed);if(graphFact)sendFact(graphFact);
      const componentFailed=routed.category==='AUTOMOTIVE_COMPONENT_OR_VEHICLE'&&routed.componentIdentification?.status==='FAILED';
      const diagramFailed=routed.category==='AUTOMOTIVE_WIRING_DIAGRAM'&&routed.wiringDiagramAnalysis?.status==='FAILED';
      await stage(run,20,componentFailed||diagramFailed?'FAIL':'PASS');
      updateDeveloper(run,{disposition:componentFailed?'COMPONENT IDENTIFICATION FAILED':diagramFailed?'WIRING DIAGRAM ANALYSIS FAILED':'ACCEPTED',verification:'PASS'});
      const status=$('oliverImportStatus');if(status)status.textContent=componentFailed?'Automotive category confirmed — technical component-analysis failure; no component conclusion was produced':diagramFailed?'Wiring diagram confirmed — circuit analysis failed':`Complete — ${CATEGORY_LABELS[routed.category]||routed.category}`;
    }catch(error){
      if(error?.name==='AbortError'){lastStaleRejected=true;lastStaleMessage='STALE RESULT REJECTED — RESULT NOT DISPLAYED';updateDeveloper(activeRun,{disposition:lastStaleMessage});return}
      if(!isActive(run))return;
      run.completed=new Date().toISOString();run.analysisError=run.analyzer.errorMessage||String(error?.message||error);run.analyzer.transportStatus=error?.transportStatus||run.analyzer.transportStatus;
      if(!run.analyzer.errorCategory){const classification=classifyTransportError(error,{endpoint:run.analyzer.endpoint,responseReceived:run.analyzer.responseReceived});Object.assign(run.analyzer,classification,{outcome:'FAILED',stage:'CLIENT_EXCEPTION',errorCategory:error?.diagnosticCategory||classification.category,errorName:sanitizeDiagnosticText(error?.name||'Error'),errorMessage:sanitizeDiagnosticText(error?.message||error),errorCode:sanitizeDiagnosticText(error?.code||''),clientException:true,completedAt:run.completed})}
      run.analyzer.totalMs=run.analyzer.totalMs??Math.max(0,new Date(run.completed)-new Date(run.started));run.analyzer.requestCompleted=run.completed;
      syncSemanticStages(run);const runningStage=run.stages.find(item=>item.status==='RUN');if(runningStage)runningStage.status='FAIL';run.stages[19].status='FAIL';run.stages[20].status='FAIL';renderStages(run);
      const payloadFailure=(run.analyzer.errorCategory||error?.diagnosticCategory)==='PAYLOAD_ERROR';
      if(payloadFailure){run.result=null;renderPayloadFailure();updateDeveloper(run,{disposition:'TRANSPORT/PAYLOAD FAILURE',verification:'FAIL'})}
      else{const failed=unavailableResult(run,`Analysis failed: ${error.message}`);run.result=failed;if(!rejectStale(run,failed)){renderResult(run,{...failed,route:'Stopped',routeResult:{status:'Insufficient evidence'}});updateDeveloper(run,{disposition:'FAILED',verification:'FAIL'})}}
      const status=$('oliverImportStatus');if(status)status.textContent=payloadFailure?'Image could not be prepared for analysis.':'Unknown / Analysis Unavailable';
    }
  }

  function updateDeveloper(run,extra={}){
    const result=run?.result;
    const values={
      nitrosCaseId:caseId,nitrosAnalysisSessionId:sessionId,nitrosCaptureRequestId:run?.runId||'None',nitrosAnalysisId:run?.runId||'None',nitrosActiveVehicleContext:JSON.stringify(activeVehicleAnalysisContext()||null),nitrosAnalysisVehicleSnapshot:JSON.stringify(run?.analyzer?.vehicleContextSnapshot||null),nitrosVehicleContextMatch:run?.analyzer?.vehicleContextValidation||'SKIPPED',
      nitrosCurrentImageSha:run?.imageHash?`${run.imageHash.slice(0,16)}…`:'None',nitrosAnalyzerSource:result?.source||'CURRENT IMAGE BYTES',nitrosResultId:result?.runId||'None',
      nitrosAnalysisStarted:run?.started||'None',nitrosAnalysisCompleted:run?.completed||'None',nitrosResultDisposition:extra.disposition||'NONE',nitrosResetReason:extra.resetReason||'—',
      nitrosActiveClassifier:'NitrosSemanticImageAnalysis / PID temporal-claim evidence gate / 10.12.23',nitrosStaleResultLog:lastStaleMessage,
      nitrosImageClassification:result?CATEGORY_LABELS[result.category]||result.category:'No image classified.',nitrosClassificationConfidence:result?(result.confidence===null?'Not provided':`${result.confidence}%`):'—',nitrosRawConfidence:result?.rawConfidence??'Not provided',nitrosNormalizedConfidence:result?.normalizedConfidence===null||result?.normalizedConfidence===undefined?'Not provided':`${result.normalizedConfidence}%`,nitrosClassificationEvidence:result?.evidence?.join('; ')||'No image classified.',
      nitrosPrimaryComponent:result?.componentIdentification?.primaryComponent||'None',nitrosComponentStatus:result?.componentIdentification?.status||'Not run',nitrosRawComponentConfidence:result?.componentIdentification?.rawComponentConfidence??'Not provided',nitrosNormalizedComponentConfidence:result?.componentIdentification?.normalizedComponentConfidence===null||result?.componentIdentification?.normalizedComponentConfidence===undefined?'Not provided':`${result.componentIdentification.normalizedComponentConfidence}%`,nitrosAutomotiveSystem:result?.componentIdentification?.system||'Not determined',nitrosSecondaryComponents:result?.componentIdentification?.secondaryComponents?.join('; ')||'None',nitrosComponentEvidence:result?.componentIdentification?.supportingEvidence?.join('; ')||'None',nitrosComponentAlternatives:result?.componentIdentification?.possibleAlternatives?.join('; ')||'None',nitrosComponentUncertainty:result?.componentIdentification?.uncertaintyReason||'None',nitrosComponentHashMatch:result?.componentIdentification?(result.componentIdentification.imageHash===run?.imageHash?'PASS':'FAIL'):'Not run',
      nitrosDiagramStatus:result?.wiringDiagramAnalysis?.status||'Not run',nitrosDiagramConfidence:result?.wiringDiagramAnalysis?.confidence===null||result?.wiringDiagramAnalysis?.confidence===undefined?'Not provided':`${result.wiringDiagramAnalysis.confidence}%`,nitrosDiagramStructuralEvidence:result?.wiringDiagramAnalysis?.structuralEvidence?.join('; ')||'None',nitrosDiagramComponents:result?.wiringDiagramAnalysis?.detectedComponents?.join('; ')||'None',nitrosDiagramConnectors:result?.wiringDiagramAnalysis?.connectorsAndPins?.join('; ')||'None',nitrosDiagramPowerPath:result?.wiringDiagramAnalysis?.powerPath?.map(node=>[node.component,node.terminal,node.wire,node.circuit,node.voltageExpected].filter(Boolean).join(' ')).join(' → ')||result?.wiringDiagramAnalysis?.circuitPaths?.map(path=>`${path.label}: ${path.path}`).join(' | ')||'None',nitrosDiagramGroundPath:result?.wiringDiagramAnalysis?.groundPath?.map(node=>[node.component,node.terminal,node.wire,node.circuit,node.voltageExpected].filter(Boolean).join(' ')).join(' → ')||'Not reliably confirmed',nitrosDiagramControlPath:result?.wiringDiagramAnalysis?.controlPath?.map(node=>[node.component,node.terminal,node.wire,node.circuit,node.voltageExpected].filter(Boolean).join(' ')).join(' → ')||'Not reliably confirmed',nitrosDiagramUnreadable:result?.wiringDiagramAnalysis?.unreadableFields?.join('; ')||'None',nitrosComponentTestSessionId:run?.componentTestSession?.id||'None',
      nitrosDocumentExtractionStatus:result?.documentRepairInformation?.extractionStatus||result?.documentRepairInformation?.status||'Not run',nitrosDocumentExtractedFields:result?.documentRepairInformation?[`DTCs: ${(result.documentRepairInformation.dtcs||[]).join(', ')||'None'}`,`Test: ${result.documentRepairInformation.testName||'None'}`,`Component/circuit: ${result.documentRepairInformation.componentOrCircuit||'None'}`,`Location: ${result.documentRepairInformation.testLocation||'None'}`,`Method: ${result.documentRepairInformation.method||'None'}`,`Criterion: ${result.documentRepairInformation.criterion||'None'}`,`Requested result: ${result.documentRepairInformation.requestedResult||'None'}`].join(' | '):'None',nitrosDocumentMissingFields:result?.documentRepairInformation?.missingRequiredFields?.join(', ')||'None',nitrosDocumentDtcApplicability:result?.documentRepairInformation?.dtcApplicability||'Not evaluated',nitrosDocumentFreshVerification:result?.documentRepairInformation?.freshResultVerification||'Pending',nitrosDocumentExtractionRunId:result?.documentRepairInformation?.extractionRunId||'None',nitrosDocumentVerificationRunId:result?.documentRepairInformation?.verificationRunId||'None',nitrosDocumentCanonicalCriterion:result?.documentRepairInformation?.criterion||'None',nitrosDocumentExtractionMissingFields:result?.documentRepairInformation?.missingRequiredFields?.join(', ')||'None',nitrosDocumentVerificationMissingFields:result?.documentRepairInformation?.verificationMissingFields?.join(', ')||'None',nitrosDocumentSynchronizationStatus:result?.documentRepairInformation?.synchronizationStatus||'Pending',
      nitrosRuntimeGraphStatus:result?.category==='AUTOMOTIVE_GRAPH'?`${result.routeResult?.status||'Pending'}`:'Graph analysis not started.',
      nitrosGraphReasoningEvidence:result?.automotiveGraphAnalysis?.reasoningEvidence?JSON.stringify(result.automotiveGraphAnalysis.reasoningEvidence):'Not run',
      nitrosEvidenceType:result?.automotiveGraphAnalysis?.evidenceType?JSON.stringify(result.automotiveGraphAnalysis.evidenceType):'Not run',nitrosSemanticConsistencyStatus:result?.automotiveGraphAnalysis?.semanticConsistencyStatus||'Not run',nitrosGraphFreshResultVerification:result?.automotiveGraphAnalysis?.freshResultVerification||'Not run',nitrosFinalCanonicalPidObject:result?.automotiveGraphAnalysis?.finalCanonicalPidEvidence?JSON.stringify(result.automotiveGraphAnalysis.finalCanonicalPidEvidence):'Not run',nitrosRenderedInvariantLog:result?.automotiveGraphAnalysis?.renderedInvariantLog?JSON.stringify(result.automotiveGraphAnalysis.renderedInvariantLog):'Not run',nitrosTargetedPidRecovery:result?.automotiveGraphAnalysis?.targetedRecoveryLog?JSON.stringify(result.automotiveGraphAnalysis.targetedRecoveryLog):'Not run',nitrosFinalRenderValidationStatus:result?.automotiveGraphAnalysis?.finalRenderValidationStatus||'Not run',
      nitrosPidPresentationType:result?.automotiveGraphAnalysis?.reasoningEvidence?.pidPresentationType||'Not run',nitrosTraceEvidence:result?.automotiveGraphAnalysis?.reasoningEvidence?.traceEvidence||'Not run',nitrosXAxisTimeScale:result?.automotiveGraphAnalysis?.reasoningEvidence?.exactXAxisTimeScale||'Not run',nitrosTemporalBehavior:result?.automotiveGraphAnalysis?.reasoningEvidence?.temporalBehavior||'Not run',nitrosTemporalRoutingDecision:result?.automotiveGraphAnalysis?.reasoningEvidence?.temporalRoutingDecision||'Not run',nitrosTemporalInterpretationPermissions:result?.automotiveGraphAnalysis?.reasoningEvidence?.temporalInterpretationPermissions||'Not run',nitrosTemporalClaimValidation:result?.automotiveGraphAnalysis?.reasoningEvidence?.temporalClaimValidation||'Not run',nitrosTemporalClaimConflictDetected:result?.automotiveGraphAnalysis?.reasoningEvidence?.temporalClaimConflictDetected||'Not run',nitrosNumericSignNormalization:result?.automotiveGraphAnalysis?.numericValidation?.signNormalization||'Not run',nitrosNumericEvidenceNormalization:result?.automotiveGraphAnalysis?.numericValidation?.normalization||'Not run',nitrosCurrentMinMaxConsistency:result?.automotiveGraphAnalysis?.numericValidation?.currentMinMaxConsistency||'Not run',nitrosInvalidPidEvidence:result?.automotiveGraphAnalysis?.numericValidation?.invalidPidEvidence?.join(', ')||'None',nitrosNumericInconsistencySource:result?.automotiveGraphAnalysis?.numericValidation?.sourceStatus||'Not run',nitrosZeroCrossingValidation:result?.automotiveGraphAnalysis?.numericValidation?.zeroCrossingValidation||'Not run',nitrosDirectionalClaimValidation:result?.automotiveGraphAnalysis?.numericValidation?.directionalClaimValidation||'Not run',nitrosDependentInterpretationSuppressed:result?.automotiveGraphAnalysis?.numericValidation?.dependentInterpretationSuppressed||'Not run',nitrosDiagnosticSignificanceGuard:result?.automotiveGraphAnalysis?.numericValidation?.diagnosticSignificanceGuard||'Not run',nitrosNumericInterpretationGuard:result?.automotiveGraphAnalysis?.numericValidation?.interpretationGuard||'Not run',nitrosNumericNarrativeConflict:result?.automotiveGraphAnalysis?.numericValidation?.conflicts?.join(', ')||'None',nitrosNumericNarrativeCorrection:result?.automotiveGraphAnalysis?.numericValidation?.correction||'Not required',nitrosEvidenceInventoryStatus:result?.automotiveGraphAnalysis?.evidenceInventoryStatus||'Not run',nitrosAvailableDiagnosticChannels:result?.automotiveGraphAnalysis?.evidenceInventory?.channels?.join(', ')||'None',nitrosNextTestUnresolvedQuestion:result?.automotiveGraphAnalysis?.unresolvedQuestion||'Not run',nitrosRedundantTestCheck:result?.automotiveGraphAnalysis?.redundantTestCheck||'Not run',nitrosCandidateNextTestRejected:result?.automotiveGraphAnalysis?.candidateNextTestRejected||'None',nitrosNextTestSelection:result?.automotiveGraphAnalysis?.nextTestSelection||'Not run',nitrosNextTestRationaleAlignment:result?.automotiveGraphAnalysis?(result.automotiveGraphAnalysis.nextTestRationaleAligned?'PASS':'FAIL'):'Not run',nitrosSelectedTest:result?.automotiveGraphAnalysis?.selectedNextTest?.testName||'None',nitrosNextTestDiagnosticObjective:result?.automotiveGraphAnalysis?.selectedNextTest?.diagnosticObjective||'None',nitrosNextTestMissingEvidence:result?.automotiveGraphAnalysis?.selectedNextTest?.evidenceMissing?.join(', ')||'None',nitrosNextTestSelectionReason:result?.automotiveGraphAnalysis?.selectedNextTest?.selectionReason||'None',nitrosGraphContradictionGuard:result?.automotiveGraphAnalysis?.contradictionGuard||'Not run',
      nitrosSemanticConfigured:run?.analyzer?.configured?'YES':'NO',nitrosAnalyzerRequestStarted:run?.analyzer?.requestStarted||'None',nitrosAnalyzerRequestCompleted:run?.analyzer?.requestCompleted||'None',nitrosAnalyzerTransportStatus:run?.analyzer?.transportStatus??'None',nitrosSemanticResultReceived:run?.analyzer?.resultReceived?'YES':'NO',nitrosResponseValidated:run?.analyzer?.responseValidated?'YES':'NO',nitrosResultTransactionMatch:result?(result.semanticRequestId===run?.analyzer?.requestId?'PASS':'FAIL'):'Pending',nitrosResultHashMatch:result?(result.imageHash===run?.imageHash?'PASS':'FAIL'):'Pending',nitrosStaleResultRejected:lastStaleRejected?'YES':'NO',nitrosFinalCategory:result?CATEGORY_LABELS[result.category]||result.category:'None',nitrosSemanticRouting:result?.route||'Not started',nitrosAnalysisError:run?.analysisError||'NONE',nitrosSemanticRequestId:run?.analyzer?.requestId||'None',nitrosSemanticErrorCategory:run?.analyzer?.errorCategory||'None',nitrosSemanticTransportDiagnostic:formatTransportDiagnostic(run?.analyzer),
      nitrosPreviousResultReused:'NO',nitrosResultCacheHit:'NO',nitrosFreshVerification:extra.verification||'Pending',nitrosImageDimensions:run?.dimensions?`${run.dimensions.width} × ${run.dimensions.height}`:'None'
    };
    Object.entries(values).forEach(([id,value])=>{const element=$(id);if(element)element.textContent=value});
    window.NitrosDeveloperMode=window.NitrosDeveloperMode||{};window.NitrosDeveloperMode.semanticTransport=run?.analyzer?JSON.parse(JSON.stringify(run.analyzer)):null;
    window.NitrosDeveloperMode.componentTestSession=run?.componentTestSession?JSON.parse(JSON.stringify(run.componentTestSession)):null;
    window.NitrosDeveloperMode.finalCanonicalPidEvidence=result?.automotiveGraphAnalysis?.finalCanonicalPidEvidence||null;
    window.NitrosDeveloperMode.renderedInvariantLog=result?.automotiveGraphAnalysis?.renderedInvariantLog||null;
    window.NitrosDeveloperMode.targetedPidRecovery=result?.automotiveGraphAnalysis?.targetedRecoveryLog||null;
  }
  window.updateAnalysisSessionDeveloper=()=>updateDeveloper(activeRun);

  function sendFact(text){const input=$('oliverHubInput'),send=$('oliverHubSend');if(!input||!send)return false;input.value=text;send.click();return true}
  function graphConversationText(result){
    const graph=result?.automotiveGraphAnalysis;if(!graph||graph.status==='FAILED')return '';
    const active=window.NitrosQuickVehicle?.getActiveVehicle?.(),diagnosticState=window.NitrosDiagnosticV10120?.getState?.(),activeDtc=String(diagnosticState?.activeDtc||''),workflow=String(diagnosticState?.diagnosticTestState?.workflowName||diagnosticState?.workflowName||''),graphChannels=(graph.evidenceInventory?.channels||[]).join(' '),camWorkflow=/\bP034[0-9]\b|camshaft position/i.test(`${activeDtc} ${workflow}`),fuelGraph=/\b(?:LTFT|STFT|Long FT|Short FT|AFS|A\/F|O2S|oxygen)\b/i.test(graphChannels),relevantToActiveWorkflow=!(camWorkflow&&fuelGraph),visible=String(graph.visibleVehicle?.description||'').trim(),activeLabel=active?[active.year,active.make,active.model,active.engine].filter(Boolean).join(' '):'';
    graph.workflowRelevance={activeDtc:activeDtc||'NONE',workflow:workflow||'NONE',status:relevantToActiveWorkflow?'RELEVANT_OR_NOT_CONFLICTING':'NOT_ESTABLISHED',authoritativeWorkflowPreserved:true};
    const tokens=value=>String(value||'').toLowerCase().match(/\b(?:19|20)\d{2}\b|[a-z0-9-]+/g)||[],a=tokens(activeLabel),v=tokens(visible),mismatch=activeLabel&&visible&&a.some(token=>token.length>2&&!v.includes(token))&&v.some(token=>token.length>2&&!a.includes(token));
    const lines=['Automotive diagnostic graph analysis completed for the current uploaded image.'];
    if(activeLabel)lines.push(`Active RO vehicle context: ${activeLabel}.`);
    if(mismatch)lines.push(`Possible vehicle-context mismatch: the graph visibly identifies ${visible}, which may not match the active RO vehicle ${activeLabel}. Ask the technician to confirm whether this graph belongs to the current vehicle before applying vehicle-specific conclusions.`);
    if(!relevantToActiveWorkflow)lines.push(`Workflow relevance not established: this fuel-trim / A/F / O2 graph is retained as valid image evidence but must not redirect the active ${activeDtc||workflow||'diagnostic'} workflow without an explicit supported relationship.`);
    lines.push(`Observed: ${graph.observed?.join(' ')||'No graph details were reliably readable.'}`);
    lines.push(`Interpretation: ${graph.interpretation?.join(' ')||'Insufficient visible evidence for a diagnostic conclusion.'}`);
    lines.push(`Diagnostic Significance: ${String(graph.diagnosticSignificance||'INCONCLUSIVE').replaceAll('_',' ')}.`);
    lines.push(`Next Test: ${graph.nextTest?.join(' ')||'Obtain a clearer graph or supporting measured data.'}`);
    if(graph.unreadableOrUncertain?.length)lines.push(`Unreadable or uncertain: ${graph.unreadableOrUncertain.join(' ')}`);
    lines.push('Retain these graph findings in the current diagnostic conversation. Treat Observed as pixel-supported evidence and Interpretation as an inference; do not invent missing labels, values, scales, specifications, or procedures.');
    return lines.join('\n');
  }
  function publishImport(detail){lastDiagnosticImport={importedAt:new Date().toISOString(),...detail};window.dispatchEvent(new CustomEvent('nitros:diagnostic-import',{detail:lastDiagnosticImport}));const button=$('oliverUseVerifiedRepairInfo'),diagnosticState=window.NitrosDiagnosticV10120?.getState?.();if(button)button.hidden=!(diagnosticState?.repairInformationRequired&&diagnosticState?.pendingRepairInformation?.eligible)}
  function parseTextFile(text,name){const codes=[...new Set((String(text).toUpperCase().match(/\b[PCBU][0-9A-F]{4}\b/g)||[]))].slice(0,24);const summary=[`Imported diagnostic file ${name}`];if(codes.length)summary.push(`DTCs found: ${codes.join(', ')}`);summary.push(String(text).replace(/\s+/g,' ').slice(0,1200));return {summary:summary.join('. '),preview:String(text).slice(0,5000)}}
  function previewData(html){const preview=$('oliverImportPreview');if(preview){preview.innerHTML=html;preview.classList.add('open')}}
  async function handleFile(file){
    if(!file)return;
    if((file.type||'').toLowerCase().startsWith('image/'))return analyzeSelectedImage(file);
    abortAndDestroy('NON_IMAGE_IMPORT',{clearPreview:true});
    if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){previewData(`<pre>PDF attached: ${escapeHtml(file.name)}. Local PDF extraction is unavailable.</pre>`);sendFact(`Attached diagnostic PDF: ${file.name}.`);publishImport({kind:'pdf-attachment',fileName:file.name,fileSize:Number(file.size)||0});return}
    if(file.size>MAX_TEXT_BYTES)throw new Error('File is too large for local import.');
    const rawText=await file.text(),parsed=parseTextFile(rawText,file.name);let parsedData=null;try{parsedData=JSON.parse(rawText)}catch(_){}previewData(`<pre>${escapeHtml(parsed.preview)}</pre>`);sendFact(parsed.summary);publishImport({kind:'text-data',fileName:file.name,fileSize:Number(file.size)||0,text:rawText.slice(0,20000),parsedData});
  }

  function findAnchor(){return $('oliverHubSend')?.parentElement||$('oliverHubTranscript')?.parentElement}
  function buildImportUi(){
    if($('oliverDiagnosticImport'))return;
    const anchor=findAnchor();if(!anchor)return;
    const wrap=document.createElement('div');wrap.className='oliver-import-row';wrap.id='oliverDiagnosticImport';
    wrap.innerHTML=`<button id="oliverImportToggle" class="oliver-import-btn" type="button">＋ Import Diagnostic Image or Data</button><div id="oliverImportPanel" class="oliver-import-panel"><div class="oliver-import-actions"><button class="oliver-import-action" id="oliverImportImage" type="button">📷 Automatic Image Analysis</button><button class="oliver-import-action" id="oliverImportData" type="button">📊 CSV / Text Data</button><button class="oliver-import-action" id="oliverImportPdf" type="button">📄 PDF Report</button><button class="oliver-import-action" id="oliverImportCamera" type="button">📱 Use Camera</button></div><button class="oliver-import-action" id="oliverUseVerifiedRepairInfo" type="button" hidden>Use as Verified Repair Information</button><input id="oliverImportFile" type="file" hidden><input id="oliverImportCameraFile" type="file" accept="image/*" capture="environment" hidden><div id="oliverImportStatus" class="oliver-import-status">${initialStatus}</div><div id="oliverImportPreview" class="oliver-import-preview"></div></div>`;
    anchor.insertAdjacentElement('afterend',wrap);
    $('oliverImportToggle').onclick=()=>$('oliverImportPanel').classList.toggle('open');
    const fileInput=$('oliverImportFile');
    $('oliverImportImage').onclick=()=>{fileInput.accept='image/*';fileInput.click()};
    $('oliverImportData').onclick=()=>{fileInput.accept='.csv,.txt,.json,text/csv,text/plain,application/json';fileInput.click()};
    $('oliverImportPdf').onclick=()=>{fileInput.accept='.pdf,application/pdf';fileInput.click()};
    $('oliverImportCamera').onclick=()=>$('oliverImportCameraFile').click();
    $('oliverUseVerifiedRepairInfo').onclick=()=>{if(!lastDiagnosticImport)return;window.dispatchEvent(new CustomEvent('nitros:verify-repair-information',{detail:{importedAt:lastDiagnosticImport.importedAt,fileName:lastDiagnosticImport.fileName}}));const accepted=window.NitrosDiagnosticV10120?.getState?.()?.repairInformation?.status==='verified';if(accepted){$('oliverUseVerifiedRepairInfo').hidden=true;const status=$('oliverImportStatus');if(status)status.textContent='Verified repair information attached to the active diagnostic case.'}};
    fileInput.onchange=()=>{const selected=fileInput.files?.[0];fileInput.value='';handleFile(selected).catch(error=>{const status=$('oliverImportStatus');if(status)status.textContent=`Import failed: ${error.message}`})};
    $('oliverImportCameraFile').onchange=event=>{const input=event.currentTarget,selected=input.files?.[0];input.value='';handleFile(selected).catch(error=>{const status=$('oliverImportStatus');if(status)status.textContent=`Camera import failed: ${error.message}`})};
    updateDeveloper(null,{resetReason:'APP_START'});
  }

  function start(){document.title=`Nitros Mobile Technician Portal v${BUILD} — Vehicle Context Isolation & Analysis Completion Integrity — Build 2026-08-28`;buildImportUi()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  window.addEventListener('pageshow',()=>setTimeout(start,40));
  new MutationObserver(()=>{if($('oliverHubSend')&&!$('oliverDiagnosticImport'))buildImportUi()}).observe(document.documentElement,{childList:true,subtree:true});
})();
