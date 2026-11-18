import {useEffect,useRef,useState} from 'react';
import {AudioLines,Mic,MicOff,PhoneOff,Square} from 'lucide-react';
import {get,getDeviceKey} from './api.js';
import {Modal} from './dialogs.jsx';

const eligible=connections=>connections.filter(c=>c.provider==='openai'&&(c.mode==='vault'||c.relay));
const browserRecognition=()=>window.SpeechRecognition??window.webkitSpeechRecognition;
const microphone=()=>navigator.mediaDevices?.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
const stopTracks=stream=>stream?.getTracks().forEach(track=>track.stop());
const languageOptions=<><option value="auto">Automatic</option><option value="ar">Arabic (Egypt)</option><option value="en">English</option></>;
async function voiceApi(path,connection,user,body,signal){
  const deviceKey=connection.mode==='device'?await getDeviceKey(user,connection.id):undefined;
  return get('voice/'+path,{method:'POST',signal,body:{...body,connectionId:connection.id,deviceKey}});
}
function ConnectionField({connections,value,onChange}){
  return <label>OpenAI connection<select aria-label="OpenAI connection" value={value} onChange={e=>onChange(e.target.value)}>
    {!connections.length&&<option value="">No compatible connection</option>}
    {connections.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>;
}
function audioBase64(blob){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error('The recording could not be read.'));
    reader.onload=()=>resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(blob);
  });
}
const micError=error=>error?.name==='NotAllowedError'?'Microphone permission was denied. Check your browser settings.':error?.message||'Could not access the microphone.';

export function Dictation({connections,user,onInsert,onClose}){
  const options=eligible(connections), Recognition=browserRecognition();
  const [mode,setMode]=useState(Recognition?'browser':'openai'),[connection,setConnection]=useState(options[0]?.id??'');
  const [language,setLanguage]=useState('auto'),[status,setStatus]=useState('idle'),[error,setError]=useState('');
  const [transcript,setTranscript]=useState('');
  const operation=useRef(null);
  function clean(abort=true){
    const current=operation.current;
    operation.current=null;
    if(!current)return;
    if(abort)current.controller.abort();
    clearTimeout(current.timer);
    if(current.recognition){current.recognition.onend=null;current.recognition.abort();}
    if(current.recorder?.state==='recording')current.recorder.stop();
    stopTracks(current.stream);
  }
  useEffect(()=>{
    const leave=()=>clean();
    window.addEventListener('pagehide',leave);
    return()=>{window.removeEventListener('pagehide',leave);clean();};
  },[]);
  function report(current,message){
    if(operation.current!==current)return;
    clean();
    setError(message);setStatus('idle');
  }
  async function start(){
    if(operation.current)return;
    const current={controller:new AbortController()};
    operation.current=current;
    setError('');setTranscript('');
    try{
      if(mode==='browser'){
        const recognizer=new Recognition();
        current.recognition=recognizer;
        recognizer.lang={ar:'ar-EG',en:'en-US'}[language]??navigator.language;
        recognizer.onresult=event=>{
          if(operation.current!==current)return;
          setTranscript(Array.from(event.results,r=>r[0].transcript).join(' '));
        };
        recognizer.onerror=event=>report(current,event.error==='not-allowed'?'Microphone permission was denied.':'Browser dictation failed. Try again or record with OpenAI.');
        recognizer.onend=()=>{if(operation.current===current){clean(false);setStatus('idle');}};
        recognizer.start();setStatus('recording');
        current.timer=setTimeout(()=>recognizer.stop(),60000);
        return;
      }
      const selected=options.find(c=>c.id===connection);
      if(!selected||!window.MediaRecorder||!navigator.mediaDevices?.getUserMedia)throw new Error('Recording needs microphone support and an OpenAI vault or relay connection.');
      setStatus('starting');
      const stream=await microphone();
      if(operation.current!==current){stopTracks(stream);return;}
      current.stream=stream;
      const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type));
      const recorder=new MediaRecorder(stream,{...(mime?{mimeType:mime}:{}),audioBitsPerSecond:64000});
      current.recorder=recorder;
      const chunks=[];
      let bytes=0;
      recorder.ondataavailable=event=>{
        if(operation.current!==current)return;
        bytes+=event.data.size;
        if(bytes>2097152){report(current,'Recording exceeded 2 MB. Try a shorter prompt.');return;}
        if(event.data.size)chunks.push(event.data);
      };
      recorder.onerror=()=>report(current,'The recording failed.');
      recorder.onstop=async()=>{
        stopTracks(stream);
        if(operation.current!==current)return;
        clearTimeout(current.timer);setStatus('transcribing');
        try{
          if(!bytes)throw new Error('No audio was captured. Try again.');
          const type=(recorder.mimeType||chunks[0].type).split(';')[0];
          const audio=await audioBase64(new Blob(chunks,{type}));
          if(operation.current!==current)return;
          const reply=await voiceApi('transcribe',selected,user,{audio,mime:type,language},current.controller.signal);
          if(operation.current!==current)return;
          setTranscript(reply.text);if(!reply.text)setError('No speech was recognized.');
          clean(false);setStatus('idle');
        }catch(error){report(current,error.message);}
      };
      recorder.start(500);setStatus('recording');
      current.timer=setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},60000);
    }catch(error){report(current,micError(error));}
  }
  function stop(){const current=operation.current;if(current?.recognition)current.recognition.stop();else if(current?.recorder?.state==='recording')current.recorder.stop();}
  return <Modal title="Voice prompt" onClose={onClose}><div className="modal-form">
    <fieldset disabled={status!=='idle'} className="voice-settings">
      <label>Transcription method<select aria-label="Transcription method" value={mode} onChange={e=>setMode(e.target.value)}>
        {Recognition&&<option value="browser">Browser speech recognition</option>}<option value="openai">Record and transcribe with OpenAI</option>
      </select></label>
      {mode==='openai'&&<ConnectionField connections={options} value={connection} onChange={setConnection}/>}
      <label>Spoken language<select aria-label="Spoken language" value={language} onChange={e=>setLanguage(e.target.value)}>{languageOptions}</select></label>
    </fieldset>
    <p className="hint">{mode==='browser'?'Your browser may use its speech service.':'Your recording is sent to OpenAI for transcription.'} Review the text before adding it to your draft.</p>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {status==='recording'?<button className="button secondary" onClick={stop}><Square size={16}/>Stop recording</button>:
      <button className="button primary" disabled={status!=='idle'||mode==='openai'&&!connection} onClick={start}><Mic size={16}/>{{starting:'Opening microphone…',transcribing:'Transcribing…'}[status]??'Start recording'}</button>}
    <label>Transcript<textarea aria-label="Transcript" rows={4} maxLength={24000} value={transcript} onChange={e=>setTranscript(e.target.value)}/></label>
    <button className="button secondary" disabled={status!=='idle'||!transcript.trim()} onClick={()=>onInsert(transcript.trim())}>Add to draft</button>
  </div></Modal>;
}

