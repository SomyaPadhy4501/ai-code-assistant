const {api,waitJob,enter,save,notify,el}=window.gym;
const {renderMarkdown}=await import('./markdown.js');
const $=id=>document.getElementById(id);
let state=null,pending=false,finishing=false,recognition=null,listening=false,spokenAt=0,lastPhase='',polling=false;
const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
const startButton=el('button','Start 45-min interview','primary');startButton.id='startInterview';startButton.hidden=!window.gym.current();document.querySelector('.work-heading').append(startButton);
const overlay=el('div');overlay.innerHTML=`<section id="interviewerWindow" class="interviewer-window" hidden aria-label="AI interviewer"><div class="interviewer-title"><div><span class="interviewer-avatar">AI</span><strong>Interviewer</strong><small id="interviewerModelLabel">Local model</small></div><button id="minimizeInterviewer" aria-label="Minimize interviewer">−</button></div><div class="interview-clock"><strong id="interviewRemaining">45:00</strong><span id="interviewPhase">Understand the problem</span></div><div id="interviewerBody"><div class="call-panel"><button id="callButton" class="primary call-button">Start call</button><div class="call-state"><span id="callDot" class="call-dot"></span><span id="callState">Not on a call</span></div></div><p id="liveCaption" class="live-caption" hidden></p><p id="callProblem" class="call-problem" hidden></p><div id="interviewTranscript" role="log" aria-live="polite"></div><details id="featureAssignment" hidden><summary>Feature acceptance criteria</summary><div id="featureText"></div></details><p id="interviewerStatus" role="status"></p><details class="call-settings"><summary>Call settings</summary><div class="call-settings-body"><label for="voicePick">Interviewer voice</label><select id="voicePick"></select><label class="watch-toggle"><input type="checkbox" id="speakReplies" checked> Speak replies aloud</label><label class="watch-toggle"><input type="checkbox" id="watchCamera"> Let the interviewer watch the camera</label><button type="button" id="stopSpeech">Stop speaking</button></div></details><details class="type-fallback" id="typeFallback"><summary>Type instead</summary><form id="interviewAnswerForm"><textarea id="interviewAnswer" maxlength="6000" placeholder="Explain your hypothesis, approach, or tradeoff…" required></textarea><button class="primary" id="sendInterviewAnswer">Send</button></form></details></div></section>
<dialog id="interviewFeedback"><div class="dialog-heading"><h2>Your interview review</h2><button id="closeFeedback" aria-label="Close feedback">×</button></div><div id="feedbackContent"></div><div class="interview-actions"><button id="exportFeedback">Download feedback</button><button id="returnPractice" class="primary">Return to free practice</button></div></dialog>`;
document.body.append(overlay);
const download=el('button','Download interviewer model');$('pull').after(download);download.onclick=()=>action(download,async()=>{await waitJob(await api('/api/model/pull',{interviewer:true}),text=>$('setupStatus').textContent=text);$('setupStatus').textContent='Interviewer model is ready.';});
async function action(button,fn){const label=button.textContent;button.disabled=true;try{await fn();}catch(error){notify(error.message);}finally{button.disabled=false;button.textContent=button===startButton&&state&&!state.freePractice?(state.status==='ended'?'View interview feedback':'Interview in progress'):label;}}
function stopVoice(){window.speechSynthesis?.cancel();if(currentAudio){currentAudio.pause();currentAudio=null;}}
const VOICE_PREFERENCE=[/premium/i,/enhanced/i,/neural/i,/natural/i,/\b(ava|serena|samantha|allison|susan|tom|alex|daniel|karen|tessa|moira)\b/i];
let chosenVoice=null;
function pickVoice(){
  const voices=(window.speechSynthesis?.getVoices()||[]).filter(v=>/^en(-|_|$)/i.test(v.lang));
  if(!voices.length)return null;
  for(const pattern of VOICE_PREFERENCE){const match=voices.find(v=>pattern.test(v.name));if(match)return match;}
  return voices.find(v=>v.localService)||voices[0];
}
window.speechSynthesis?.addEventListener?.('voiceschanged',()=>{chosenVoice=pickVoice();});
chosenVoice=pickVoice();
// Code blocks and Markdown punctuation are unlistenable, so they are dropped
// and sentence breaks are lengthened into something closer to speech.
function speakable(text){
  return text.replace(/```[\s\S]*?```/g,' I have put the code in the transcript. ')
    .replace(/`([^`]+)`/g,'$1').replace(/[*#_>]/g,'')
    .replace(/\s*\n\s*\n\s*/g,'. ').replace(/\s*\n\s*/g,', ')
    .replace(/\s{2,}/g,' ').trim();
}
let localVoiceReady=false,currentAudio=null;
api('/api/status').then(status=>{localVoiceReady=!!status.voice;}).catch(()=>{});
// A locally synthesised voice is tried first; the browser's compact voices are
// only a fallback, and they are why the local one exists.
async function speak(text){
  if(!$('speakReplies').checked)return;
  stopVoice();
  const clean=speakable(text);
  if(!clean)return;
  if(localVoiceReady){
    try{
      const response=await fetch('/api/speak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:clean.slice(0,1500)})});
      if(response.ok){
        const url=URL.createObjectURL(await response.blob());
        const audio=new Audio(url);
        currentAudio=audio;
        audio.onplay=()=>{if(onCall)setCallState('Speaking…','speaking');};
        const done=()=>{URL.revokeObjectURL(url);if(currentAudio===audio)currentAudio=null;if(onCall&&live())listen();};
        audio.onended=done;audio.onerror=done;
        await audio.play();
        return;
      }
      localVoiceReady=false;
    }catch{localVoiceReady=false;}
  }
  if(!window.speechSynthesis)return;
  const utterance=new SpeechSynthesisUtterance(clean);
  if(!chosenVoice)chosenVoice=pickVoice();
  if(chosenVoice)utterance.voice=chosenVoice;
  utterance.rate=.97;utterance.pitch=1.02;utterance.lang=chosenVoice?.lang||'en-US';
  utterance.onerror=()=>{};
  utterance.onstart=()=>{if(onCall)setCallState('Speaking…','speaking');};
  utterance.onend=()=>{if(onCall&&live())listen();};
  window.speechSynthesis.speak(utterance);
}
function live(){return state?.status==='active'&&!state.freePractice&&state.deadline>Date.now();}
function lockEditor(){const locked=state&&!state.freePractice&&(state.status!=='active'||state.deadline<=Date.now());window.gym.setReadOnly(!!locked);$('save').disabled=!!locked;$('run').disabled=!!locked;$('newFile').disabled=!!locked;$('back').disabled=!!(state&&!state.freePractice);}
function render(next,voice=false){state=next;const active=state&&!state.freePractice;$('interviewerWindow').hidden=!active;if(state?.model)$('interviewerModelLabel').textContent=`Local · ${state.model}`;startButton.textContent=active?(state.status==='ended'?'View interview feedback':'Interview in progress'):'Start 45-min interview';if(!state){lockEditor();return;}$('interviewTranscript').replaceChildren();for(const message of state.transcript){const bubble=el('div','','interview-message '+message.role);const body=el('div','','interview-body');renderMarkdown(message.content,body);bubble.append(el('small',message.role==='assistant'?'INTERVIEWER':'YOU'),body);$('interviewTranscript').append(bubble);}$('interviewTranscript').scrollTop=$('interviewTranscript').scrollHeight;$('featureAssignment').hidden=!state.feature;renderMarkdown(state.feature||'',$('featureText'));$('sendInterviewAnswer').disabled=!live()||pending;$('callButton').disabled=!live();lockEditor();const last=state.transcript.at(-1);if(voice&&last?.role==='assistant'&&last.at>spokenAt){spokenAt=last.at;speak(last.content);}if(state.status==='ended'&&state.report&&!state.freePractice)showFeedback();}
async function synchronize(){if(!window.gym.current()||polling||pending||finishing)return;polling=true;try{const value=await api('/api/interview?id='+window.gym.current().id);if(value?.id!==state?.id||value?.status!==state?.status)render(value);else if(value)state=value;}catch{}finally{polling=false;}}
window.addEventListener('gym-session',e=>{stopVoice();state=null;spokenAt=0;lastPhase='';render(e.detail.interview||null);synchronize();});
// Only the fields that apply to the chosen source are shown.
function syncSetup(){const source=$('interviewSource').value;$('repoLinkRow').hidden=source!=='link';$('eraRow').hidden=source!=='real';}
$('interviewSource').onchange=syncSetup;syncSetup();
$('prepareInterview').onclick=e=>action(e.currentTarget,async()=>{
  const language=$('interviewLanguage').value,source=$('interviewSource').value;
  const status=await api('/api/status');document.getElementById('interviewerModelLabel')?.replaceChildren(document.createTextNode(`Local · ${status.interviewerModel}`));
  if(!status.interviewerReady)throw new Error(`Download the interviewer model ${status.interviewerModel} from Local setup before preparing an interview.`);
  const progress=text=>$('interviewSetupStatus').textContent=text;
  let session;
  if(source==='link'){
    const url=$('repoUrl').value.trim();
    if(!url)throw new Error('Paste a public GitHub repository URL, or choose another codebase source.');
    progress('Cloning the repository…');
    session=await api('/api/session',{url});
  }else if(source==='short'){
    if(!['node','python'].includes(language))throw new Error('The built-in exercises are JavaScript and Python. Choose one of those, or pick another codebase source.');
    session=await api('/api/session',{challenge:language==='python'?'python-cart':'cart'});
  }else{
    if(language==='python')throw new Error('The historical task library covers nine non-Python languages. Use Python with a built-in exercise or your own repository.');
    const task=await waitJob(await api('/api/task/random',{language,scope:$('taskScope').value}),progress);
    session=await waitJob(await api('/api/task/start',{taskId:task.id}),progress);
  }
  await enter(session);
  progress('Allow the microphone and camera when your browser asks — the interview is spoken.');
  const granted=await requestDevices();
  progress(granted.audio?'':'Microphone not granted. The interview will be text-only unless you allow it and press Start.');
  notify('Codebase ready. Press Start 45-min interview when you are — the clock has not started.');
});
startButton.onclick=e=>action(e.currentTarget,async()=>{if(state&&!state.freePractice){$('interviewerWindow').hidden=false;if(state.report)showFeedback();return;}const status=await api('/api/status');document.getElementById('interviewerModelLabel')?.replaceChildren(document.createTextNode(`Local · ${status.interviewerModel}`));if(!status.interviewerReady)throw new Error(`Download the interviewer model ${status.interviewerModel} in Local setup first.`);if(!status.docker)throw new Error('Start Docker Desktop before beginning the interview so you can run tests.');startButton.textContent='Preparing environment…';await waitJob(await api('/api/prepare',{id:window.gym.current().id}),text=>{startButton.textContent='Preparing environment…';notify(text);});if(window.gym.isDirty())await save();render(await api('/api/interview/start',{id:window.gym.current().id}),true);
  if(!devicesReady.audio)await requestDevices();
  if(devicesReady.video&&!$('watchCamera').checked){$('watchCamera').checked=true;$('watchCamera').dispatchEvent(new Event('change'));}
  if(devicesReady.audio)startCall();else callProblem('The interview is running, but the microphone was not granted. Allow it in the address bar and press Start call, or use “Type instead”.');});
async function turn(kind,text=''){if(pending||!live())return;pending=true;hangUpMic();stopVoice();if(onCall)setCallState('Thinking…','thinking');render(state);$('interviewerStatus').textContent='Thinking…';try{if(window.gym.isDirty())await save();const next=await waitJob(await api('/api/interview/turn',{id:window.gym.current().id,kind,text,path:window.gym.file()}),message=>$('interviewerStatus').textContent=message);pending=false;render(next,true);if(kind==='answer'){$('interviewAnswer').value='';caption('');}}catch(error){notify(error.message);}finally{pending=false;$('interviewerStatus').textContent='';if(state)render(state);}}
$('interviewAnswerForm').onsubmit=e=>{e.preventDefault();cancelSend();caption('');turn('answer',$('interviewAnswer').value.trim());};
async function finish(reason){if(finishing||!state||state.report)return;finishing=true;stopVoice();$('interviewerStatus').textContent='Preparing your feedback…';try{if(reason!=='time_up'&&window.gym.isDirty())await save();const next=await waitJob(await api('/api/interview/end',{id:window.gym.current().id,path:window.gym.file(),reason}),message=>$('interviewerStatus').textContent=message);render(next);}catch(error){notify(error.message);}finally{finishing=false;$('interviewerStatus').textContent='';}}

function showFeedback(){if(!state?.report)return;stopVoice();const report=state.report,node=$('feedbackContent');node.replaceChildren(el('p',report.summary));const observed=report.observed;node.append(el('p',`${observed.minutesUsed} min · ${observed.testRuns} test runs · ${observed.hints} hints · ${observed.filesEdited.length} files edited`,'feedback-metrics'));if(report.generationError)node.append(el('p','AI review unavailable: '+report.generationError,'voice-note'));for(const row of report.rubric){const card=el('article','','rubric-row');card.append(el('h3',row.area),el('span',row.assessment),el('p',row.evidence));node.append(card);}for(const [title,items]of [['What went well',report.strengths],['What to work on',report.improvements],['Your next practice sessions',report.practicePlan]]){node.append(el('h3',title));const list=el('ul');for(const item of items)list.append(el('li',item));if(!items.length)list.append(el('li','Not enough evidence to assess.'));node.append(list);}node.append(el('p','AI-generated practice feedback. This is not a hiring decision or a validated assessment.','voice-note'));if(!$('interviewFeedback').open)$('interviewFeedback').showModal();}
$('closeFeedback').onclick=()=>$('interviewFeedback').close();$('returnPractice').onclick=e=>action(e.currentTarget,async()=>{render(await api('/api/interview/practice',{id:window.gym.current().id}));$('interviewFeedback').close();$('interviewerWindow').hidden=true;});
$('exportFeedback').onclick=()=>{const blob=new Blob([JSON.stringify({title:state.title,report:state.report,transcript:state.transcript},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='debug-gym-interview-feedback.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('minimizeInterviewer').onclick=()=>{$('interviewerBody').hidden=!$('interviewerBody').hidden;$('minimizeInterviewer').textContent=$('interviewerBody').hidden?'+':'−';};$('stopSpeech').onclick=()=>{stopVoice();};$('speakReplies').onchange=()=>{if(!$('speakReplies').checked)stopVoice();};
let devicesReady={audio:false,video:false};
async function requestDevices(){
  if(!navigator.mediaDevices)return devicesReady;
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:true});
    stream.getTracks().forEach(track=>track.stop());
    devicesReady={audio:true,video:true};
  }catch{
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      stream.getTracks().forEach(track=>track.stop());
      devicesReady={audio:true,video:false};
    }catch{devicesReady={audio:false,video:false};}
  }
  return devicesReady;
}

// ── the call ──────────────────────────────────────────────
// One control: you are on a call or you are not. While on a call the loop is
// listen → decide your turn ended → send → think → speak → listen again.
//
// Device capture cannot be verified from an automated browser, so every failure
// path here is made loud and specific on screen rather than failing silently.
const SILENCE_MS = 1000;
let onCall = false, silenceTimer = null, finalText = '', sendTimer = null, warming = false, warmedFor = '';
// The model is given the stable part of the prompt as soon as it hears anything,
// so its prefill is already cached by the time the sentence finishes.
function warmUp() {
  const session = window.gym.current();
  if (warming || !session || !live() || pending) return;
  const key = `${session.id}:${window.gym.file()}:${document.querySelectorAll('.interview-message').length}`;
  if (warmedFor === key) return;
  warmedFor = key;
  warming = true;
  api('/api/interview/warm', {id: session.id, path: window.gym.file()}).catch(() => {}).finally(() => { warming = false; });
}

function setCallState(text, tone = '') {
  $('callState').textContent = text;
  $('callDot').className = `call-dot ${tone}`;
  $('callButton').textContent = onCall ? 'End call' : 'Start call';
  $('callButton').classList.toggle('on-call', onCall);
}
function callProblem(message) {
  const node = $('callProblem');
  node.hidden = !message;
  node.textContent = message || '';
  if (message) { $('typeFallback').open = true; }
}
function caption(text) {
  $('liveCaption').hidden = !text;
  $('liveCaption').textContent = text ? `“${text}”` : '';
}
function cancelSend() { clearTimeout(sendTimer); sendTimer = null; clearTimeout(silenceTimer); silenceTimer = null; }

function listen() {
  if (!recognition || listening || !onCall || !live() || pending) return;
  finalText = '';
  try { recognition.start(); }
  catch (error) { /* start() throws if already running; the onend handler retries */ }
}
function hangUpMic() { cancelSend(); if (recognition && listening) { try { recognition.stop(); } catch {} } }

function armSend() {
  clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => {
    const text = $('interviewAnswer').value.trim();
    if (!text || !live() || pending) return;
    hangUpMic();
    setCallState('Sending — Escape to hold', 'sending');
    sendTimer = setTimeout(() => {
      cancelSend();
      caption('');
      setCallState('Thinking…', 'thinking');
      turn('answer', $('interviewAnswer').value.trim());
    }, 450);
  }, SILENCE_MS);
}

async function startCall() {
  if (!SpeechRecognition) { callProblem('This browser has no speech recognition. Chrome or Edge support it — until then, use “Type instead”.'); return; }
  // Ask for the microphone explicitly, so a refusal is reported rather than
  // silently swallowed by recognition.start().
  try {
    const probe = await navigator.mediaDevices.getUserMedia({audio: true});
    probe.getTracks().forEach(track => track.stop());
  } catch (error) {
    callProblem(`Microphone unavailable: ${error.name}. ${error.name === 'NotAllowedError' ? 'Allow the microphone for this page (click the icon in the address bar), then press Start call again.' : 'Check that an input device is connected.'} You can use “Type instead” meanwhile.`);
    return;
  }
  callProblem('');
  onCall = true;
  setCallState('Listening…', 'listening');
  listen();
}
function endCall(message = 'Call ended') {
  onCall = false;
  hangUpMic();
  stopVoice();
  caption('');
  setCallState(message);
}
$('callButton').onclick = () => { if (onCall) endCall(); else startCall(); };

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.onstart = () => { listening = true; if (onCall) setCallState('Listening…', 'listening'); };
  recognition.onresult = event => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) finalText += result[0].transcript + ' '; else interim += result[0].transcript;
    }
    const heard = (finalText + interim).replace(/\s+/g, ' ').trim().slice(0, 6000);
    $('interviewAnswer').value = heard;
    caption(heard);
    warmUp();
    cancelSend();
    armSend();
  };
  recognition.onend = () => {
    listening = false;
    // Chrome ends recognition on its own after a pause, so a live call restarts it.
    if (onCall && live() && !pending && !sendTimer) setTimeout(listen, 250);
    else if (onCall && !pending) setCallState('Listening…', 'listening');
  };
  recognition.onerror = event => {
    listening = false;
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      endCall('Microphone blocked');
      callProblem('The microphone was blocked. Allow it for this page in the address bar, then press Start call again.');
    } else if (event.error === 'audio-capture') {
      endCall('No microphone');
      callProblem('No microphone was found. Connect one and press Start call again.');
    } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
      callProblem(`Speech recognition error: ${event.error}. The call is still open; you can also use “Type instead”.`);
    }
  };
} else {
  $('callButton').disabled = true;
  callProblem('This browser has no speech recognition, so the call is unavailable. Use “Type instead”.');
}
setCallState('Not on a call');

// ── voice picker ──────────────────────────────────────────
// Browser speech quality is bounded by the installed system voices, so the
// choice is exposed rather than guessed at once and hidden.
function fillVoices() {
  const select = $('voicePick');
  const voices = (window.speechSynthesis?.getVoices() || []).filter(voice => /^en(-|_|$)/i.test(voice.lang));
  if (!voices.length || select.options.length) return;
  const stored = localStorage.getItem('debug-gym-voice');
  const best = chosenVoice?.name;
  for (const voice of voices) {
    const option = el('option', `${voice.name}${/premium|enhanced|neural/i.test(voice.name) ? ' · high quality' : ''}`);
    option.value = voice.name;
    select.append(option);
  }
  select.value = stored && voices.some(voice => voice.name === stored) ? stored : (best || voices[0].name);
  chosenVoice = voices.find(voice => voice.name === select.value) || chosenVoice;
  if (!voices.some(voice => /premium|enhanced|neural/i.test(voice.name))) {
    $('voicePick').insertAdjacentHTML('afterend', '<p class="voice-note">Only compact system voices are installed, which is why speech sounds robotic. macOS: System Settings → Accessibility → Spoken Content → System Voice → Manage Voices, download a Premium voice, then reload.</p>');
  }
  select.onchange = () => {
    chosenVoice = voices.find(voice => voice.name === select.value) || null;
    localStorage.setItem('debug-gym-voice', select.value);
    window.speechSynthesis.cancel();
    const sample = new SpeechSynthesisUtterance('This is how I will sound during the interview.');
    if (chosenVoice) sample.voice = chosenVoice;
    sample.rate = .97;
    window.speechSynthesis.speak(sample);
  };
}
window.speechSynthesis?.addEventListener?.('voiceschanged', fillVoices);
fillVoices();
setTimeout(fillVoices, 700);

// ── proctor: the camera, sampled locally ────────────────
// Only two numbers ever leave the browser: how many faces were visible and
// whether the candidate was facing the screen. No frame is uploaded or stored.
let videoStream=null,video=null,detector=null,lastActivityAt=Date.now();
for(const event of ['keydown','mousedown','wheel'])window.addEventListener(event,()=>{lastActivityAt=Date.now();},{passive:true});
async function startCamera(){
  try{
    videoStream=await navigator.mediaDevices.getUserMedia({video:{width:320,height:240},audio:false});
    video=document.createElement('video');video.srcObject=videoStream;video.muted=true;await video.play();
    if('FaceDetector' in window){try{detector=new window.FaceDetector({fastMode:true,maxDetectedFaces:4});}catch{detector=null;}}
    if(!detector)notify('Camera on. This browser has no face detector, so presence is judged from movement only — it cannot tell where you are looking.');
    else notify('Camera on. Only a face count and whether you are facing the screen are sent — never an image.');
    return true;
  }catch(error){notify('Camera not available: '+error.message);return false;}
}
function stopCamera(){videoStream?.getTracks().forEach(track=>track.stop());videoStream=null;video=null;detector=null;}
let lastFrame=null;
async function sampleCamera(){
  if(!video||video.readyState<2)return null;
  if(detector){
    try{
      const faces=await detector.detect(video);
      const box=faces[0]?.boundingBox;
      // A face roughly centred and large enough reads as facing the screen.
      const facing=!!box&&box.width>video.videoWidth*0.12&&Math.abs((box.x+box.width/2)/video.videoWidth-0.5)<0.28;
      return {faces:faces.length,facing};
    }catch{}
  }
  // Fallback: frame differencing tells us somebody is there, nothing more.
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=48;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  context.drawImage(video,0,0,64,48);
  const frame=context.getImageData(0,0,64,48).data;
  let motion=0;
  if(lastFrame)for(let i=0;i<frame.length;i+=16)motion+=Math.abs(frame[i]-lastFrame[i]);
  lastFrame=frame;
  return {faces:motion>900?1:0,facing:motion>900};
}
$('watchCamera').onchange=async()=>{
  if($('watchCamera').checked){if(!await startCamera())$('watchCamera').checked=false;}
  else{stopCamera();notify('Camera off.');}
};
window.addEventListener('pagehide',stopCamera);

// ── observer tick: signals up, an unprompted interviewer turn back down ──
let observing=false;
async function observe(){
  if(observing||!live()||pending||finishing||!window.gym.current())return;
  observing=true;
  try{
    const sample=$('watchCamera').checked?await sampleCamera():null;
    const result=await api('/api/interview/observe',{id:window.gym.current().id,sample,lastActivityAt});
    if(result.ended){await finish(result.ended);return;}
    if(result.interview)render(result.interview,true);
  }catch{}finally{observing=false;}
}
setInterval(observe,20000);
setInterval(synchronize,15000);window.addEventListener('pagehide',stopVoice);synchronize();