export function LiveVoiceButton({disabled,onClick}){
  return <button className="live-voice-button" type="button" aria-label="Live voice" title="Live voice" aria-haspopup="dialog" disabled={disabled} onClick={onClick}><AudioLines size={19}/></button>;
}

const callLimit=15*60*1000;
export function LiveVoice({connections,user,onClose,onSave}){
  const options=eligible(connections),audio=useRef(null),call=useRef(null),entries=useRef(new Map());
  const [connection,setConnection]=useState(options[0]?.id??''),[language,setLanguage]=useState('auto');
  const [status,setStatus]=useState('idle'),[muted,setMuted]=useState(false),[error,setError]=useState('');
  const [turns,setTurns]=useState([]),[blockedAudio,setBlockedAudio]=useState(false),[saving,setSaving]=useState(false);
  const [model,setModel]=useState('');
  function stop(){
    const current=call.current;
    call.current=null;
    if(!current)return;
    clearTimeout(current.timer);clearTimeout(current.disconnected);
    current.controller.abort();
    current.channel?.close();
    current.peer?.close();
    stopTracks(current.stream);
    if(audio.current){audio.current.pause();audio.current.srcObject=null;}
  }
  useEffect(()=>{
    const leave=()=>stop();
    window.addEventListener('pagehide',leave);
    return()=>{window.removeEventListener('pagehide',leave);stop();};
  },[]);
  function end(message=''){
    stop();setStatus('ended');setMuted(false);setBlockedAudio(false);
    if(message)setError(message);
  }
  function handle(event){
    const type=event.type;
    if(type==='error'){
      setError('The live voice provider reported an error. If the call stops responding, end it and reconnect.');
      return;
    }
    if(type==='input_audio_buffer.speech_started')setStatus('hearing');
    if(type==='input_audio_buffer.speech_stopped')setStatus('thinking');
    if(type==='output_audio_buffer.started')setStatus('speaking');
    if(type==='response.done'&&['failed','incomplete'].includes(event.response?.status)){
      setStatus('ready');
      setError('The voice response did not finish. You can speak again or end the call.');
    }
    if(['output_audio_buffer.stopped','output_audio_buffer.cleared'].includes(type))setStatus('ready');
    if(!event.item_id)return;
    const userEvent=['input_audio_buffer.speech_started','conversation.item.input_audio_transcription.completed','conversation.item.input_audio_transcription.failed'].includes(type);
    const assistantEvent=['response.output_audio_transcript.delta','response.output_audio_transcript.done'].includes(type);
    if(!userEvent&&!assistantEvent)return;
    if(!entries.current.has(event.item_id)&&entries.current.size>=200)return;
    const previous=entries.current.get(event.item_id)??{id:event.item_id,role:userEvent?'user':'assistant',text:'',complete:false};
    if(previous.complete)return;
    const done=type.endsWith('.done')||type.endsWith('.completed');
    const text=done?(event.transcript??previous.text):previous.text+(typeof event.delta==='string'?event.delta:'');
    entries.current.set(event.item_id,{...previous,text:String(text).slice(0,6000),complete:done});
    setTurns([...entries.current.values()].filter(turn=>turn.text));
  }
  async function start(){
    if(call.current)return;
    const selected=options.find(c=>c.id===connection);
    if(!selected)return;
    if(!window.RTCPeerConnection||!navigator.mediaDevices?.getUserMedia){setError('Live voice requires WebRTC and microphone access in a secure browser.');return;}
    const current={controller:new AbortController()};
    call.current=current;
    setStatus('connecting');setError('');setMuted(false);entries.current.clear();setTurns([]);
    current.timer=setTimeout(()=>{if(call.current===current)end('Live voice could not connect in time.');},45000);
    try{
      const stream=await microphone();
      if(call.current!==current){stopTracks(stream);return;}
      current.stream=stream;
      const peer=new RTCPeerConnection();
      current.peer=peer;
      for(const track of stream.getAudioTracks())peer.addTrack(track,stream);
      peer.ontrack=event=>{
        if(call.current!==current||!audio.current)return;
        audio.current.srcObject=event.streams[0]??new MediaStream([event.track]);
        audio.current.play().catch(()=>{if(call.current===current)setBlockedAudio(true);});
      };
      peer.onconnectionstatechange=()=>{
        if(call.current!==current)return;
        clearTimeout(current.disconnected);
        if(['failed','closed'].includes(peer.connectionState))end('The live voice connection closed.');
        if(peer.connectionState==='disconnected')current.disconnected=setTimeout(()=>{
          if(call.current===current)end('The live voice connection was lost.');
        },6000);
      };
      const channel=peer.createDataChannel('oai-events');
      current.channel=channel;
      channel.onopen=()=>{
        if(call.current!==current)return;
        clearTimeout(current.timer);
        current.timer=setTimeout(()=>{if(call.current===current)end('The 15-minute call limit was reached.');},callLimit);
        setStatus('ready');
      };
      channel.onclose=()=>{if(call.current===current)end('The live voice session ended.');};
      channel.onmessage=event=>{
        if(call.current!==current||typeof event.data!=='string'||event.data.length>100000)return;
        try{handle(JSON.parse(event.data));}catch{}
      };
      const offer=await peer.createOffer();
      if(call.current!==current)return;
      await peer.setLocalDescription(offer);
      const response=await voiceApi('live',selected,user,{sdp:peer.localDescription.sdp,language},current.controller.signal);
      if(call.current!==current)return;
      setModel(response.model);
      await peer.setRemoteDescription({type:'answer',sdp:response.sdp});
    }catch(error){if(call.current===current)end(micError(error));}
  }
  function toggleMute(){
    if(!call.current?.stream)return;
    call.current.stream.getAudioTracks().forEach(track=>{track.enabled=muted;});
    setMuted(!muted);
  }
  const active=!['idle','ended'].includes(status), completed=turns.filter(turn=>turn.complete);
  return <Modal title="Live voice" onClose={()=>{stop();onClose();}}><div className="modal-form">
    <p className="hint">Live audio goes to OpenAI. This session starts fresh. Save the transcript to keep completed turns in Kapron.</p>
    {!active&&<fieldset className="voice-settings" disabled={saving}>
      <ConnectionField connections={options} value={connection} onChange={setConnection}/>
      <label>Spoken language<select aria-label="Spoken language" value={language} onChange={e=>setLanguage(e.target.value)}>{languageOptions}</select></label>
    </fieldset>}
    {!options.length&&<p className="hint">Add an OpenAI vault or relay connection in Connections.</p>}
    <div className={'voice-orb voice-'+status} aria-hidden="true"><AudioLines size={35}/></div>
    <p className="voice-status" role="status">{muted?'Microphone muted':{idle:'Ready to connect',connecting:'Connecting…',ready:'Listening',hearing:'Hearing you',thinking:'Thinking…',speaking:'Speaking',ended:'Call ended'}[status]}</p>
    {error&&<p role="alert" className="form-error">{error}</p>}
    <audio ref={audio} autoPlay playsInline/>
    {blockedAudio&&<button className="button secondary" onClick={()=>audio.current.play().then(()=>setBlockedAudio(false),()=>setError('Audio playback is blocked. Check your device output.'))}>Enable audio playback</button>}
    {active?<div className="voice-controls">
      <button className="button secondary" aria-pressed={muted} disabled={status==='connecting'} onClick={toggleMute}>{muted?<MicOff size={17}/>:<Mic size={17}/>} {muted?'Unmute':'Mute'}</button>
      <button className="button danger" onClick={()=>end()}><PhoneOff size={17}/>End call</button>
    </div>:<button className="button primary" disabled={!connection||saving} onClick={start}>{turns.length?'Start new call and clear transcript':'Start live voice'}</button>}
    {turns.length>0&&<ol className="voice-transcript" aria-label="Call transcript">{turns.map(turn=><li key={turn.id}><strong>{turn.role==='user'?'You':'Kapron'}</strong><p dir="auto">{turn.text}</p></li>)}</ol>}
    {status==='ended'&&completed.length>0&&<button className="button secondary" disabled={saving} onClick={async()=>{
      setSaving(true);
      try{await onSave(completed,model);}
      catch(error){setError(error.message);setSaving(false);}
    }}>Save transcript to chat</button>}
  </div></Modal>;
}
